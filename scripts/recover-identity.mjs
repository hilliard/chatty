// Local administrator recovery for a legacy identity; never exposed over HTTP.
import { config } from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
config({ path: '.env.development', quiet: true });
const { pool } = await import('../src/server/db.mjs');
const { createRecoveryCode } = await import('../src/server/identity.mjs');
const name = process.argv[2];
try {
  if (!name || !/^[a-zA-Z0-9_.-]{2,24}$/.test(name)) throw new Error('Provide a nickname.');
  const { rows } = await pool.query('SELECT human_id,nickname FROM chat_profiles WHERE lower(nickname)=lower($1) AND human_id<>\'system\'', [name]);
  if (!rows[0]) throw new Error('Nickname not found.');
  const existing = await pool.query('SELECT human_id FROM recovery_codes WHERE human_id=$1', [rows[0].human_id]);
  if (existing.rowCount) throw new Error('This identity already has a recovery code; use its existing code or an authenticated session.');
  const code = await createRecoveryCode(rows[0].human_id);
  await mkdir('.recovery', { recursive: true });
  const path = `.recovery/${name.toLowerCase()}.txt`;
  await writeFile(path, `Recovery code for ${rows[0].nickname}\n\n${code}\n\nOn /join, open “Already have a nickname? Use a recovery code” and paste the code.\nStore privately. Anyone with this code can sign in as you.\n`, { mode: 0o600, flag: 'wx' });
  console.log(`Saved recovery instructions to ${path}. The code was not printed.`);
} finally { await pool.end(); }
