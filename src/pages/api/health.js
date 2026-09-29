import { pool } from '../../server/db.mjs';
export async function GET() {
  try {
    await pool.query('SELECT 1 FROM schema_migrations LIMIT 1');
    return Response.json({ status: 'ok', apiVersion: '1.0.0' });
  } catch { return Response.json({ status: 'unavailable' }, { status: 503 }); }
}
