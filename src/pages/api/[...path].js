import { pool } from '../../server/db.mjs';
import { enqueueEvent } from '../../server/events.mjs';
import * as chat from '../../server/chat.mjs';
import * as identity from '../../server/identity.mjs';

export async function ALL(context) {
  const { request, url, locals, cookies } = context;
  const path = context.params.path, user = locals.user, post = request.method === 'POST';
  if (!post && request.method !== 'GET') return new Response(null, { status: 405 });
  try {
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
    if (error.code === '23505') return Response.json({ error: 'That nickname is already taken. Try another.' }, { status: 409 });
    if (error instanceof SyntaxError) return Response.json({ error: 'Invalid request.' }, { status: 400 });
    if (!error.code) return Response.json({ error: error.message }, { status: 400 });
    console.error('Chat request failed:', error.code);
    return Response.json({ error: 'Could not complete that request. Please try again.' }, { status: 500 });
  }
}
