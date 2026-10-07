import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import sharp from 'sharp';
import { config } from 'dotenv';
import { migrate } from './migrate.mjs';
import { appVersion, endpoints, markdownDocs } from '../src/server/api-contract.mjs';

config({ path: '.env.development', quiet: true });
const suite = process.argv[2] === 'e2e' ? 'e2e' : 'api';
const results = [], schema = `chatty_test_${Date.now()}`, streams = [];
const rootPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let server, base, testPool;
async function startServer(port) {
  server = spawn(process.execPath, ['dist/server/entry.mjs'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; server.stdout.on('data', data => { output += data; }); server.stderr.on('data', data => { output += data; });
  for (let tries = 0; tries < 100; tries++) {
    try { const response = await fetch(`${base}/api/health`); if (response.ok) return; } catch {}
    if (server.exitCode !== null || tries === 99) throw new Error(`Test server failed to start: ${output.slice(-1500)}`);
    await delay(100);
  }
}
async function check(name, work) {
  try { await work(); results.push({ name, pass: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, pass: false }); throw error; }
}
async function client(name) {
  const response = await fetch(`${base}/api/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: name }), redirect: 'manual' });
  assert.equal(response.status, 303);
  const cookie = response.headers.getSetCookie().find(value => value.startsWith('chat_user_id=')).split(';')[0];
  assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
  return { cookie, async request(path, data) {
    return fetch(`${base}/api/${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { cookie, 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), redirect: 'manual' });
  } };
}
async function connect(peer, room) {
  const controller = new AbortController(), events = [];
  const response = await fetch(`${base}/api/rooms/${room}/stream`, { headers: { cookie: peer.cookie }, signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const done = (async () => {
    let buffer = '';
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const type = /^event: (.*)$/m.exec(frame)?.[1], data = /^data: (.*)$/m.exec(frame)?.[1];
          if (type && data) events.push({ type, data: JSON.parse(data) });
        }
      }
    } catch (error) { if (!controller.signal.aborted) throw error; }
  })();
  const stream = { events, close: async () => { controller.abort(); await done; }, async wait(type, predicate = () => true, timeout = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeout) { const event = events.find(e => e.type === type && predicate(e.data)); if (event) return event.data; await delay(25); }
    throw new Error(`Timed out waiting for ${type}`);
  } };
  streams.push(stream); await stream.wait('ready'); return stream;
}
try {
  await rootPool.query(`CREATE SCHEMA ${schema}`);
  const connection = new URL(process.env.DATABASE_URL); connection.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = connection.toString();
  await migrate();
  testPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); base = `http://127.0.0.1:${port}`;
  await startServer(port);
  const alice = await client('Alice'), bob = await client('Bob');
  const created = await alice.request('rooms', { name: 'Test studio', description: 'Isolated acceptance test room' });
  assert.equal(created.status, 201); const room = (await created.json()).room.id;
  if (suite === 'api') {
    await check('Public docs, OpenAPI, health and favicon match the running release', async () => {
      const docs = await fetch(`${base}/api/docs`); assert.equal(docs.status, 200);
      const html = await docs.text(); assert.ok(html.includes(`API v${appVersion}`)); assert.ok(html.includes('/favicon.svg'));
      const spec = await (await fetch(`${base}/api/docs/openapi.json`)).json(); assert.equal(spec.info.version, appVersion);
      for (const endpoint of endpoints) assert.ok(spec.paths[endpoint.path]?.[endpoint.method]);
      const health = await fetch(`${base}/api/health`); assert.equal(health.status, 200);
      const report = await health.json(); assert.equal(report.app_version, appVersion); assert.equal(report.status, 'up'); assert.equal(report.db_synchronized, true);
      const favicon = await fetch(`${base}/favicon.svg`); assert.equal(favicon.status, 200); assert.match(await favicon.text(), /#b4a0ff/);
    });
    await check('Anonymous pages redirect and API writes require a session', async () => {
      const page = await fetch(`${base}/rooms/lobby`, { redirect: 'manual' }); assert.equal(page.status, 302);
      const response = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(response.status, 401);
    });
    await check('Nickname uniqueness is case-insensitive and system names are reserved', async () => {
      for (const name of ['alice', 'system', 'everyone']) {
        const response = await fetch(`${base}/api/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: name }), redirect: 'manual' });
        assert.ok([400, 409].includes(response.status));
      }
    });
    await check('Chat UI renders and room creation persists', async () => {
      const response = await fetch(`${base}/rooms/${room}`, { headers: { cookie: alice.cookie } });
      assert.equal(response.status, 200); assert.match(await response.text(), /Test studio/);
      const list = await (await bob.request('rooms')).json(); assert.ok(list.some(r => r.id === room));
    });
    await check('Avatar uploads are normalized, authenticated, and removable', async () => {
      const { rows } = await testPool.query("SELECT human_id FROM chat_profiles WHERE nickname='Bob'");
      const humanId = rows[0].human_id;
      const source = await sharp({ create: { width: 512, height: 384, channels: 3, background: '#4a8' } }).png().toBuffer();
      assert.equal((await fetch(`${base}/api/avatar`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: source })).status, 401);
      const uploaded = await fetch(`${base}/api/avatar`, { method: 'POST', headers: { cookie: bob.cookie, 'Content-Type': 'image/png' }, body: source });
      assert.equal(uploaded.status, 200);
      const { version } = await uploaded.json(); assert.equal(version, 1);
      const ownPage = await fetch(`${base}/rooms/${room}`, { headers: { cookie: bob.cookie } });
      assert.match(await ownPage.text(), new RegExp(`/api/avatars/${humanId}\\?v=1`));
      const imageResponse = await alice.request(`avatars/${humanId}?v=${version}`);
      assert.equal(imageResponse.status, 200); assert.match(imageResponse.headers.get('content-type'), /image\/webp/);
      const metadata = await sharp(Buffer.from(await imageResponse.arrayBuffer())).metadata();
      assert.equal(metadata.format, 'webp'); assert.equal(metadata.width, 256); assert.equal(metadata.height, 256);
      const invalid = await fetch(`${base}/api/avatar`, { method: 'POST', headers: { cookie: bob.cookie, 'Content-Type': 'image/png' }, body: Buffer.from('not an image') });
      assert.equal(invalid.status, 400);
      assert.equal((await bob.request('avatar/delete', {})).status, 204);
      assert.equal((await alice.request(`avatars/${humanId}?v=${version}`)).status, 404);
    });
    await check('Administrator user and room management is authorized and persistent', async () => {
      await testPool.query("UPDATE chat_profiles SET role='admin' WHERE nickname='Alice'");
      const { rows: aliceRows } = await testPool.query("SELECT human_id FROM chat_profiles WHERE nickname='Alice'");
      assert.equal((await (await alice.request('admin/users')).json()).some(user => user.nickname === 'Bob'), true);
      assert.equal((await bob.request('admin/users')).status, 403);
      assert.equal((await alice.request(`admin/users/${aliceRows[0].human_id}/role`, { role: 'user' })).status, 409);
      const adminPage = await fetch(`${base}/admin`, { headers: { cookie: alice.cookie } });
      assert.equal(adminPage.status, 200); assert.match(await adminPage.text(), /Manage users/);

      const createdResponse = await alice.request('admin/users', { nickname: 'ManagedUser' });
      assert.equal(createdResponse.status, 201); assert.match(createdResponse.headers.get('cache-control'), /no-store/i);
      const created = await createdResponse.json(); assert.ok(created.recoveryCode);
      const restored = await fetch(`${base}/api/identity/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: created.recoveryCode }) });
      assert.equal(restored.status, 200);
      const makeManagedClient = cookie => ({ cookie, request: (path, data) => fetch(`${base}/api/${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { cookie, 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), redirect: 'manual' }) });
      let managed = makeManagedClient(restored.headers.getSetCookie().find(value => value.startsWith('chat_user_id=')).split(';')[0]);
      const promoted = await alice.request(`admin/users/${created.user.human_id}/role`, { role: 'admin' });
      assert.equal(promoted.status, 200, await promoted.text());
      assert.equal((await managed.request('admin/rooms')).status, 200);
      assert.equal((await alice.request(`admin/users/${created.user.human_id}/rename`, { nickname: 'ManagedRenamed' })).status, 200);
      assert.equal((await alice.request(`admin/users/${created.user.human_id}/status`, { status: 'set_for_deletion' })).status, 200);
      let users = await (await alice.request('admin/users')).json();
      assert.equal(users.find(user => user.human_id === created.user.human_id).account_status, 'set_for_deletion');
      assert.equal((await alice.request(`admin/users/${created.user.human_id}/status`, { status: 'active' })).status, 200);
      assert.equal((await alice.request(`admin/users/${created.user.human_id}/role`, { role: 'user' })).status, 200);
      assert.equal((await alice.request(`admin/users/${created.user.human_id}/status`, { status: 'blocked' })).status, 200);
      assert.equal((await managed.request('rooms')).status, 401);
      assert.equal((await fetch(`${base}/api/identity/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: created.recoveryCode }) })).status, 400);
      assert.equal((await alice.request(`admin/users/${created.user.human_id}/status`, { status: 'active' })).status, 200);
      const restoredAfterUnblock = await fetch(`${base}/api/identity/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: created.recoveryCode }) });
      assert.equal(restoredAfterUnblock.status, 200);
      managed = makeManagedClient(restoredAfterUnblock.headers.getSetCookie().find(value => value.startsWith('chat_user_id=')).split(';')[0]);

      const createdRoomResponse = await alice.request('admin/rooms', { name: 'Admin studio', description: 'Created in admin' });
      assert.equal(createdRoomResponse.status, 201);
      const managedRoom = (await createdRoomResponse.json()).room;
      assert.equal((await alice.request(`admin/rooms/${managedRoom.id}`, { name: 'Updated studio', description: 'Updated in admin' })).status, 200);
      const listedRooms = await (await alice.request('admin/rooms')).json();
      assert.equal(listedRooms.find(item => item.id === managedRoom.id).name, 'Updated studio');
      assert.equal((await alice.request('admin/rooms/lobby/delete', { confirm: true })).status, 400);
      assert.equal((await alice.request(`admin/rooms/${managedRoom.id}/delete`, { confirm: true })).status, 200);

      assert.equal((await managed.request(`rooms/${room}/messages`, { content: 'message to be erased' })).status, 201);
      assert.equal((await alice.request(`admin/users/${created.user.human_id}/delete`, { confirm: true })).status, 200);
      const history = await (await alice.request(`rooms/${room}/history`)).json();
      assert.ok(!history.messages.some(message => message.content === 'message to be erased'));
      assert.equal((await managed.request('rooms')).status, 401);
    });
    await check('Message identity comes from the session and text remains inert', async () => {
      const sent = await alice.request(`rooms/${room}/messages`, { content: '<script>alert(1)</script> @Bob hello', human_id: 'system' }); assert.equal(sent.status, 201);
      const message = await sent.json(); assert.equal(message.nickname, 'Alice'); assert.notEqual(message.human_id, 'system');
      const history = await (await bob.request(`rooms/${room}/history`)).json(); assert.equal(history.messages[0].content, '<script>alert(1)</script> @Bob hello');
    });
    await check('Mentions persist, stay private, and can be marked read', async () => {
      const bobNotes = await (await bob.request('notifications')).json(); assert.equal(bobNotes.count, 1);
      const aliceNotes = await (await alice.request('notifications')).json(); assert.equal(aliceNotes.count, 0);
      assert.equal((await bob.request('notifications/read', {})).status, 204);
      assert.equal((await (await bob.request('notifications')).json()).count, 0);
    });
    await check('Pagination loads all messages without overlap', async () => {
      for (let i = 0; i < 52; i++) assert.equal((await alice.request(`rooms/${room}/messages`, { content: `message ${i}` })).status, 201);
      const latest = await (await alice.request(`rooms/${room}/history`)).json(); assert.equal(latest.messages.length, 50); assert.equal(latest.more, true);
      const earlier = await (await alice.request(`rooms/${room}/history?before=${encodeURIComponent(latest.messages[0].cursor)}`)).json(); assert.equal(earlier.messages.length, 3);
      assert.equal(new Set([...latest.messages, ...earlier.messages].map(m => m.id)).size, 53);
    });
    await check('Rename keeps identity; logout invalidates the cookie', async () => {
      assert.equal((await alice.request('rename', { nickname: 'AliceNew' })).status, 200);
      assert.equal((await alice.request('leave', {})).status, 303);
      assert.equal((await alice.request('rooms')).status, 401);
    });
    await check('Remembered-browser login restores the same identity after logout', async () => {
      const response = await bob.request('leave', {});
      const rememberedCookie = response.headers.getSetCookie().find(value => value.startsWith('chat_remember=')).split(';')[0];
      assert.equal((await bob.request('rooms')).status, 401);
      const restored = await fetch(`${base}/api/identity/restore`, { method: 'POST', headers: { cookie: rememberedCookie, 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(restored.status, 200);
      const newCookie = restored.headers.getSetCookie().find(value => value.startsWith('chat_user_id=')).split(';')[0];
      const page = await fetch(`${base}/rooms/lobby`, { headers: { cookie: newCookie } }); assert.match(await page.text(), /Bob/);
      const replay = await fetch(`${base}/api/identity/restore`, { method: 'POST', headers: { cookie: rememberedCookie, 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(replay.status, 400);
    });
    await check('Recovery codes work on another browser and old codes stop working after replacement', async () => {
      const peer = await client('Recoverable');
      const first = await (await peer.request('identity/recovery-code', {})).json();
      const second = await (await peer.request('identity/recovery-code', {})).json();
      const restoreCode = code => fetch(`${base}/api/identity/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      assert.equal((await restoreCode(first.code)).status, 400);
      assert.equal((await restoreCode('invalid')).status, 400);
      const recovered = await restoreCode(second.code); assert.equal(recovered.status, 200);
      const cookie = recovered.headers.getSetCookie().find(value => value.startsWith('chat_user_id=')).split(';')[0];
      const page = await fetch(`${base}/rooms/lobby`, { headers: { cookie } }); assert.match(await page.text(), /Recoverable/);
      const remembered = recovered.headers.getSetCookie().find(value => value.startsWith('chat_remember=')).split(';')[0];
      assert.equal((await fetch(`${base}/api/identity/forget`, { method: 'POST', headers: { cookie: remembered, 'Content-Type': 'application/json' }, body: '{}' })).status, 200);
      assert.equal((await fetch(`${base}/api/identity/restore`, { method: 'POST', headers: { cookie: remembered, 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
      assert.equal((await fetch(`${base}/api/identity/recovery-code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    });
  } else {
    const a = await connect(alice, room), b = await connect(bob, room);
    await check('Two independent sessions see each other online', async () => { await a.wait('userlist', users => users.length === 2); await b.wait('userlist', users => users.length === 2); });
    await check('Avatar changes propagate to connected room members', async () => {
      const { rows } = await testPool.query("SELECT human_id FROM chat_profiles WHERE nickname='Alice'");
      const humanId = rows[0].human_id;
      const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#6a4' } }).png().toBuffer();
      const uploaded = await fetch(`${base}/api/avatar`, { method: 'POST', headers: { cookie: alice.cookie, 'Content-Type': 'image/png' }, body: image });
      assert.equal(uploaded.status, 200); const { version } = await uploaded.json();
      await b.wait('avatarupdated', data => data.humanId === humanId && data.version === version);
      await a.wait('userlist', users => users.some(user => user.human_id === humanId && user.avatar_version === version));
      assert.equal((await alice.request('avatar/delete', {})).status, 204);
      await b.wait('avatarupdated', data => data.humanId === humanId && data.version === null);
      await a.wait('userlist', users => users.some(user => user.human_id === humanId && user.avatar_version === null));
    });
    await check('Messages arrive live in both directions', async () => {
      await alice.request(`rooms/${room}/messages`, { content: 'Hello Bob' }); await b.wait('message', m => m.content === 'Hello Bob');
      await bob.request(`rooms/${room}/messages`, { content: 'Hello Alice' }); await a.wait('message', m => m.content === 'Hello Alice');
    });
    await check('Typing appears and expires after two seconds', async () => {
      const start = a.events.length; await bob.request(`rooms/${room}/typing`, { active: true }); await a.wait('typing', users => users.some(u => u.nickname === 'Bob'));
      await delay(2600); assert.ok(a.events.slice(start).some(e => e.type === 'typing' && e.data.length === 0));
    });
    await check('Other room messages never enter this room stream', async () => {
      const other = (await (await alice.request('rooms', { name: 'Other room' })).json()).room.id;
      await bob.request(`rooms/${other}/messages`, { content: 'PRIVATE-TO-OTHER-ROOM' }); await delay(200);
      assert.ok(!a.events.some(e => e.type === 'message' && e.data.content === 'PRIVATE-TO-OTHER-ROOM'));
    });
    await check('Mentions emit a private live notification', async () => { await alice.request(`rooms/${room}/messages`, { content: '@Bob a mention for you' }); await b.wait('mention'); assert.ok(!a.events.some(e => e.type === 'mention')); });
    await check('Reconnect preserves presence and history catches missed messages', async () => {
      const page = await (await bob.request(`rooms/${room}/history`)).json(), cursor = page.messages.at(-1).cursor;
      await b.close(); await alice.request(`rooms/${room}/messages`, { content: 'While Bob was away' });
      const reconnected = await connect(bob, room); await reconnected.wait('userlist', users => users.length === 2);
      const history = await (await bob.request(`rooms/${room}/history?after=${encodeURIComponent(cursor)}`)).json(); assert.ok(history.messages.some(m => m.content === 'While Bob was away'));
      assert.ok(!a.events.some(e => e.type === 'message' && e.data.content === 'Bob left the room'));
      assert.equal(a.events.filter(e => e.type === 'message' && e.data.content === 'Bob joined the room').length, 1);
    });
    await check('A closed session leaves only after the 60-second grace period', async () => {
      await streams.at(-1).close();
      await delay(1500);
      assert.ok(!a.events.some(e => e.type === 'message' && e.data.content === 'Bob left the room'));
      await a.wait('message', message => message.content === 'Bob left the room', 64000);
      await a.wait('presence', p => p.count === 1);
    });
    await check('Server restart retains messages and accepts both sessions again', async () => {
      const before = await (await alice.request(`rooms/${room}/history`)).json();
      for (const stream of streams) await stream.close();
      const stopped = once(server, 'exit'); server.kill(); await stopped;
      await startServer(port);
      const after = await (await alice.request(`rooms/${room}/history`)).json();
      assert.deepEqual(after.messages.map(m => m.id), before.messages.map(m => m.id));
      const a2 = await connect(alice, room), b2 = await connect(bob, room);
      await a2.wait('userlist', users => users.length === 2);
      await alice.request(`rooms/${room}/messages`, { content: 'After server restart' });
      await b2.wait('message', message => message.content === 'After server restart');
    });
  }
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  for (const stream of streams) await stream.close().catch(() => {});
  if (server && server.exitCode === null) { const stopped = once(server, 'exit'); server.kill(); await stopped; }
  await testPool?.end();
  await rootPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await rootPool.end();
  await mkdir('docs', { recursive: true });
  if (suite === 'api') await writeFile('docs/api.md', markdownDocs());
  await writeFile(`docs/${suite}-tests.md`, `# ${suite === 'api' ? 'API' : 'Live transport end-to-end'} verification\n\nGenerated by npm run test:${suite} for Chatty v${appVersion}. Uses the production build with an isolated temporary PostgreSQL schema.\n\n${results.map(r => `- [${r.pass ? 'x' : ' '}] ${r.name}`).join('\n')}\n\nResult: ${process.exitCode ? 'FAILED' : 'PASSED'}.\n${suite === 'e2e' ? '\nThese are HTTP/SSE end-to-end tests using two independent sessions, not automated browser tests. Browser appearance, native EventSource reconnect, and interactions are checked separately.\n' : ''}`);
}
