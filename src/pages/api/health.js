import { pool } from '../../server/db.mjs';
import { healthReport } from '../../server/health.mjs';
export async function GET() {
  const result = await healthReport(pool);
  return Response.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
}
