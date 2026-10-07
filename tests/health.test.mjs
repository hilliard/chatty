import test from 'node:test';
import assert from 'node:assert/strict';
import { healthReport } from '../src/server/health.mjs';
import { appVersion, openapi, endpoints } from '../src/server/api-contract.mjs';
import manifest from '../src/server/migration-manifest.json' with { type: 'json' };

const applied = manifest.map(row => ({ ...row, api_version: row.apiVersion }));
test('health is up only when the database matches this build', async () => {
  const result = await healthReport({ query: async () => ({ rows: applied }) });
  assert.equal(result.status, 200); assert.equal(result.body.status, 'up');
  assert.equal(result.body.app_version, appVersion); assert.equal(result.body.db_synchronized, true);
});
test('missing, changed, or extra migrations produce error', async () => {
  for (const rows of [applied.slice(1), applied.map((row, i) => i ? row : { ...row, checksum: 'changed' }), [...applied, { number: 999 }]]) {
    const result = await healthReport({ query: async () => ({ rows }) });
    assert.equal(result.status, 500); assert.equal(result.body.status, 'error'); assert.equal(result.body.db, 'up');
  }
});
test('unreachable database produces down without exposing errors', async () => {
  const result = await healthReport({ query: async () => { throw new Error('private connection information'); } });
  assert.equal(result.status, 503); assert.equal(result.body.status, 'down');
  assert.equal(result.body.db, 'down'); assert.ok(!JSON.stringify(result).includes('private'));
});
test('schema inspection failure produces error after connectivity succeeds', async () => {
  let calls = 0;
  const result = await healthReport({ query: async () => { if (calls++) throw new Error('missing table'); return {}; } });
  assert.equal(result.status, 500); assert.equal(result.body.status, 'error'); assert.equal(result.body.db, 'up');
});
test('OpenAPI version and operations match the shared contract', () => {
  assert.equal(openapi.info.version, appVersion);
  for (const endpoint of endpoints) assert.equal(openapi.paths[endpoint.path][endpoint.method].summary, endpoint.summary);
});
test('admin management operations require a session and administrator role', () => {
  const adminEndpoints = endpoints.filter(endpoint => endpoint.auth === 'admin');
  assert.ok(adminEndpoints.length >= 8);
  for (const endpoint of adminEndpoints) {
    const operation = openapi.paths[endpoint.path][endpoint.method];
    assert.deepEqual(operation.security, [{ chatSession: [] }]);
    assert.ok(operation.responses['403']);
  }
  assert.ok(endpoints.some(endpoint => endpoint.path === '/api/admin/users/{humanId}/role'));
  assert.ok(endpoints.some(endpoint => endpoint.path === '/api/admin/rooms/{roomId}/delete'));
});
