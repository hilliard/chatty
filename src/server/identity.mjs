import { randomBytes, createHash } from 'node:crypto';
import { pool } from './db.mjs';
import { enqueueEvent } from './events.mjs';
import { colors, id, nickname, transaction } from './chat.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const valid = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(value);
const cookieOptions = secure => ({ path: '/', httpOnly: true, sameSite: 'strict', secure, maxAge: 30 * 24 * 3600 });

export async function rememberedUser(cookies) {
  const token = cookies.get('chat_remember')?.value;
  if (!valid(token)) return null;
  const { rows } = await pool.query(`SELECT p.human_id,p.nickname FROM remembered_browsers b
    JOIN chat_profiles p ON p.human_id=b.human_id WHERE b.token_hash=$1 AND b.expires_at>now() AND p.account_status <> 'blocked'`, [hash(token)]);
  return rows[0] || null;
}

export async function remember(cookies, humanId, secure) {
  const token = secret(), old = cookies.get('chat_remember')?.value;
  await transaction(async client => {
    if (valid(old)) await client.query('DELETE FROM remembered_browsers WHERE token_hash=$1', [hash(old)]);
    await client.query("INSERT INTO remembered_browsers VALUES($1,$2,now()+interval '30 days')", [hash(token), humanId]);
  });
  cookies.set('chat_remember', token, cookieOptions(secure));
}

export async function forget(cookies) {
  const token = cookies.get('chat_remember')?.value;
  if (valid(token)) await pool.query('DELETE FROM remembered_browsers WHERE token_hash=$1', [hash(token)]);
  cookies.delete('chat_remember', { path: '/' });
}

export async function restore(cookies, secure, code) {
  const token = secret(), deviceToken = secret();
  const oldDevice = cookies.get('chat_remember')?.value;
  await transaction(async client => {
    let humanId;
    if (code !== undefined) {
      const normalized = typeof code === 'string' ? code.trim() : '';
      if (!valid(normalized)) throw new Error('That recovery code is not valid.');
      // Codes remain usable until replaced; storage contains only their hashes.
      const { rows } = await client.query(`SELECT r.human_id FROM recovery_codes r JOIN chat_profiles p ON p.human_id=r.human_id
        WHERE r.code_hash=$1 AND p.account_status <> 'blocked' FOR UPDATE OF r`, [hash(normalized)]);
      humanId = rows[0]?.human_id;
    } else if (valid(oldDevice)) {
      const { rows } = await client.query(`SELECT b.human_id FROM remembered_browsers b JOIN chat_profiles p ON p.human_id=b.human_id
        WHERE b.token_hash=$1 AND b.expires_at>now() AND p.account_status <> 'blocked' FOR UPDATE OF b`, [hash(oldDevice)]);
      humanId = rows[0]?.human_id;
    }
    if (!humanId) throw new Error('Could not restore this identity. Use your recovery code or choose a new nickname.');
    const previousSession = cookies.get('chat_user_id')?.value;
    if (valid(previousSession)) await client.query('DELETE FROM browser_sessions WHERE token_hash=$1', [hash(previousSession)]);
    if (valid(oldDevice)) await client.query('DELETE FROM remembered_browsers WHERE token_hash=$1', [hash(oldDevice)]);
    await client.query("INSERT INTO browser_sessions VALUES($1,$2,now()+interval '30 days')", [hash(token), humanId]);
    await client.query("INSERT INTO remembered_browsers VALUES($1,$2,now()+interval '30 days')", [hash(deviceToken), humanId]);
  });
  cookies.set('chat_user_id', token, { ...cookieOptions(secure), sameSite: 'lax' });
  cookies.set('chat_remember', deviceToken, cookieOptions(secure));
}

export async function createRecoveryCode(humanId) {
  const code = secret();
  await pool.query(`INSERT INTO recovery_codes(human_id,code_hash) VALUES($1,$2)
    ON CONFLICT(human_id) DO UPDATE SET code_hash=excluded.code_hash,created_at=now()`, [humanId, hash(code)]);
  return code;
}

export async function createManagedIdentity(value) {
  const humanId = id(), name = nickname(value), color = colors[Math.floor(Math.random() * colors.length)], code = secret();
  await transaction(async client => {
    await client.query('INSERT INTO humans(id) VALUES($1)', [humanId]);
    await client.query('INSERT INTO chat_profiles(human_id,nickname,color) VALUES($1,$2,$3)', [humanId, name, color]);
    await client.query('INSERT INTO recovery_codes(human_id,code_hash) VALUES($1,$2)', [humanId, hash(code)]);
    await enqueueEvent(client, 'user.created', { humanId });
  });
  return { user: { human_id: humanId, nickname: name, color, role: 'user', account_status: 'active' }, recoveryCode: code };
}
