# Chatty API v1.0.0

Generated from the same contract as /api/docs and /api/docs/openapi.json.

Session routes use the HttpOnly chat_user_id cookie. Public restore requires a remembered-browser cookie or private recovery code. POST requests accept JSON.

## GET /api/health

Check service and database health. Authentication: public.

200: up; 503: down; 500: error. Includes app_version, db, db_synchronized, timestamp.

## GET /api/docs

Read versioned API documentation. Authentication: public.

200: HTML documentation.

## GET /api/docs/openapi.json

Download the OpenAPI contract. Authentication: public.

200: OpenAPI 3.1 JSON.

## POST /api/join

Create a nickname identity. Authentication: public.

Body: {"nickname":"string"}

303: sets HttpOnly session and remembered-browser cookies; redirects to /rooms/lobby. 409: nickname taken.

## POST /api/leave

Log out of the current session. Authentication: session.

Body: {"forget":"string (optional; \"true\" also forgets this browser)"}

303: clears session cookie and redirects to /join.

## POST /api/rename

Change your nickname. Authentication: session.

Body: {"nickname":"string"}

200: { nickname }. 409: nickname taken. Broadcasts rename events.

## POST /api/identity/restore

Restore a remembered or recovered identity. Authentication: public.

Body: {"code":"string (optional; omit to use chat_remember cookie)"}

200: { ok: true }; sets fresh cookies. 400: invalid or expired credential. Nickname alone never authenticates.

## POST /api/identity/forget

Forget this browser. Authentication: public.

Body: {}

200: { ok: true }; revokes chat_remember cookie. Does not end an active session.

## POST /api/identity/recovery-code

Create or replace your recovery code. Authentication: session.

Body: {}

200: { code }. Replaces the previous code. Response is not cacheable; save privately.

## GET /api/rooms

List rooms and online counts. Authentication: session.

200: array of rooms, each with online count.

## POST /api/rooms

Create a room. Authentication: session.

Body: {"name":"string (1–48 characters)","description":"string (optional; up to 180 characters)"}

201: { room }. Broadcasts newroom.

## GET /api/rooms/{id}/history

Load saved messages. Authentication: session.

200: { messages, more }. Up to 50 messages in chronological order. Use before or after with the opaque cursor returned on each message; do not supply both.

## POST /api/rooms/{id}/messages

Send a message and create mentions. Authentication: session.

Body: {"content":"string (1–4,000 characters)"}

201: saved message. Author comes from the session, never the request body.

## POST /api/rooms/{id}/typing

Update your typing state. Authentication: session.

Body: {"active":"boolean (optional; defaults to true)"}

204: no body. Typing expires after two seconds.

## GET /api/rooms/{id}/stream

Subscribe to a room. Authentication: session.

200: text/event-stream. Room messages, presence, userlist, typing, private mentions, and global room updates.

## GET /api/stream

Subscribe to community updates. Authentication: session.

200: text/event-stream. Global presence counts, newroom, renamed, private mentions, notificationsread. Does not join a room.

## GET /api/notifications

List your unread mentions. Authentication: session.

200: { notifications, count }. Up to 50 latest unread mentions and total unread count.

## POST /api/notifications/read

Mark all your mentions read. Authentication: session.

Body: {}

204: no body. Broadcasts notificationsread to your sessions.
