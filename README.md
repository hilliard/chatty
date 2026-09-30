# Chatty

Multi-room live chat with nickname identities, saved messages, presence, typing,
mentions, and a responsive colorful interface. Built with Astro SSR, PostgreSQL,
and Server-Sent Events, with a durable Event Dashboard publisher.

## Local development (Windows)

Requires Node.js 22.12+ and native PostgreSQL. No local Docker is required.

1. Run `npm install` (or `npm ci` after cloning).
2. Copy `.env.development.example` to `.env.development` if absent.
3. Create a PostgreSQL login and a database named `chatty_development` owned by that
   login. Set `DATABASE_URL` with its actual password in `.env.development`.
4. Run `npm run db:setup` to create tables and seed System and Lobby.
5. Run `npm run dev`; open http://127.0.0.1:4321.

Use a dedicated Chatty database, not the event-dashboard database. URI-encode
special characters in the database password. No credentials are committed.

`npm test` checks foundation and health contracts. `npm run build` verifies the
production build and generates versioned API documentation and a migration manifest.

## Environment configuration

Commands explicitly load `.env.development` or `.env.production`. Variables already
in the process environment take precedence, allowing Coolify to inject secrets.
Real environment files are ignored by Git and excluded from Docker builds.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection URI; required for migrations/runtime |
| `HOST` | `127.0.0.1` locally; `0.0.0.0` on Coolify |
| `PORT` | HTTP port, default 4321 |
| `EVENT_DASHBOARD_URL` | Dashboard API origin, without `/api/events` |
| `EVENT_DASHBOARD_API_KEY` | Server-only Chatty project key; empty disables automatic worker |

Production file example: `.env.production.example`. The local `.env.production`
can be used for production-mode commands, but Coolify should supply its values
through runtime environment settings. Building does not require production secrets.

## Versioned migrations

Files live in `database/migrations/`:

```
001-1.0.0-chatty-schema.sql
002-1.0.0-event-outbox.sql
```

Pattern: `{migration_number}-{api_version}-{migration_name}.sql`. Use at least
three digits, a globally unique increasing number, a three-part semantic API
version, and a lowercase hyphenated name. API version labels describe the contract
the migration belongs to; all pending migrations run in numeric order.

- Local: `npm run db:migrate` (alias: `npm run db:setup`).
- Production: `npm run db:migrate:prod`.
- Production startup: `npm start` applies migrations before starting HTTP.

The runner records filenames, API versions, SHA-256 checksums, and timestamps in
`schema_migrations`. It locks concurrent migration runners, uses one transaction
per file, skips applied files, and rejects changed/missing applied files, duplicate
numbers, and late insertion of older migrations. Do not put transaction statements
in migration files. Add a new migration to correct an old one. Use transactional
PostgreSQL DDL (not `CREATE INDEX CONCURRENTLY`). Back up production before schema
changes; automatic down migrations are intentionally not provided.

## Event Dashboard integration

The separate event-dashboard server receives `POST /api/events` authenticated by
`x-api-key`. Create a Chatty project/key in that dashboard and put the API origin
and key in the relevant environment. No changes to that project are required.

`enqueueEvent(client, type, metadata)` in `src/server/events.mjs` writes to
`event_outbox`. Business operations must pass their existing transaction client,
so their data and event commit together. Intended events include `user.joined`,
`user.renamed`, `room.created`, and `message.sent`. Include IDs and counts, not
message contents, credentials, or personal details. These business hooks will be
connected when the chat endpoints are implemented.

The worker sends channel `chatty`, title equal to the event type, and metadata with
`eventId`, `eventType`, `apiVersion`, and `occurredAt`. It retries failures with
exponential backoff up to one hour, preserving the event across restarts. Delivered
rows remain for inspection. It uses row locking to coordinate workers.

`npm run dev` / `npm start` launch the worker when both dashboard settings exist.
Alternatively run `npm run events:worker` or `npm run events:worker:prod` separately.
After migration, `npm run events:smoke` queues an explicit integration test event.
It will be sent by the worker; verify it in the dashboard. Delivery is **at least
once**: the receiver does not yet support idempotency, so a crash or lost response
after ingestion can produce duplicates with the same metadata event ID.

