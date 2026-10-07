import { config } from 'dotenv';
import { spawn } from 'node:child_process';

const [mode, action] = process.argv.slice(2);
if (!['development', 'production'].includes(mode)) throw new Error('Invalid environment');
config({ path: `.env.${mode}`, quiet: true }); // Injected Coolify values take precedence.
process.env.NODE_ENV = mode;
process.env.PORT ||= '4324';
if (action === 'migrate') {
  const { migrate } = await import('./migrate.mjs');
  await migrate();
} else if (action === 'worker') {
  const { startWorker } = await import('../src/server/events.mjs');
  await startWorker();
} else if (action === 'smoke') {
  const { pool } = await import('../src/server/db.mjs');
  const { enqueueEvent } = await import('../src/server/events.mjs');
  try { await enqueueEvent(pool, 'integration.test', { source: 'events:smoke' }); }
  finally { await pool.end(); }
} else if (action === 'start' || action === 'dev') {
  if (action === 'dev') await import('./generate-api.mjs');
  if (action === 'start') {
    const { migrate } = await import('./migrate.mjs');
    await migrate();
  }
  const args = action === 'dev'
    ? ['node_modules/astro/bin/astro.mjs', 'dev', '--host', process.env.HOST || '127.0.0.1', '--port', process.env.PORT || '4324']
    : ['dist/server/entry.mjs'];
  const children = [spawn(process.execPath, args, { stdio: 'inherit' })];
  if (process.env.EVENT_DASHBOARD_API_KEY && process.env.EVENT_DASHBOARD_URL) {
    children.push(spawn(process.execPath, ['scripts/run.mjs', mode, 'worker'], { stdio: 'inherit' }));
  }
  let stopping = false;
  function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill('SIGTERM');
    process.exitCode = code;
  }
  for (const child of children) {
    child.on('error', () => stop(1));
    child.on('exit', code => stop(code ?? 1));
  }
  process.on('SIGINT', () => stop());
  process.on('SIGTERM', () => stop());
} else throw new Error('Unknown command');
