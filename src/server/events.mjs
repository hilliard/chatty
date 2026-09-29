import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export function eventPayload(type, metadata = {}, id = randomUUID()) {
  if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(type) || type.length > 100) throw new Error('Invalid event type');
  return { channel: 'chatty', title: type, tags: ['chatty', 'api-v1'],
    metadata: { ...metadata, eventId: id, eventType: type, apiVersion: '1.0.0', occurredAt: new Date().toISOString() } };
}

// Pass the SAME transaction client used for the business write, before COMMIT.
export async function enqueueEvent(client, type, metadata = {}) {
  const id = randomUUID();
  const payload = eventPayload(type, metadata, id);
  await client.query('INSERT INTO event_outbox(id,payload) VALUES ($1,$2)', [id, payload]);
  return id;
}

export async function deliverEvent(payload, { url, key, fetchImpl = fetch }) {
  const endpoint = new URL('/api/events', url);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('Invalid dashboard URL');
  const response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error',
    headers: { 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
  await response.body?.cancel();
  if (response.status !== 201) throw new Error(`Dashboard HTTP ${response.status}`);
}

export async function startWorker() {
  const url = process.env.EVENT_DASHBOARD_URL;
  const key = process.env.EVENT_DASHBOARD_API_KEY;
  if (!url || !key) throw new Error('Dashboard URL and API key are required for the worker');
  const { pool } = await import('./db.mjs');
  let stopping = false;
  process.on('SIGTERM', () => { stopping = true; });
  process.on('SIGINT', () => { stopping = true; });
  try {
    while (!stopping) {
      const client = await pool.connect();
      let found = false;
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(`SELECT * FROM event_outbox
          WHERE delivered_at IS NULL AND next_attempt_at <= now()
          ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
        if (rows[0]) {
          found = true;
          const event = rows[0];
          try {
            await deliverEvent(event.payload, { url, key });
            await client.query('UPDATE event_outbox SET delivered_at=now(), last_error=NULL WHERE id=$1', [event.id]);
          } catch (error) {
            await client.query(`UPDATE event_outbox SET attempts=attempts+1, last_error=$2,
              next_attempt_at=now()+($3 * interval '1 second') WHERE id=$1`,
            [event.id, error.message.startsWith('Dashboard HTTP') ? error.message : 'Delivery failed', Math.min(3600, 2 ** Math.min(event.attempts + 1, 12))]);
          }
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
      if (!found) await delay(1000);
    }
  } finally { await pool.end(); }
}
