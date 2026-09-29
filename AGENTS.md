# Live Chat Room

Build a multi-room live chat web app. People pick a nickname and chat across multiple rooms. Messages, presence, and typing indicators update instantly for everyone connected, without a page refresh.

## What this app does

A real-time chat app with multiple rooms. People pick a nickname (no passwords), join rooms, and send messages that appear instantly for everyone in the room. The app tracks who's online, shows typing indicators, supports @mentions with notifications, and saves all messages in a database.

## Identity

- No passwords. The join page asks for a nickname and creates a user.
- Remember the user on this browser with an httpOnly cookie (`chat_user_id`, 30-day expiry), so a refresh keeps them in the chat.
- Middleware protects application routes except `/join`, `/api/join`, static assets, and the public `/api/health` infrastructure endpoint. Without a valid cookie, redirect to `/join`.
- Get the acting user from the cookie on the server. Never trust a user ID sent in a form or request body.

## Saved state and live state

- **Saved state** goes in the database: users, rooms, messages, notifications. It must survive a server restart.
- **Live state** stays out of the database: who is online in each room, who is typing, open connections. It lives in server memory (or in the hosted real-time service) and expires on its own.

## Database schema

Use PostgreSQL in development and production. The canonical schema is in
`database/migrations/001-1.0.0-chatty-schema.sql`.

- `humans` is the shared person identity. Personal details are optional.
- `chat_profiles` holds a person's unique nickname and avatar color; its primary
  key `human_id` references `humans.id`.
- `email_history` supports optional temporal email records; joining needs no email.
- Rooms reference their creator in `humans`; messages and notifications use
  `human_id` / `from_human_id`, not `users.id`.
- `event_outbox` stores durable integration events for Event Dashboard.
- Presence, typing, and live connections stay in memory.

### Migrations and environment

- Use `.env.development` locally and `.env.production` for production commands.
  Inject production secrets through Coolify. Environment values override files.
- Keep real environment files out of Git and Docker images; commit example files.
- SQL migration filenames use `{migration_number}-{api_version}-{migration_name}.sql`,
  for example `003-1.0.0-add-room-settings.sql`.
- Numbers are globally increasing, unique, and at least three digits; API versions
  use semantic versioning. Never edit an applied migration.
- The runner owns transactions; migration SQL must not include BEGIN/COMMIT.
- `npm run db:migrate` applies local migrations; `npm run db:migrate:prod` applies
  production migrations. `npm start` migrates before accepting traffic.

### Event Dashboard

- Publish server-side to the dashboard's `POST /api/events` using `x-api-key`.
- Enqueue business events in the same PostgreSQL transaction as their related write.
- Use `src/server/events.mjs`; do not send chat message bodies or credentials.
- Delivery is at least once with retries. The dashboard currently does not deduplicate.
- Keep the dashboard independently deployable; never share database credentials.

### Tests and documentation

- Provide `test:api` and `test:e2e` commands as the application endpoints and chat
  flow are implemented. Each must generate Markdown documentation in the same run.
- Do not describe foundation tests as complete chat acceptance tests.

## Pages

### Join page (`/join`)
- Nickname input field. No passwords.
- Sets the `chat_user_id` cookie on submit.
- Redirects to `/rooms/lobby` after joining.

### Room list (`/rooms`)
- Lists all rooms with the online count per room.
- "+ New" button to create a room (modal with name and description fields).
- User info bar at the bottom with the nickname and an exit button.
- Mobile-first: this is the main navigation page on small screens.

### Chat room (`/rooms/[id]`)
- **Desktop:** sidebar with the room list on the left, chat area on the right.
- **Mobile:** full-screen chat with a back arrow linking to `/rooms`.
- **Header:** room name, description, online count, notification bell, sound toggle.
- **Messages area:** scrollable, loads older messages on "Load earlier", auto-scrolls on new messages.
- **Input:** text input at the bottom, sends without a page reload, clears after send.
- **Live connection:** subscribes to the room's live updates on page load (by default an SSE stream at `/api/rooms/[id]/stream`) and reconnects automatically when it drops.
- **Modals:** "New Room" and "Change Name".

## API routes

