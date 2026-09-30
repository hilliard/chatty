import { appVersion } from './api-contract.mjs';
import migrations from './migration-manifest.json' with { type: 'json' };

export async function healthReport(database) {
  const report = { status: 'error', app_version: appVersion, db: 'down', db_synchronized: false, timestamp: new Date().toISOString() };
  try {
    await database.query({ text: 'SELECT 1', query_timeout: 3000 });
    report.db = 'up';
    const { rows } = await database.query({ text: 'SELECT number,filename,checksum,api_version FROM schema_migrations ORDER BY number', query_timeout: 3000 });
    report.db_synchronized = rows.length === migrations.length && migrations.every(expected => rows.some(actual => actual.number === expected.number && actual.filename === expected.filename && actual.checksum === expected.checksum && actual.api_version === expected.apiVersion));
    report.status = report.db_synchronized ? 'up' : 'error';
    return { body: report, status: report.db_synchronized ? 200 : 500 };
  } catch {
    report.status = report.db === 'down' ? 'down' : 'error';
    return { body: report, status: report.db === 'down' ? 503 : 500 };
  }
}
