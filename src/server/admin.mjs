import { pool } from './db.mjs';
import { enqueueEvent } from './events.mjs';
import { createManagedIdentity } from './identity.mjs';
import { emit, id, live, nickname, systemMessage, transaction } from './chat.mjs';

const failure = (message, status = 400) => Object.assign(new Error(message), { status });

export async function listUsers() {
  const { rows } = await pool.query(`SELECT p.human_id,p.nickname,p.color,p.role,p.account_status,p.deletion_at,p.created_at,a.version AS avatar_version
    FROM chat_profiles p LEFT JOIN chat_avatars a ON a.human_id=p.human_id
    WHERE p.human_id <> 'system' ORDER BY p.nickname`);
  return rows;
}

export async function listRooms() {
  const { rows } = await pool.query("SELECT id,name,description,created_at FROM rooms ORDER BY (id='lobby') DESC,created_at,id");
  return rows;
}

export async function createUser(value) {
  try { return await createManagedIdentity(value); }
  catch (error) { if (error.code === '23505') throw failure('That nickname is already taken.', 409); throw error; }
}

export async function renameUser(humanId, value) {
  if (humanId === 'system') throw failure('The system user cannot be changed.');
  const name = nickname(value);
  try {
    const result = await transaction(async client => {
      const updated = await client.query(
        'UPDATE chat_profiles SET nickname=$1,updated_at=now() WHERE human_id=$2 RETURNING human_id,nickname,color,role,account_status,deletion_at,created_at',
        [name, humanId],
      );
      if (updated.rowCount) await enqueueEvent(client, 'user.renamed', { humanId });
      return updated;
    });
    if (!result.rowCount) return null;
    for (const [roomId, members] of live.rooms) {
      const entry = members.get(humanId);
      if (!entry) continue;
      const previousName = entry.user.nickname;
      entry.user = { ...entry.user, nickname: name };
      emit('userlist', [...members.values()].map(member => member.user), roomId);
      await systemMessage(roomId, `${previousName} is now ${name}`, 'rename');
    }
    emit('renamed', { humanId, nickname: name });
    return result.rows[0];
  } catch (error) { if (error.code === '23505') throw failure('That nickname is already taken.', 409); throw error; }
}

export async function setUserRole(humanId, role) {
  if (humanId === 'system') throw failure('The system user cannot be changed.');
  if (!['user', 'admin'].includes(role)) throw failure('Choose user or admin.');
  const user = await transaction(async client => {
    const { rows: admins } = await client.query("SELECT human_id FROM chat_profiles WHERE role='admin' AND account_status='active' FOR UPDATE");
    const { rows } = await client.query('SELECT role,account_status FROM chat_profiles WHERE human_id=$1 FOR UPDATE', [humanId]);
    if (!rows.length) return null;
    if (rows[0].role === 'admin' && rows[0].account_status === 'active' && role !== 'admin' && admins.length < 2) throw failure('The last active administrator cannot be demoted.', 409);
    const result = await client.query('UPDATE chat_profiles SET role=$1,updated_at=now() WHERE human_id=$2 RETURNING human_id,nickname,color,role,account_status,deletion_at,created_at', [role, humanId]);
    await enqueueEvent(client, 'user.role.changed', { humanId, role });
    return result.rows[0];
  });
  if (user) emit('rolechanged', { humanId, role }, null, humanId);
  return user;
}

async function ensureAnotherAdmin(client, humanId) {
  const { rows } = await client.query("SELECT human_id FROM chat_profiles WHERE role='admin' AND account_status='active' FOR UPDATE");
  if (rows.some(row => row.human_id === humanId) && rows.length < 2) throw failure('At least one other active administrator must remain.', 409);
}

function disconnectUser(humanId, nicknameText, blocked = false) {
  const connections = [...live.clients].filter(connection => connection.user.human_id === humanId);
  if (blocked) for (const connection of connections) connection.send('accountblocked', {});
  else emit('userdeleted', { humanId });
  const affectedRooms = [];
  for (const [roomId, members] of live.rooms) {
    if (!members.has(humanId)) continue;
    members.delete(humanId);
    affectedRooms.push(roomId);
  }
  for (const connection of connections) connection.close();
  for (const roomId of affectedRooms) {
    const members = live.rooms.get(roomId);
    emit('userlist', [...members.values()].map(member => member.user), roomId);
    emit('presence', { roomId, count: members.size });
    systemMessage(roomId, `${nicknameText} left the room`, 'leave').catch(() => {});
  }
}