- `POST /api/join`: Create a user with the given nickname. Set the `chat_user_id` cookie. Redirect to `/rooms/lobby`.
- `POST /api/leave`: Clear the `chat_user_id` cookie. Redirect to `/join`.
- `POST /api/rename`: Update the user's nickname. Broadcast a rename system message to all rooms.
- `POST /api/rooms`: Create a room. Broadcast it so other people see it appear in their sidebar. Redirect to the new room.
- `POST /api/rooms/[id]/messages`: Save the message. Parse @mentions and create notifications for mentioned users. Broadcast the message to everyone connected to that room.
- `GET /api/rooms/[id]/history?before=timestamp`: Return older messages, paginated by timestamp.
- `GET /api/rooms/[id]/stream`: Open the live connection for a room (see below).
- `POST /api/rooms/[id]/typing`: Set the user's typing state with a 2-second expiry. Return 204.
- `GET /api/notifications`: Return the user's unread notifications.
- `POST /api/notifications/read`: Mark all of the user's notifications as read.

## Live updates

The live connection for a room delivers these events:

- `message`: a new chat message or system message
- `presence`: the updated online count
- `userlist`: the people online (for @mention autocomplete)
- `typing`: who is typing right now
- `mention`: the connected user was @mentioned (triggers the notification sound)
- `newroom`: a room was created (for the sidebar)

Send a heartbeat every 30 seconds so proxies keep the connection open. On connect, add the user to the room's presence and post a "joined" system message. On disconnect, wait 60 seconds before removing them and posting "left". If they reconnect within that window (a page refresh, a brief network drop), cancel the removal.

A broadcast only reaches connections for that room. Messages from another room never show up.

## UI behavior

- **Message grouping:** consecutive messages from the same user are grouped (no repeated author header).
- **Own messages:** visually distinct from other people's messages.
- **@mention autocomplete:** type `@` to see a dropdown of online users plus "everyone". Arrow keys and Tab/Enter to select.
- **@mentions display:** mentioned usernames highlighted. `@everyone` rendered as `@EVERYONE`.
- **Notification bell:** shows an unread count badge. The dropdown lists recent mentions.
- **Sound toggle:** a sound on new messages, a different one for @mentions. Preference saved in localStorage.
- **Auto-scroll:** scrolls to the bottom on new messages only if the user is already at the bottom.
- **Mobile:** sidebar hidden, back arrow to the room list, larger touch targets, compact layout.

## Design

- Feels like Slack or Discord, not a web form. Compact message density, a fixed header, and the input always visible at the bottom.
- Works on phones: the room list is its own page on small screens.
- Supports light and dark mode.

## Default implementation

- The product can use any stack. If no stack is specified, use Astro SSR with the Node adapter, HTMX 2 with its SSE extension, Alpine.js for small interactions, raw PostgreSQL via a shared pg.Pool in both environments, and Tailwind CSS.
- Default real-time flow: POST to send, SSE to receive. The message route saves to the database, then emits an event on an in-memory EventEmitter. Every SSE connection for that room listens for the event and writes it to its response stream.
- Keep presence, typing, and the EventEmitter in memory. Store these singletons on `globalThis` so they survive Vite HMR in development.
- SSE multi-line payloads must prefix each line with `data: ` per the SSE spec.
- If you use Astro behind a proxy and POST requests fail the origin check, set `security: { checkOrigin: false }` in the Astro config.
- Live connections need a server process that stays running. Serverless functions don't fit unless a hosted real-time service handles the live part. Deploy on Railway, Fly.io, Render, or a VPS.
- Include a README with setup instructions and required environment variables.

## Test with two windows

Use two browser profiles, or automated end-to-end tests with two separate browser contexts:

1. Join as Alice and Bob in the Lobby.
2. Each sends a message, and it appears in the other window without a refresh.
3. Both see each other in the online list.
4. Bob types, and Alice sees the typing indicator, which clears a few seconds after Bob stops.
5. A message posted in another room never appears in the Lobby.
6. A refreshed window loads the history and keeps receiving live messages.
7. Closing a window shows that person leaving after the grace period.
8. After a server restart, both windows reconnect on their own and every message is still there.

## Seed data

On first run, create a default room and a system user:

```
User: "System" (id: "system", color: "#666666")
Room: "Lobby" (id: "lobby", name: "Lobby", description: "The default room", created_by: "system")
```

## How to run

The app should start with `npm run dev` after setting the environment variables required by the chosen stack. Include a setup script (for example `npm run db:setup`) that creates the tables and seeds the Lobby room.