## Coolify

1. Push this repository to your Git provider and create a Coolify application from
   it using the **Dockerfile** build pack (root `Dockerfile`).
2. Provision PostgreSQL and configure `DATABASE_URL` using the hostname reachable
   from the application container. Set it as a runtime secret.
3. Copy values from `.env.production.example` into Coolify's runtime environment,
   replacing all placeholders. Set `HOST=0.0.0.0`, `PORT=4321`, and
   `NODE_ENV=production`. Add dashboard settings when ready.
4. Set the exposed application port to 4321, configure an HTTPS domain, and use
   `/api/health` for the health check. The image starts with `npm start`.
5. Keep one chat server replica while presence/SSE use in-memory state. When SSE
   is implemented, verify streaming and disconnect behavior through the proxy.

The image excludes environment files and runs as the non-root `node` user.
Coolify configuration is prepared here; no remote repository or live deployment
has been created. Official references:
[Dockerfile builds](https://coolify.io/docs/applications/builds/dockerfile) and
[environment variables](https://coolify.io/docs/applications/configuration/environment-variables).

## Returning to your nickname

Ordinary **Log out** ends the current session while remembering this browser for
30 days. On `/join`, use **Continue as your-nickname**. This uses a private HttpOnly
browser token, not your nickname as a password.

In the desktop sidebar, choose **Save a recovery code**. On mobile, open the room
list and use the recovery-code button beside your name. Create a code, copy it,
and store it privately. On another browser, open **Already have a nickname? Use a
recovery code** on `/join` and paste the code. Creating another code invalidates
the previous code. The server stores hashes only; it cannot show an old code.

Use **Log out and forget this browser** in the recovery dialog on shared devices.
You can also choose **Forget this browser** on `/join`. A forgotten browser needs
a recovery code to regain access. Clearing cookies also removes remembered access.

For a legacy account stranded before recovery was implemented, the local database
administrator can run `node scripts/recover-identity.mjs sonny`. This creates the
first recovery code only and saves it to `.recovery/sonny.txt`, excluded from Git
and Docker. This is not a public API. Remove the file after storing the code safely.

## Application verification

Run `npm run build`, `npm test`, `npm run test:api`, and `npm run test:e2e`.
The latter commands use isolated temporary PostgreSQL schemas and regenerate
`docs/api-tests.md` and `docs/e2e-tests.md`. The live suite uses two independent
HTTP/SSE sessions; browser visuals and interactions are verified separately.

## API documentation and health

- `/api/docs`: public, searchable endpoint reference, showing the application version.
- `/api/docs/openapi.json`: OpenAPI 3.1 contract for API tooling.
- `npm run test:api`: generates documentation, builds the current app, runs API tests
  in an isolated PostgreSQL schema, and writes `docs/api-tests.md` with the version
  and actual outcomes. `docs/api.md` and `docs/openapi.json` are generated from the
  same contract used by the live documentation page.

The version source is `package.json`. Update that version and rebuild to publish
matching documentation. Migration filenames retain the API version they belong to;
old migrations are never renamed to match a newer release.

`GET /api/health` is public and never cached. Its JSON contains `status`,
`app_version`, `db`, `db_synchronized`, and `timestamp`:

| Status | HTTP | Meaning |
| --- | --- | --- |
| `up` | 200 | PostgreSQL reachable; applied migrations match the build manifest |
| `down` | 503 | PostgreSQL unreachable or its connectivity check failed |
| `error` | 500 | Migration mismatch or schema inspection failed |

The migration check compares counts, numbers, filenames, API versions, and SHA-256
checksums, not merely whether a migration table exists. The manifest is generated
before builds and at development startup. Database details and exception text are
not returned. If the app process is stopped, it cannot return JSON; monitoring
must classify connection failure as down. Coolify can use this as its readiness
health check. Favicon artwork lives in `public/favicon.svg` and is linked by the
shared page layout.