export async function setUserStatus(humanId, status) {
  if (humanId === 'system') throw failure('The system user cannot be changed.');
  if (!['active', 'blocked', 'set_for_deletion'].includes(status)) throw failure('Choose active, blocked, or set for deletion.');
  const user = await transaction(async client => {
    const { rows: found } = await client.query('SELECT human_id,nickname,role FROM chat_profiles WHERE human_id=$1 FOR UPDATE', [humanId]);
    if (!found.length) return null;
    if (status !== 'active' && found[0].role === 'admin') await ensureAnotherAdmin(client, humanId);
    const { rows } = await client.query(`UPDATE chat_profiles SET account_status=$1,
      deletion_at=CASE WHEN $1='set_for_deletion' THEN now()+interval '30 days' ELSE NULL END,
      updated_at=now() WHERE human_id=$2
      RETURNING human_id,nickname,color,role,account_status,deletion_at,created_at`, [status, humanId]);
    if (status === 'blocked') await client.query('DELETE FROM browser_sessions WHERE human_id=$1', [humanId]);
    const eventType = status === 'set_for_deletion' ? 'user.deletion.scheduled' : `user.${status}`;
    await enqueueEvent(client, eventType, { humanId, deletionAt: rows[0].deletion_at });
    return rows[0];
  });
  if (user && status === 'blocked') disconnectUser(humanId, user.nickname, true);
  if (user) emit('accountstatus', { status, deletionAt: user.deletion_at }, null, humanId);
  return user;
}

export async function deleteUser(humanId) {
  if (humanId === 'system') throw failure('The system user cannot be deleted.');
  const user = await transaction(async client => {
    const { rows } = await client.query('SELECT human_id,nickname,role FROM chat_profiles WHERE human_id=$1 FOR UPDATE', [humanId]);
    if (!rows.length) return null;
    if (rows[0].role === 'admin') await ensureAnotherAdmin(client, humanId);
    await client.query('DELETE FROM messages WHERE human_id=$1', [humanId]);
    await enqueueEvent(client, 'user.deleted', { humanId });
    await client.query('DELETE FROM humans WHERE id=$1', [humanId]);
    return rows[0];
  });
  if (user) disconnectUser(humanId, user.nickname);
  return user;
}

export async function createRoom(value, humanId) {
  const name = String(value.name ?? '').trim(), description = String(value.description ?? '').trim();
  if (!name || name.length > 48 || description.length > 180) throw failure('Use a room name up to 48 characters and a description up to 180.');
  const roomId = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 35) || 'room'}-${id().slice(0, 6).toLowerCase()}`;
  const room = await transaction(async client => {
    const { rows } = await client.query('INSERT INTO rooms(id,name,description,created_by) VALUES($1,$2,$3,$4) RETURNING id,name,description,created_at', [roomId, name, description || null, humanId]);
    await enqueueEvent(client, 'room.created', { roomId, humanId });
    return rows[0];
  });
  emit('newroom', { ...room, online: 0 });
  return room;
}

export async function updateRoom(roomId, value) {
  const name = String(value.name ?? '').trim(), description = String(value.description ?? '').trim();
  if (!name || name.length > 48 || description.length > 180) throw failure('Use a room name up to 48 characters and a description up to 180.');
  const { rows } = await transaction(async client => {
    const result = await client.query('UPDATE rooms SET name=$1,description=$2 WHERE id=$3 RETURNING id,name,description,created_at', [name, description || null, roomId]);
    if (result.rowCount) await enqueueEvent(client, 'room.updated', { roomId });
    return result;
  });
  if (!rows.length) return null;
  emit('roomupdated', rows[0]);
  return rows[0];
}

export async function deleteRoom(roomId) {
  if (roomId === 'lobby') throw failure('The Lobby room cannot be deleted.');
  const { rows } = await transaction(async client => {
    const result = await client.query('DELETE FROM rooms WHERE id=$1 RETURNING id,name', [roomId]);
    if (result.rowCount) await enqueueEvent(client, 'room.deleted', { roomId });
    return result;
  });
  if (!rows.length) return null;
  emit('roomdeleted', { roomId });
  const members = live.rooms.get(roomId);
  if (members) for (const entry of members.values()) for (const connection of [...entry.connections]) connection.close();
  live.rooms.delete(roomId);
  return rows[0];
}

export async function processScheduledDeletions() {
  const { rows } = await pool.query(`SELECT human_id FROM chat_profiles
    WHERE account_status='set_for_deletion' AND deletion_at<=now() ORDER BY deletion_at LIMIT 25`);
  for (const row of rows) await deleteUser(row.human_id).catch(error => console.error('Scheduled account deletion failed:', error.message));
}

if (!globalThis.chattyDeletionTimer) {
  globalThis.chattyDeletionTimer = setInterval(() => processScheduledDeletions().catch(() => {}), 60_000);
  globalThis.chattyDeletionTimer.unref?.();
}