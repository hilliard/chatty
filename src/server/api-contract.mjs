import packageInfo from '../../package.json' with { type: 'json' };
export const appVersion = packageInfo.version;
export const endpoints = [
  ['get', '/api/health', 'System', 'Check service and database health', 'public', null, '200: up; 503: down; 500: error. Includes app_version, db, db_synchronized, timestamp.'],
  ['get', '/api/docs', 'System', 'Read versioned API documentation', 'public', null, '200: HTML documentation.'],
  ['get', '/api/docs/openapi.json', 'System', 'Download the OpenAPI contract', 'public', null, '200: OpenAPI 3.1 JSON.'],
  ['post', '/api/join', 'Identity', 'Create a nickname identity', 'public', { nickname: 'string' }, '303: sets HttpOnly session and remembered-browser cookies; redirects to /rooms/lobby. 409: nickname taken.'],
  ['post', '/api/leave', 'Identity', 'Log out of the current session', 'session', { forget: 'string (optional; "true" also forgets this browser)' }, '303: clears session cookie and redirects to /join.'],
  ['post', '/api/rename', 'Identity', 'Change your nickname', 'session', { nickname: 'string' }, '200: { nickname }. 409: nickname taken. Broadcasts rename events.'],
  ['post', '/api/identity/restore', 'Identity', 'Restore a remembered or recovered identity', 'public', { code: 'string (optional; omit to use chat_remember cookie)' }, '200: { ok: true }; sets fresh cookies. 400: invalid or expired credential. Nickname alone never authenticates.'],
  ['post', '/api/identity/forget', 'Identity', 'Forget this browser', 'public', {}, '200: { ok: true }; revokes chat_remember cookie. Does not end an active session.'],
  ['post', '/api/identity/recovery-code', 'Identity', 'Create or replace your recovery code', 'session', {}, '200: { code }. Replaces the previous code. Response is not cacheable; save privately.'],
  ['post', '/api/avatar', 'Identity', 'Upload your profile avatar', 'session', {}, '200: { version }. Accepts JPEG, PNG, or WebP image bytes up to 5 MB; images are normalized to 256px WebP.'],
  ['post', '/api/avatar/delete', 'Identity', 'Remove your profile avatar', 'session', {}, '204: no body. Restores the nickname initials avatar.'],
  ['get', '/api/avatars/{humanId}', 'Identity', 'Read an authenticated user avatar', 'session', null, '200: versioned image/webp bytes. 404: no avatar.'],
  ['get', '/api/rooms', 'Rooms', 'List rooms and online counts', 'session', null, '200: array of rooms, each with online count.'],
  ['post', '/api/rooms', 'Rooms', 'Create a room', 'session', { name: 'string (1–48 characters)', description: 'string (optional; up to 180 characters)' }, '201: { room }. Broadcasts newroom.'],
  ['get', '/api/rooms/{id}/history', 'Messages', 'Load saved messages', 'session', null, '200: { messages, more }. Up to 50 messages in chronological order. Use before or after with the opaque cursor returned on each message; do not supply both.'],
  ['post', '/api/rooms/{id}/messages', 'Messages', 'Send a message and create mentions', 'session', { content: 'string (1–4,000 characters)' }, '201: saved message. Author comes from the session, never the request body.'],
  ['post', '/api/rooms/{id}/typing', 'Live', 'Update your typing state', 'session', { active: 'boolean (optional; defaults to true)' }, '204: no body. Typing expires after two seconds.'],
  ['get', '/api/rooms/{id}/stream', 'Live', 'Subscribe to a room', 'session', null, '200: text/event-stream. Room messages, presence, userlist, typing, private mentions, and global room updates.'],
  ['get', '/api/stream', 'Live', 'Subscribe to community updates', 'session', null, '200: text/event-stream. Global presence counts, newroom, renamed, private mentions, notificationsread. Does not join a room.'],
  ['get', '/api/notifications', 'Notifications', 'List your unread mentions', 'session', null, '200: { notifications, count }. Up to 50 latest unread mentions and total unread count.'],
  ['post', '/api/notifications/read', 'Notifications', 'Mark all your mentions read', 'session', {}, '204: no body. Broadcasts notificationsread to your sessions.'],
  ['get', '/api/admin/users', 'Administration', 'List managed users', 'admin', null, '200: users with role and account status.'],
  ['post', '/api/admin/users', 'Administration', 'Create a user and one-time recovery code', 'admin', { nickname: 'string' }, '201: { user, recoveryCode }. Share the recovery code privately; it is shown only once.'],
  ['post', '/api/admin/users/{humanId}/rename', 'Administration', 'Change a user nickname', 'admin', { nickname: 'string' }, '200: updated user.'],
  ['post', '/api/admin/users/{humanId}/role', 'Administration', 'Change a user role', 'admin', { role: 'string (user or admin)' }, '200: updated user. The last administrator cannot be demoted.'],
  ['post', '/api/admin/users/{humanId}/status', 'Administration', 'Block, restore, or schedule deletion for a user', 'admin', { status: 'string (active, blocked, or set_for_deletion)' }, '200: updated user. Scheduled deletion is permanent after 30 days.'],
  ['post', '/api/admin/users/{humanId}/delete', 'Administration', 'Permanently delete a user and authored messages', 'admin', { confirm: 'boolean (required)' }, '200: { ok }. Explicit confirmation is required.'],
  ['get', '/api/admin/rooms', 'Administration', 'List managed rooms', 'admin', null, '200: rooms.'],
  ['post', '/api/admin/rooms', 'Administration', 'Create a room', 'admin', { name: 'string (1–48 characters)', description: 'string (optional; up to 180 characters)' }, '201: { room }.'],
  ['post', '/api/admin/rooms/{roomId}', 'Administration', 'Rename a room or update its description', 'admin', { name: 'string (1–48 characters)', description: 'string (optional; up to 180 characters)' }, '200: { room }.'],
  ['post', '/api/admin/rooms/{roomId}/delete', 'Administration', 'Delete a room and its messages', 'admin', { confirm: 'boolean (required)' }, '200: { ok }. Lobby cannot be deleted.'],
].map(([method, path, group, summary, auth, body, result]) => ({ method, path, group, summary, auth, body, result }));

