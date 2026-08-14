# YourCal

A self-hosted web calendar client for CalDAV servers (tested against
[Radicale](https://radicale.org/) and [Baikal](https://sabre.io/baikal/)).
Your CalDAV server is the sole identity provider — there's no separate
local user store or account system.

## Features

- Month/week/day views with drag-to-resize and drag-to-move events
- Multiple calendars, per-calendar color overrides
- Recurring events (RRULE) with weekday picker and never/count/until end
  conditions, plus this/this-and-future/all edit and delete scopes
- Real IANA timezone support (read and write), including across
  DST transitions
- Search across all calendars
- ICS file import
- WebCal/ICS URL subscriptions (read-only)
- Calendar sharing between users on the same CalDAV server (Radicale
  sharing API and Baikal `cs:share`, with an in-app accept flow)

See [AGENTS.md](./AGENTS.md) for implementation details, known gaps, and
open items.

## Stack

npm workspaces monorepo:

- `shared` — TypeScript types shared between client and server
- `server` — Fastify API, talks to your CalDAV server via `tsdav`
- `client` — Vue 3 SPA (FullCalendar for the calendar grid)

## Running with Docker

### From a checkout (builds the image locally)

```sh
cp .env.example .env
# generate a session secret and put it in .env
openssl rand -hex 32
```

Edit `.env` (or set the equivalent variables in `docker-compose.yml`) —
`SESSION_SECRET` is required, everything else has a sensible default. Then:

```sh
docker compose up -d --build
```

### Without a checkout (pulls the published image)

Every push to `main` publishes an image to
`ghcr.io/fuzzymistborn/yourcal:latest` (see
`.github/workflows/docker-publish.yml`; tagged releases also get
`vX.Y.Z`/`vX.Y` tags). If you just want to run YourCal without cloning the
repo, grab `docker-compose.example.yml`, rename it to `docker-compose.yml`,
create a `.env` next to it with at least `SESSION_SECRET` set (see
`.env.example` above for the full list of variables), then:

```sh
docker compose up -d
```

### Either way

The app listens on `http://localhost:3000`. Log in with credentials for
any CalDAV server reachable from the container (set `ALLOWED_CALDAV_HOSTS`
to restrict which hosts it's allowed to connect to).

## Running locally for development

Requires Node.js and a running CalDAV server to point at.

```sh
npm install
cp .env.example .env   # fill in SESSION_SECRET at minimum

npm run dev:server   # Fastify API, with reload
npm run dev:client   # Vite dev server for the SPA
```

Other useful scripts:

```sh
npm run build   # build shared, server, and client
npm run test    # server test suite
npm run lint    # eslint across the workspace
```

## Configuration

All server configuration is via environment variables — see
[.env.example](./.env.example) for the full list (session secret, CalDAV
host allowlist, session TTL, optional SQLite read-cache).

## Troubleshooting

**Baikal: login fails with "cannot find principalUrl"** — Baikal serves
CalDAV under `/dav.php`, not the host root, so the login form's server
URL needs the full path with a trailing slash, e.g.
`https://your-baikal-host/dav.php/` (omitting the trailing slash can make
the discovery request get redirected in a way that breaks it).

**Baikal: login fails with a fast `401` even with correct credentials** —
this app authenticates with HTTP Basic auth only. If your Baikal instance
(or a reverse proxy in front of it) is configured to require Digest auth
(check for a `WWW-Authenticate: Digest` response header), Basic auth
requests will be rejected outright. Configure Baikal/your reverse proxy
to accept Basic auth instead.

## License

MIT — see [LICENSE](./LICENSE).
