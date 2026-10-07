import { pool } from '../../server/db.mjs';
import { enqueueEvent } from '../../server/events.mjs';
import * as chat from '../../server/chat.mjs';
import * as identity from '../../server/identity.mjs';
import * as admin from '../../server/admin.mjs';
import * as avatars from '../../server/avatars.mjs';

export async function ALL(context) {
  const { request, url, locals, cookies } = context;
  const path = context.params.path, user = locals.user, post = request.method === 'POST';
  if (!post && request.method !== 'GET') return new Response(null, { status: 405 });
  try {
    if (post && path === 'avatar') {
      if (!user) return Response.json({ error: 'Please join again.' }, { status: 401 });
      const result = await avatars.saveAvatar(user.human_id, request);
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }
    const avatarPath = /^avatars\/([a-zA-Z0-9_-]{12,64})$/.exec(path);
    if (!post && avatarPath) {
      if (!user) return Response.json({ error: 'Please join again.' }, { status: 401 });
      const humanId = avatarPath[1], avatar = await avatars.getAvatar(humanId);
      if (!avatar) return Response.json({ error: 'Avatar not found.' }, { status: 404 });
      const etag = `"chat-avatar-${humanId}-${avatar.version}"`;
      const headers = { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=31536000, immutable', ETag: etag, 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' };
      if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
      return new Response(avatar.image, { headers });
    }
    let data = {};
    if (post) {
      const body = await request.text();
      if (body.length > 20000) return Response.json({ error: 'Request too large.' }, { status: 413 });
      data = request.headers.get('content-type')?.includes('application/json') ? JSON.parse(body || '{}') : Object.fromEntries(new URLSearchParams(body));
    }
    if (post && path === 'join') {
      const { token, humanId } = await chat.join(data.nickname);
      await identity.remember(cookies, humanId, url.protocol === 'https:');
      cookies.set('chat_user_id', token, { path: '/', httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', maxAge: 30 * 24 * 3600 });
      return context.redirect('/rooms/lobby', 303);
    }
    if (post && path === 'identity/restore') {
      await identity.restore(cookies, url.protocol === 'https:', data.code);
      return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (post && path === 'identity/forget') {
      await identity.forget(cookies);
      return Response.json({ ok: true });
    }
    if (!user) return Response.json({ error: 'Please join again.' }, { status: 401 });
    if (post && path === 'avatar/delete') {
      await avatars.removeAvatar(user.human_id);
      return new Response(null, { status: 204 });
    }
    if (path.startsWith('admin/')) {
      if (user.role !== 'admin') return Response.json({ error: 'Administrator access required.' }, { status: 403 });
      if (!post && path === 'admin/users') return Response.json(await admin.listUsers());
      if (post && path === 'admin/users') return Response.json(await admin.createUser(data.nickname), { status: 201, headers: { 'Cache-Control': 'no-store' } });
      if (!post && path === 'admin/rooms') return Response.json(await admin.listRooms());
      if (post && path === 'admin/rooms') return Response.json({ room: await admin.createRoom(data, user.human_id) }, { status: 201 });
      let managed = /^admin\/users\/([^/]+)\/(rename|role|status|delete)$/.exec(path);
      if (post && managed) {
        const [, humanId, action] = managed;
        if (action === 'rename') {
          const updated = await admin.renameUser(humanId, data.nickname);
          return updated ? Response.json({ user: updated }) : Response.json({ error: 'User not found.' }, { status: 404 });
        }
        if (action === 'role') {
          const updated = await admin.setUserRole(humanId, data.role);
          return updated ? Response.json({ user: updated }) : Response.json({ error: 'User not found.' }, { status: 404 });
        }
        if (action === 'status') {
          const updated = await admin.setUserStatus(humanId, data.status);
          return updated ? Response.json({ user: updated }) : Response.json({ error: 'User not found.' }, { status: 404 });
        }
        if (data.confirm !== true) return Response.json({ error: 'Explicit confirmation is required.' }, { status: 400 });
        const deleted = await admin.deleteUser(humanId);
        return deleted ? Response.json({ ok: true }) : Response.json({ error: 'User not found.' }, { status: 404 });
      }
      managed = /^admin\/rooms\/([^/]+)(?:\/(delete))?$/.exec(path);
      if (post && managed) {
        const [, roomId, action] = managed;
        if (action === 'delete') {
          if (data.confirm !== true) return Response.json({ error: 'Explicit confirmation is required.' }, { status: 400 });
          const deleted = await admin.deleteRoom(roomId);
          return deleted ? Response.json({ ok: true }) : Response.json({ error: 'Room not found.' }, { status: 404 });
        }
        const updated = await admin.updateRoom(roomId, data);
        return updated ? Response.json({ room: updated }) : Response.json({ error: 'Room not found.' }, { status: 404 });
      }
      return Response.json({ error: 'Not found.' }, { status: 404 });
    }
    if (post && path === 'identity/recovery-code') {
      return Response.json({ code: await identity.createRecoveryCode(user.human_id) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (post && path === 'leave') {
      if (data.forget === 'true') await identity.forget(cookies);
      else await identity.remember(cookies, user.human_id, url.protocol === 'https:');
      await chat.leave(cookies, user); cookies.delete('chat_user_id', { path: '/' });
      return context.redirect('/join', 303);
    }
    if (!post && path === 'stream') return chat.stream(request, user, null);
    if (!post && path === 'rooms') return Response.json(await chat.rooms());
    if (post && path === 'rooms') {
      const name = String(data.name ?? '').trim(), description = String(data.description ?? '').trim();
      if (!name || name.length > 48 || description.length > 180) throw new Error('Use a room name up to 48 characters and a description up to 180.');
      const roomId = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 35) || 'room'}-${chat.id().slice(0, 6).toLowerCase()}`;
      const room = await chat.transaction(async client => {
        const { rows } = await client.query('INSERT INTO rooms(id,name,description,created_by) VALUES($1,$2,$3,$4) RETURNING *', [roomId, name, description, user.human_id]);
        await enqueueEvent(client, 'room.created', { roomId, humanId: user.human_id }); return rows[0];
      });
      chat.emit('newroom', { ...room, online: 0 });
      return Response.json({ room }, { status: 201 });
    }
    if (post && path === 'rename') {
      const name = chat.nickname(data.nickname);
      await chat.transaction(async client => {
        await client.query('UPDATE chat_profiles SET nickname=$1,updated_at=now() WHERE human_id=$2', [name, user.human_id]);
        await enqueueEvent(client, 'user.renamed', { humanId: user.human_id });
      });
      for (const [roomId, members] of chat.live.rooms) {
        const entry = members.get(user.human_id);
        if (entry) {
          entry.user = { ...entry.user, nickname: name };
          chat.emit('userlist', chat.people(roomId), roomId);
          await chat.systemMessage(roomId, `${user.nickname} is now ${name}`, 'rename');
        }
      }
      chat.emit('renamed', { humanId: user.human_id, nickname: name });
      return Response.json({ nickname: name });
    }
    if (!post && path === 'notifications') {
      const { rows } = await pool.query(`SELECT n.*,p.nickname,r.name AS room_name FROM notifications n
        LEFT JOIN chat_profiles p ON p.human_id=n.from_human_id JOIN rooms r ON r.id=n.room_id
        WHERE n.human_id=$1 AND NOT n.read ORDER BY n.created_at DESC LIMIT 50`, [user.human_id]);
      const { rows: counts } = await pool.query('SELECT count(*)::int AS count FROM notifications WHERE human_id=$1 AND NOT read', [user.human_id]);
      return Response.json({ notifications: rows, count: counts[0].count });
    }
    if (post && path === 'notifications/read') {
      await pool.query('UPDATE notifications SET read=true WHERE human_id=$1', [user.human_id]);
      chat.emit('notificationsread', {}, null, user.human_id);
      return new Response(null, { status: 204 });
    }
    const match = /^rooms\/([^/]+)\/(messages|history|stream|typing)$/.exec(path);
    if (match) {
      const [, roomId, action] = match;
      const exists = await pool.query('SELECT id FROM rooms WHERE id=$1', [roomId]);
      if (!exists.rowCount) return Response.json({ error: 'Room not found.' }, { status: 404 });
      if (!post && action === 'stream') return chat.stream(request, user, roomId);
      if (!post && action === 'history') return Response.json(await chat.history(roomId, url.searchParams));
      if (post && action === 'typing') { chat.typing(roomId, user, data.active !== false); return new Response(null, { status: 204 }); }
      if (post && action === 'messages') return Response.json(await chat.sendMessage(roomId, user, data.content), { status: 201 });
      return new Response(null, { status: 405 });
    }
    return Response.json({ error: 'Not found.' }, { status: 404 });
  } catch (error) {
    if (error.status) return Response.json({ error: error.message }, { status: error.status });
    if (error.code === '23505') return Response.json({ error: 'That nickname is already taken. Try another.' }, { status: 409 });
    if (error instanceof SyntaxError) return Response.json({ error: 'Invalid request.' }, { status: 400 });
    if (!error.code) return Response.json({ error: error.message }, { status: 400 });
    console.error('Chat request failed:', error.code);
    return Response.json({ error: 'Could not complete that request. Please try again.' }, { status: 500 });
  }
}
