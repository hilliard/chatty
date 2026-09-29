import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';

export function parseMigration(filename) {
  const match = /^(\d{3,})-(\d+\.\d+\.\d+)-([a-z0-9]+(?:-[a-z0-9]+)*)\.sql$/.exec(filename);
  if (!match || !Number.isSafeInteger(Number(match[1]))) throw new Error(`Invalid migration filename: ${filename}`);
  return { number: Number(match[1]), apiVersion: match[2], filename };
}

export async function migrationFiles(directory) {
  const files = (await readdir(directory)).filter(f => f.endsWith('.sql')).map(parseMigration).sort((a, b) => a.number - b.number);
  if (new Set(files.map(f => f.number)).size !== files.length) throw new Error('Duplicate migration number');
  return Promise.all(files.map(async file => {
    const sql = (await readFile(new URL(file.filename, directory), 'utf8')).replace(/\r\n/g, '\n');
    return { ...file, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
}

export async function migrate() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const files = await migrationFiles(new URL('../database/migrations/', import.meta.url));
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  let client;
  try {
    client = await pool.connect();
    await client.query('SELECT pg_advisory_lock(73482109)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      number INTEGER PRIMARY KEY, filename TEXT NOT NULL UNIQUE, api_version TEXT NOT NULL,
      checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const { rows } = await client.query('SELECT * FROM schema_migrations ORDER BY number');
    for (const row of rows) {
      const file = files.find(f => f.number === row.number);
      if (!file || file.filename !== row.filename || file.checksum !== row.checksum) throw new Error(`Applied migration missing or changed: ${row.filename}`);
    }
    for (const file of files) {
      if (rows.some(row => row.number === file.number)) continue;
      if (rows.some(row => row.number > file.number)) throw new Error(`Out-of-order migration: ${file.filename}`);
      await client.query('BEGIN');
      try {
        await client.query(file.sql);
        await client.query('INSERT INTO schema_migrations(number,filename,api_version,checksum) VALUES ($1,$2,$3,$4)',
          [file.number, file.filename, file.apiVersion, file.checksum]);
        await client.query('COMMIT');
        console.log(`Applied ${file.filename}`);
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
    console.log('Database migrations are up to date.');
  } finally {
    if (client) {
      try { await client.query('SELECT pg_advisory_unlock(73482109)'); }
      finally { client.release(); }
    }
    await pool.end();
  }
}