export const openapi = {
  openapi: '3.1.0',
  info: { title: 'Chatty API', version: appVersion, description: 'Cookie-authenticated live chat. Send JSON for POST requests; join and leave also support URL-encoded forms. Errors use { error: string }. Documentation version follows package.json.' },
  servers: [{ url: '/' }],
  tags: [...new Set(endpoints.map(e => e.group))].map(name => ({ name })),
  components: {
    securitySchemes: { chatSession: { type: 'apiKey', in: 'cookie', name: 'chat_user_id' } },
    schemas: {
      Health: { type: 'object', required: ['status', 'app_version', 'db', 'db_synchronized', 'timestamp'], properties: {
        status: { type: 'string', enum: ['up', 'down', 'error'] }, app_version: { type: 'string' },
        db: { type: 'string', enum: ['up', 'down'] }, db_synchronized: { type: 'boolean' }, timestamp: { type: 'string', format: 'date-time' },
      } },
      Error: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
    },
  },
  paths: {},
};
for (const endpoint of endpoints) {
  const success = endpoint.result.match(/^\d+/)[0];
  const operation = {
    tags: [endpoint.group], summary: endpoint.summary, description: endpoint.result,
    security: ['session', 'admin'].includes(endpoint.auth) ? [{ chatSession: [] }] : [],
    responses: { [success]: { description: endpoint.result } },
  };
  if (['session', 'admin'].includes(endpoint.auth)) operation.responses['401'] = { description: 'Missing or expired session', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
  if (endpoint.auth === 'admin') operation.responses['403'] = { description: 'Administrator access required' };
  if (endpoint.method === 'post') {
    operation.responses['400'] = { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
    operation.responses['403'] = { description: endpoint.auth === 'admin' ? 'Administrator access required or cross-origin request rejected' : 'Cross-origin request rejected' };
    const properties = Object.fromEntries(Object.entries(endpoint.body).map(([key, description]) => [key, { type: description.startsWith('boolean') ? 'boolean' : 'string', description }]));
    operation.requestBody = { required: Object.values(endpoint.body).some(value => !value.includes('optional')), content: { 'application/json': { schema: { type: 'object', properties, required: Object.entries(endpoint.body).filter(([, value]) => !value.includes('optional')).map(([key]) => key) } } } };
  }
  if (endpoint.path === '/api/avatar') operation.requestBody = {
    required: true,
    content: Object.fromEntries(['image/jpeg', 'image/png', 'image/webp'].map(type => [type, { schema: { type: 'string', format: 'binary' } }])),
  };
  if (endpoint.path === '/api/avatars/{humanId}') operation.responses['200'].content = { 'image/webp': { schema: { type: 'string', format: 'binary' } } };
  const pathParameters = [...endpoint.path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => ({ name, in: 'path', required: true, schema: { type: 'string' } }));
  if (pathParameters.length) operation.parameters = pathParameters;
  if (endpoint.path.endsWith('/history')) operation.parameters.push(...['before', 'after'].map(name => ({ name, in: 'query', schema: { type: 'string' }, description: 'Opaque message cursor. Supply only one direction.' })));
  if (endpoint.path.endsWith('/stream')) operation.responses['200'].content = { 'text/event-stream': { schema: { type: 'string' } } };
  if (endpoint.path === '/api/health') for (const [status, description] of [['200', 'Service and migrations are healthy'], ['503', 'Database is unreachable'], ['500', 'Schema mismatch or health-check error']]) operation.responses[status] = { description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Health' } } } };
  if (['/api/join', '/api/rename'].includes(endpoint.path)) operation.responses['409'] = { description: 'Nickname already taken' };
  (openapi.paths[endpoint.path] ??= {})[endpoint.method] = operation;
}

export function markdownDocs() {
  return `# Chatty API v${appVersion}\n\nGenerated from the same contract as /api/docs and /api/docs/openapi.json.\n\nSession routes use the HttpOnly chat_user_id cookie. Public restore requires a remembered-browser cookie or private recovery code. POST requests accept JSON.\n\n${endpoints.map(e => `## ${e.method.toUpperCase()} ${e.path}\n\n${e.summary}. Authentication: ${e.auth}.\n\n${e.body ? 'Body: ' + JSON.stringify(e.body) + '\n\n' : ''}${e.result}\n`).join('\n')}`;
}
