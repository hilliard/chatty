import { randomBytes, createHash } from 'node:crypto';
import { pool } from './db.mjs';
import { enqueueEvent } from './events.mjs';

export const id = () => randomBytes(16).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('hex');
export const live = globalThis.chattyLive ??= { rooms: new Map(), clients: new Set() };
export const colors = ['#a897ff', '#ff9f87', '#b9e878', '#71dcd6', '#f6cf73', '#ec9fe0'];
export function nickname(value) {
  const name = String(value ?? '').trim();
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{1,23}$/.test(name) || /^(system|everyone)$/i.test(name)) {
    throw new Error('Use 2–24 letters, numbers, dots, dashes or underscores. System and everyone are reserved.');
  }
  return name;
}
export async function transaction(work) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export async function currentUser(cookies) {
  const token = cookies.get('chat_user_id')?.value;
  if (!token || !/^[a-zA-Z0-9_-]{43}$/.test(token)) return null;
  const { rows } = await pool.query(`SELECT p.* FROM browser_sessions s JOIN chat_profiles p ON p.human_id=s.human_id
    WHERE s.token_hash=$1 AND s.expires_at>now()`, [digest(token)]);
  return rows[0] ?? null;
}
export async function join(name) {
  const humanId = id(), token = randomBytes(32).toString('base64url');
  await transaction(async client => {
    await client.query('INSERT INTO humans(id) VALUES($1)', [humanId]);
    await client.query('INSERT INTO chat_profiles(human_id,nickname,color) VALUES($1,$2,$3)', [humanId, nickname(name), colors[Math.floor(Math.random() * colors.length)]]);
    await client.query("INSERT INTO browser_sessions VALUES($1,$2,now()+interval '30 days')", [digest(token), humanId]);
    await enqueueEvent(client, 'user.joined', { humanId });
  });
  return { token, humanId };
}
export async function leave(cookies, user) {
  await pool.query('DELETE FROM browser_sessions WHERE token_hash=$1', [digest(cookies.get('chat_user_id').value)]);
  for (const client of live.clients) if (client.user.human_id === user.human_id) client.close();
}
export function roomState(roomId) {
  if (!live.rooms.has(roomId)) live.rooms.set(roomId, new Map());
  return live.rooms.get(roomId);
}
export function people(roomId) { return [...roomState(roomId).values()].map(entry => entry.user); }
export function emit(event, data, roomId = null, humanId = null) {
  for (const client of live.clients) {
    if (roomId && client.roomId !== roomId) continue;
    if (humanId && client.user.human_id !== humanId) continue;
    client.send(event, data);
  }
}
function presence(roomId) {
  const users = people(roomId);
  emit('userlist', users, roomId);
  emit('presence', { roomId, count: users.length });
}
export async function systemMessage(roomId, content, type) {
  const { rows } = await pool.query(`INSERT INTO messages(id,room_id,content,type) VALUES($1,$2,$3,$4) RETURNING *,
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || id AS cursor`, [id(), roomId, content, type]);
  emit('message', rows[0], roomId);
}
export function stream(request, user, roomId) {
  let cleanup;
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      let closed = false, heartbeat;
      const connection = { user, roomId, close: () => cleanup(), send(event, data) {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); }
        catch { cleanup(); }
      } };
      cleanup = () => {
        if (closed) return;
        closed = true; clearInterval(heartbeat);
        request.signal.removeEventListener('abort', cleanup);
        live.clients.delete(connection);
        if (roomId) {
          const members = roomState(roomId), entry = members.get(user.human_id);
          if (entry) {
            entry.connections.delete(connection);
            if (!entry.connections.size) entry.timer = setTimeout(() => {
              if (entry.connections.size || members.get(user.human_id) !== entry) return;
              members.delete(user.human_id); presence(roomId);
              systemMessage(roomId, `${entry.user.nickname} left the room`, 'leave').catch(() => {});
            }, 60000);
          }
        }
        try { controller.close(); } catch {}
      };
      live.clients.add(connection);
      if (roomId) {
        const members = roomState(roomId);
        let entry = members.get(user.human_id);
        if (!entry) {
          entry = { user, connections: new Set(), typingUntil: 0 };
          members.set(user.human_id, entry);
          systemMessage(roomId, `${user.nickname} joined the room`, 'join').catch(() => {});
        }
        clearTimeout(entry.timer); entry.connections.add(connection); presence(roomId);
      }
      connection.send('ready', { roomId });
      heartbeat = setInterval(() => connection.send('heartbeat', {}), 30000);
      request.signal.addEventListener('abort', cleanup, { once: true });
      if (request.signal.aborted) cleanup();
    },
    cancel() { cleanup?.(); },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' } });
}
export function typing(roomId, user, active) {
  const entry = roomState(roomId).get(user.human_id);
  if (entry) entry.typingUntil = active ? Date.now() + 2000 : 0;
  emitTyping(roomId);
}
function emitTyping(roomId) {
  emit('typing', [...roomState(roomId).values()].filter(e => e.typingUntil > Date.now()).map(e => e.user), roomId);
}
if (!globalThis.chattyTypingTimer) {
  globalThis.chattyTypingTimer = setInterval(() => {
    for (const [roomId, members] of live.rooms) {
      let changed = false;
      for (const entry of members.values()) if (entry.typingUntil && entry.typingUntil <= Date.now()) { entry.typingUntil = 0; changed = true; }
      if (changed) emitTyping(roomId);
    }
  }, 500);
  globalThis.chattyTypingTimer.unref?.();
}
export async function rooms() {
  const { rows } = await pool.query('SELECT * FROM rooms ORDER BY (id=\'lobby\') DESC, created_at, id');
  return rows.map(room => ({ ...room, online: people(room.id).length }));
}
export async function history(roomId, params) {
  const cursor = params.get('before') || params.get('after');
  const after = params.has('after');
  let clause = '', args = [roomId];
  if (cursor) {
    const [time, messageId = ''] = cursor.split('|');
    if (Number.isNaN(Date.parse(time)) || messageId.length > 100) throw new Error('Invalid history cursor');
    args.push(time, messageId || (after ? '~' : ''));
    clause = `AND (m.created_at,m.id) ${after ? '>' : '<'} ($2::timestamptz,$3)`;
  }
  const { rows } = await pool.query(`SELECT m.*, p.nickname,p.color,
    to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || m.id AS cursor
    FROM messages m LEFT JOIN chat_profiles p ON p.human_id=m.human_id
    WHERE m.room_id=$1 ${clause} ORDER BY m.created_at ${after ? 'ASC' : 'DESC'},m.id ${after ? 'ASC' : 'DESC'} LIMIT 51`, args);
  const more = rows.length > 50;
  const page = rows.slice(0, 50);
  return { messages: after ? page : page.reverse(), more };
}
export async function sendMessage(roomId, user, text) {
  const content = String(text ?? '').trim();
  if (!content || content.length > 4000) throw new Error('Messages must contain 1–4,000 characters.');
  const messageId = id(), names = [...content.matchAll(/(?:^|\s)@([a-zA-Z0-9_.-]+)/g)].map(m => m[1].toLowerCase());
  const recipients = new Set();
  if (names.includes('everyone')) for (const person of people(roomId)) recipients.add(person.human_id);
  const { rows: mentioned } = await pool.query('SELECT human_id FROM chat_profiles WHERE lower(nickname)=ANY($1::text[])', [names]);
  for (const person of mentioned) recipients.add(person.human_id);
  recipients.delete(user.human_id); recipients.delete('system');
  const message = await transaction(async client => {
    const { rows } = await client.query(`INSERT INTO messages(id,room_id,human_id,content,type) VALUES($1,$2,$3,$4,'message') RETURNING *,
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || id AS cursor`, [messageId, roomId, user.human_id, content]);
    for (const recipient of recipients) await client.query('INSERT INTO notifications(id,human_id,from_human_id,room_id,message_id,preview) VALUES($1,$2,$3,$4,$5,$6)', [id(), recipient, user.human_id, roomId, messageId, content.slice(0, 160)]);
    await enqueueEvent(client, 'message.sent', { roomId, messageId, humanId: user.human_id, mentionCount: recipients.size });
    return { ...rows[0], nickname: user.nickname, color: user.color };
  });
  emit('message', message, roomId); typing(roomId, user, false);
  for (const recipient of recipients) emit('mention', { roomId, messageId }, null, recipient);
  return message;
}
