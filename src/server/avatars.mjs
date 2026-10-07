import sharp from 'sharp';
import { pool } from './db.mjs';
import { enqueueEvent } from './events.mjs';
import { emit, live, transaction } from './chat.mjs';

const maxUploadBytes = 5 * 1024 * 1024;
const maxImageBytes = 256 * 1024;
const failure = (message, status = 400) => Object.assign(new Error(message), { status });

async function readUpload(request) {
  const declaredLength = Number(request.headers.get('content-length'));
  if (declaredLength > maxUploadBytes) throw failure('Choose an image smaller than 5 MB.', 413);
  if (!request.body) throw failure('Choose an image to upload.');
  const reader = request.body.getReader(), chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxUploadBytes) {
      await reader.cancel();
      throw failure('Choose an image smaller than 5 MB.', 413);
    }
    chunks.push(Buffer.from(value));
  }
  if (!length) throw failure('Choose an image to upload.');
  return Buffer.concat(chunks, length);
}

function announceAvatar(humanId, version) {
  for (const connection of live.clients) {
    if (connection.user.human_id === humanId) connection.user.avatar_version = version;
  }
  for (const [roomId, members] of live.rooms) {
    const person = members.get(humanId);
    if (!person) continue;
    person.user.avatar_version = version;
    emit('userlist', [...members.values()].map(entry => entry.user), roomId);
  }
  emit('avatarupdated', { humanId, version });
}

export async function saveAvatar(humanId, request) {
  const source = await readUpload(request);
  let image;
  try {
    const input = sharp(source, { limitInputPixels: 20_000_000, failOn: 'error' });
    const metadata = await input.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages ?? 1) > 1) {
      throw failure('Use a static JPEG, PNG, or WebP image.');
    }
    image = await input.rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
  } catch (error) {
    if (error.status) throw error;
    throw failure('That image could not be processed. Choose a JPEG, PNG, or WebP image.');
  }
  if (image.length > maxImageBytes) throw failure('That image could not be compressed. Choose a simpler image.');
  const { rows } = await transaction(async client => {
    const result = await client.query(`INSERT INTO chat_avatars(human_id,image) VALUES($1,$2)
      ON CONFLICT(human_id) DO UPDATE SET image=excluded.image,version=chat_avatars.version+1,updated_at=now()
      RETURNING version`, [humanId, image]);
    await enqueueEvent(client, 'user.avatar.updated', { humanId, version: result.rows[0].version });
    return result;
  });
  const version = rows[0].version;
  announceAvatar(humanId, version);
  return { version };
}

export async function removeAvatar(humanId) {
  const { rows } = await transaction(async client => {
    const result = await client.query('DELETE FROM chat_avatars WHERE human_id=$1 RETURNING version', [humanId]);
    if (result.rowCount) await enqueueEvent(client, 'user.avatar.removed', { humanId });
    return result;
  });
  if (!rows.length) return false;
  announceAvatar(humanId, null);
  return true;
}

export async function getAvatar(humanId) {
  const { rows } = await pool.query('SELECT image,version FROM chat_avatars WHERE human_id=$1', [humanId]);
  return rows[0] ?? null;
}