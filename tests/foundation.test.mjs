import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { parseMigration, migrationFiles } from '../scripts/migrate.mjs';
import { eventPayload, enqueueEvent, deliverEvent } from '../src/server/events.mjs';

test('migration convention requires number, semantic API version, and name', () => {
  assert.deepEqual(parseMigration('012-2.1.0-add-room-settings.sql'), {
    number: 12, apiVersion: '2.1.0', filename: '012-2.1.0-add-room-settings.sql',
  });
  for (const name of ['1-add.sql', '001-1-add.sql', '001-1.0.0-Bad.sql']) {
    assert.throws(() => parseMigration(name));
  }
});

test('checked-in migrations are ordered, checksummed, and runner-transactional', async () => {
  const files = await migrationFiles(new URL('../database/migrations/', import.meta.url));
  assert.deepEqual(files.map(f => f.number), [1, 2, 3, 4, 5, 6]);
  for (const file of files) {
    assert.match(file.checksum, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(file.sql, /^\s*(BEGIN|COMMIT);/mi);
  }
});

test('agent instructions remain identical', async () => {
  assert.equal(await readFile('AGENTS.md', 'utf8'), await readFile('CLAUDE.md', 'utf8'));
});

test('outbox uses the caller transaction and a stable event ID', async () => {
  let captured;
  const client = { query: async (sql, args) => { captured = { sql, args }; } };
  const id = await enqueueEvent(client, 'room.created', { roomId: 'lobby' });
  assert.match(captured.sql, /INSERT INTO event_outbox/);
  assert.equal(captured.args[0], id);
  assert.equal(captured.args[1].metadata.eventId, id);
  assert.equal(captured.args[1].metadata.roomId, 'lobby');
});

test('dashboard delivery sends the actual HTTP contract and rejects non-201 responses', async () => {
  let received;
  let status = 201;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received = { path: req.url, method: req.method, key: req.headers['x-api-key'], body: JSON.parse(body) };
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const options = { url: `http://127.0.0.1:${server.address().port}`, key: 'test-only-key' };
    const payload = eventPayload('message.sent', { roomId: 'lobby' });
    await deliverEvent(payload, options);
    assert.deepEqual(received, { path: '/api/events', method: 'POST', key: 'test-only-key', body: payload });
    status = 503;
    await assert.rejects(deliverEvent(payload, options), /Dashboard HTTP 503/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
