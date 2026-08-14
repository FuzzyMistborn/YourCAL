# AGENTS.md

Notes for whoever (human or agent) picks this project up next. See
`/home/geoff/.claude/plans/lucky-zooming-moth.md` for the original approved
plan — this file tracks what actually happened, what's still open, and
things discovered along the way that the plan didn't anticipate.

## App name

The app is called **YourCal** (`package.json`/workspace names are
`yourcal`/`@yourcal/*`, page `<title>` is "YourCal"). It went through two
prior names during dev before landing here — OwnCal (collided with an
existing product of the same name) and Datum (also collided, with an
existing "Datum - Calendar" app on the App Store) — neither shipped beyond
a rename pass, so there's no lingering "ownercal"/"datum" naming to clean
up anywhere in the codebase.

## Toolchain: TypeScript 7 vs. `@typescript-eslint` and `vue-tsc`

`typescript` is pinned to `^7.0.2` (from dependabot PR #9, merged into
`main`). Two separate parts of the toolchain don't support TS7 yet:

**1. `@typescript-eslint/eslint-plugin`/`parser`** (latest stable: 8.67.0)
declare a peer dep of `typescript@">=4.8.4 <6.1.0"`, so `npm ci` fails with
`ERESOLVE` unless peer conflicts are bypassed. Tracked upstream:
https://github.com/typescript-eslint/typescript-eslint/issues/10940 — blocked
on ESLint lacking async-parser support plus real work to bridge the new
Go/WASM (`tsgo`) AST and type info back into JS. Maintainers estimate
"1-2 typescript-eslint major releases" out, no firm timeline.
**Workaround:** CI (`.github/workflows/ci.yml`) runs
`npm ci --legacy-peer-deps` rather than plain `npm ci`. This ignores the
peer conflict rather than resolving it — treat lint output with a little
suspicion on TS7-only syntax. (There's also currently no
`.eslintrc`/`eslint.config.js` in the repo — `npm run lint` fails with
"couldn't find eslint.config.js" — a separate, pre-existing gap.)

**2. `vue-tsc`** (latest: 3.3.9, client's typecheck-during-build tool) crashes
outright on TS7 with `ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath
'./lib/tsc' is not defined by "exports"` — TS7 removed that subpath.
Confirmed via reproduction locally, and via upstream:
https://github.com/vuejs/language-tools/issues/6124 (closed as duplicate,
no fix) and https://github.com/vuejs/language-tools/issues/5381 (tracks
proper `tsgo` support — closed, unscheduled, no PR). This isn't a peer-dep
nuisance like the lint one — it's a hard crash, so it actually broke the
client production build (`vue-tsc -b && vite build`).
**Workaround:** `client/package.json`'s `build` script no longer runs
`vue-tsc -b` — it's just `vite build` now. The type-check step was moved to
a separate `npm run typecheck -w client` script (not run by `build` or CI)
so it's still there to run by hand once `vue-tsc` supports TS7, but it
currently does NOT run automatically anywhere — client type errors won't be
caught by `npm run build` or CI until this is revisited.

**Revisit both when:** typescript-eslint (issue #10940) or vue-tsc/Volar
(issues #6124 / #5381) ship TS7 support — then drop `--legacy-peer-deps` and
put `vue-tsc -b` back in front of `vite build` in `client/package.json`.

## TODO (user-requested, not yet scoped)

- **VTODO/task list UI.** Explicitly out of scope per the user — not to be
  built. `Calendar.supportsTasks` is discovered and plumbed through the
  store layer (`DavCalendarStore.discoverCalendars`) but has no UI, and
  should stay that way. Attendees/attachments remain out of scope per the
  original project plan too.
- Search, ICS import, and WebCal/ICS subscriptions are done — see their own
  section below.
- Recurring-event UI: interval, weekday picker (`BYDAY`, e.g. Tue/Thu), and
  end condition (never/count/until) are implemented in `EventEditDialog.vue`
  and verified against real Radicale (see below). Monthly/yearly BY-position
  patterns (e.g. "2nd Tuesday of the month"), RDATE, and better override
  preservation across "all"/"this-and-future" edits are still open — see
  the approved plan at `/home/geoff/.claude/plans/dazzling-bouncing-frog.md`.
- Timezone support (write, embed, and read back real IANA VTIMEZONE data) is
  done — see "Timezone handling" below.
- Reminders (VALARM, standard RFC 5545 `DISPLAY` alarms with a relative
  before-start `TRIGGER`) round-trip through create/read/edit as of this
  session — see "Event reminders (VALARM)" below. Delivery is in-tab only
  (Notification API, no service worker/push) by explicit user choice.
- Per-event color override (RFC 7986 `COLOR`, layered over the existing
  per-calendar override) is done — see "Per-event color" below.
- `PATCH /api/calendars/:id` (rename/recolor) is done — see "Calendar
  rename/edit" below; this replaces what used to be an open TODO here.
- Read-only calendar support (real `current-user-privilege-set` discovery,
  server-enforced) is done — see "Read-only calendar support" below.
- Export, conflict-handling UX, and share management (list/revoke/permission)
  are planned but not yet built — see the plan file above.

## Where things stand

Implemented and **verified against a real running CalDAV server** (Radicale
3.7.7, installed via a local venv at `.dev-radicale/` — see "How to run a
local Radicale for testing" below; not Docker, since this host has no
Docker installed). Every item below was driven through the actual HTTP API
with curl, not just typechecked:

- Monorepo: `shared` (types) / `server` (Fastify API) / `client` (Vue 3 SPA), npm workspaces.
- Session: `POST/GET/DELETE /api/session`, CalDAV server as sole identity provider, no local user store. Confirmed: real login, whoami, 401 on bad creds. See `server/src/dav/discovery.ts`, `server/src/routes/session.ts`.
- **Session lifetime is configurable** via `SESSION_TTL_SECONDS` (default
  86400 = 24h, `server/src/config.ts`), applied to both
  `@fastify/secure-session`'s own `expiry` option (a timestamp baked into
  the encrypted payload, checked server-side on every request) and the
  cookie's `maxAge` (`server/src/session.ts`). **Bug fixed in passing**:
  previously only the library's implicit 24h `expiry` default was in
  effect and the cookie itself had no `maxAge` at all -- making it a
  plain browser-session cookie, wiped on browser close regardless of the
  24h the payload would otherwise have allowed. Verified by inspecting a
  real login's `Set-Cookie` header before/after: previously no `Max-Age`
  was present; now `Max-Age=86400` by default, and a custom
  `SESSION_TTL_SECONDS=1800` correctly produces `Max-Age=1800`.
- Discovery: `GET /api/calendars` against a real Radicale principal, including picking up a calendar created out-of-band via `MKCALENDAR`.
- Read path: `GET /api/calendars/:id/events` with a real time-range `calendar-query`, both for a single event and an expanded recurring series.
- Write path: create/update/delete of a non-recurring event, full round trip including a genuine 412 on a stale ETag (confirmed both the false-positive case, which turned out to be a shell-quoting artifact in a manual test, and the true-positive case with an actually-stale etag).
- Recurrence expansion: a `COUNT=6` weekly series expands to exactly 6 correctly-spaced occurrences.
- Recurrence edit scopes, all three, confirmed via before/after reads: **this** (one occurrence moved, other 5 untouched), **this-and-future** (split into two series at the right boundary, each with the right title/time on the right side), **all** (not scope-tested standalone but exercised via the update code path).
- Recurrence delete scopes: **this** (EXDATE removes exactly one occurrence), **this-and-future** (UNTIL truncates correctly), full delete of a non-recurring event (204, confirmed gone).

Two real bugs were caught and fixed by this testing (see the RRULE section
below) — this is why "typechecks and boots" was explicitly called out as
insufficient in the previous iteration of this file. Neither bug was
findable by inspection or by TypeScript; both only showed up by driving
actual requests through the server against Radicale's actual RRULE
validation and ETag semantics.

Not yet done (from the original plan's build order, steps 8–9, plus a few gaps found along the way):

- **No automated tests exist yet.** The manual curl-driven verification above should be turned into the vitest fixtures the plan's verification section calls for (EXDATE, monthly-by-day, RECURRENCE-ID override, DST-crossing all-day series, this-and-future split) so these scenarios are checked on every change instead of by hand. `vitest` is wired into `server/package.json` but there isn't a single test file yet.
- ~~Never run against Baikal~~ — done, see "Baikal instance" and "Calendar sharing" below. PHP was installed on this host specifically to enable this. Two real bugs were found and fixed by this testing (calendar-color parsing, Fastify max-param-length) — the core read/write/recurrence/timezone paths were **not** re-verified against Baikal beyond what the sharing spike incidentally exercised (create/read/update/delete of plain, non-recurring events); RRULE/EXDATE/timezone edge cases are still Radicale-only-verified.
- ~~Timezone correctness pass (plan step 8)~~ — done, see "Timezone handling" below.
- ~~`docker-compose.dev.yml` and the production `Dockerfile`~~ (plan step 9) — see "Docker packaging" below.
- `PATCH /api/calendars/:id` (rename/recolor) — in the plan's route table, not implemented.
- ~~`DELETE /api/calendars/:id`~~ — done, see "Calendar sharing" ("Built: unsubscribe (recipient) and delete (owner) for shared calendars").
- `GET /api/calendars/:id/sync` — `DavCalendarStore.syncCalendar()` exists and is implemented, but no route exposes it yet, and it has not been tested against Radicale at all (unlike everything else above).
- No calendar-privilege discovery — `Calendar.readOnly` is hardcoded `false` for everything (see `DavCalendarStore.discoverCalendars`). A write to a genuinely read-only calendar will fail late, at the CalDAV server, rather than being disabled in the UI up front.
- The frontend (Vue dialogs, drag/resize) has **not** been exercised in a browser — only the backend API was driven directly with curl. Click through the actual UI against this same Radicale instance before considering the write/recurrence UX done.

## How to run a local Radicale for testing (no Docker)

```
python3 -m venv .dev-radicale/venv
.dev-radicale/venv/bin/pip install radicale bcrypt
```

Config at `.dev-radicale/config/config` (htpasswd auth, filesystem storage
under `.dev-radicale/data/`), one bcrypt user in `.dev-radicale/config/users`.
Run with `.dev-radicale/venv/bin/python -m radicale --config .dev-radicale/config/config`
(binds `127.0.0.1:5232`). A calendar has to be created once per test user —
Radicale doesn't auto-create one — via a raw `MKCALENDAR` request (see git
history / shell scrollback for the exact curl invocation used this session).
`.dev-radicale/` is gitignored-worthy scratch state, not part of the app.

## How to run a local Baikal for testing (no Docker)

Needs PHP with `mbstring`, `xml`/`dom`/`simplexml`, and `pdo_sqlite` --
none of which are on this host by default (`sudo apt install
php8.3-mbstring php8.3-xml php8.3-sqlite3` on Ubuntu 24.04, or whatever
the equivalent PHP version's packages are called). No `sudo` available in
an agent session -- this needs a human to run it.

```
curl -sL -o .dev-baikal/baikal.zip \
  https://github.com/sabre-io/Baikal/releases/download/0.11.1/baikal-0.11.1.zip
unzip -q .dev-baikal/baikal.zip -d .dev-baikal && rm .dev-baikal/baikal.zip
```

The release zip ships `vendor/` prebuilt -- no `composer install` needed.
Run with `php -S 127.0.0.1:8080 -t .dev-baikal/baikal/html`. First run
needs the install wizard (`/admin/install/`), which is a multi-step form
normally driven by hand in a browser but was scripted via curl this
session (capture the `PHPSESSID` cookie + `CSRF_TOKEN` from the GET, then
POST each step) -- **the one non-obvious gotcha**: the wizard's hidden
`refreshed` field must stay `0` on a real submit; sending `refreshed=1`
(which reads like "yes, submit this") actually tells the form to
re-render itself instead of persisting, and it silently redisplays the
same empty form with no error. Writes `.dev-baikal/baikal/config/baikal.yaml`
(plaintext, git-untracked) and initializes
`.dev-baikal/baikal/Specific/db/db.sqlite`.

Users are created via the admin panel (`/admin/?/users/new/1/`, also
scripted via curl, same CSRF-token pattern) -- unlike Radicale, Baikal
auto-creates one default calendar per user immediately, no manual
`MKCALENDAR` needed. `testuser`/`testuser` and `shareduser`/`shareduser`
(email `shareduser@example.com`, needed for sharing -- see "Calendar
sharing" above) both already exist in the local `db.sqlite`. Admin login
is `admin`/`bAikalAdmin1!`.

CalDAV base URL for this app's login form: `http://127.0.0.1:8080/dav.php`
(not just the host root -- Baikal serves DAV under `/dav.php`, unlike
Radicale which serves it at the root).

`.dev-baikal/` is gitignored-worthy scratch state, not part of the app,
same as `.dev-radicale/`.

## Previously-known risk: `getRawObject`'s multiget shape — now confirmed working

`DavCalendarStore.getRawObject()` passes the **object's own href** as
`calendar.url` to `client.fetchCalendarObjects({ calendar: { url: href },
objectUrls: [href] })`. This was flagged as an unverified risk in the
previous iteration of this file. It has now been exercised repeatedly
against real Radicale (every recurring-event edit/delete test above goes
through it) and works correctly. Not yet tested against Baikal.

## Recurrence: known simplifications

These were deliberate scope cuts to ship v1, not oversights — but they're
real gaps a user will eventually hit:

- **Editing "all events" drops every existing override.** `editScope.applyAll()` removes all `RECURRENCE-ID` VEVENTs and rewrites just the master. If a series has an exception (e.g. one occurrence moved to a different time) and the user then edits the whole series, that exception is silently lost.
- **"This and future" doesn't migrate overrides into the new series.** `editScope.applyThisAndFuture()` drops overrides at/after the split point from the old series rather than carrying them into the newly created one.
- **`RDATE` is not handled anywhere** — only `RRULE` + `EXDATE` + `RECURRENCE-ID` overrides. A series with explicit added dates via RDATE will expand incorrectly.
- Recurrence expansion has no separate "horizon" cap beyond the caller's requested time range — the plan mentioned bounding open-ended RRULEs, but since the iterator already stops the moment it passes `range.end`, the range itself is the bound. Fine as-is; just noting the plan's phrasing ("cap at range plus a bounded horizon") wasn't literally needed.

## Timezone handling: done (previous note here was wrong)

A previous iteration of this file guessed that "ical.js ships a builtin
table for common zones" and that non-UTC timezones would "probably resolve
fine." That was **wrong** — ical.js registers only `UTC`/`GMT`/`Z` by
default (`ICAL.TimezoneService.reset()`, confirmed by reading
`node_modules/ical.js/dist/ical.js` directly); there is no IANA data at
all. This meant every non-UTC event was silently written as UTC, with no
error anywhere — not a theoretical gap, since `EventEditDialog.vue`
unconditionally sent the browser's real local zone on every non-all-day
event before this was fixed.

Fixed via:

- `server/src/ical/timezones.ts`: `ensureTimezoneRegistered(tzid)` sources
  real VTIMEZONE data from the `@touch4it/ical-timezones` package (pinned
  in `server/package.json`) and registers it into `ICAL.TimezoneService`
  on first use of a given zone. `registerEmbeddedTimezones(comp)` handles
  the read side — a raw `new ICAL.Component(ICAL.parse(ics))` parse does
  **not** auto-register a VCALENDAR's own embedded VTIMEZONE the way
  `ICAL.ComponentParser` would, so this is called at every ICS-parsing
  entry point (`icsToCalendarObject`, `expandCalendarObject`,
  `editScope.ts`'s shared `parseCalendar()`) to register whatever
  VTIMEZONE is already embedded — this makes reads correct for *any*
  server's VTIMEZONE, not just zones `@touch4it/ical-timezones` knows.
- Every VCALENDAR this app writes (`calendarObjectToIcs` and every
  full-VCALENDAR branch in `editScope.ts`) calls
  `ICAL.helpers.updateTimezones(comp)` before `.toString()` — an existing
  ical.js helper that embeds a matching VTIMEZONE for every TZID actually
  referenced, so a series's VTIMEZONE always travels with it.
- `EventEditDialog.vue` now has a real timezone picker
  (`Intl.supportedValuesOf('timeZone')`, no new client dependency) instead
  of silently hardcoding the browser's zone; `EventDetailPopover.vue`
  surfaces the event's zone when it differs from the viewer's own.

**Verified against real Radicale**: a weekly `America/New_York` series
created before the March DST transition keeps 9am local wall-clock time
across the transition (occurrences read back as `14:00Z` pre-transition,
`13:00Z` post-transition — both 9am EST/EDT respectively); raw ICS
fetched via curl confirmed the `VTIMEZONE;TZID=America/New_York` block is
present with correct STANDARD/DAYLIGHT rules. Not yet tested: zones with
unusual/non-DST-observing rules, or a VTIMEZONE from a *different* CalDAV
server with non-standard data (Radicale always uses ours, since we're the
one writing it in this dev setup).

## Four real bugs found by testing against Radicale (all fixed)

None of these was catchable by typechecking — all needed an actual
server round trip (or, for #3, actually reading the raw ICS bytes) to surface:

1. **All-day events weren't actually being written as all-day.** `buildVeventComponent`
   built the start/end via `ICAL.Time.fromJSDate(new Date(fields.start), !fields.allDay)`
   then retroactively set `.isDate = true`. Two problems: `fromJSDate`'s
   `useUTC` param being `false` (for an all-day event) makes it convert
   through the *server's local timezone* first, and setting `.isDate = true`
   afterward doesn't truncate the already-baked-in hour/minute or change
   how it serializes. The result: an ICS with a floating `DTSTART:20260804T200000`
   instead of `DTSTART;VALUE=DATE:20260805`, and the API read the value back
   as `allDay: false` — which is why the frontend showed a phantom "12a"
   instead of an all-day banner. Fix: use `ICAL.Time.fromDateString(dateOnlyString)`
   for all-day events instead — it builds a real `DATE`-typed value directly,
   with no JS-Date/timezone round trip to go wrong (`mapper.ts`,
   `buildVeventComponent`). While in there, also fixed a related bug in the
   *timed*-event path: reassigning `.zone` directly relabels a time without
   converting it (a UTC time assigned a `America/New_York` zone would
   serialize as if 14:00 UTC were 14:00 local) — replaced with `.convertToZone(zone)`,
   which does the actual conversion. This is a concrete instance of the
   "Timezone handling" section below turning out to be right to worry
   about (at the time this was fixed, before the section was fully
   resolved).
2. **`updatePropertyWithValue('rrule', someString)` silently corrupts the RRULE.**
   ical.js does not parse a raw string into a `Recur` value for you; passed
   a string, it iterates the string as an array-like and serializes
   `RRULE:0=F;1=R;2=E;3=Q;...` (one property per character). Radicale
   correctly rejected this with 400. Fix: always
   `ICAL.Recur.fromString(fields.rrule)` before `updatePropertyWithValue`
   (`server/src/ical/mapper.ts`, `buildVeventComponent`).
3. **`getFirstPropertyValue('rrule')` returns the live `Recur` object, not a
   copy.** `editScope.applyThisAndFuture()` read the master's RRULE to carry
   into the new split-off series, then called `truncateRrule()` on the
   master — but since both operations were touching the *same* `Recur`
   instance, the "carried" rule ended up truncated too, so the new series
   got the old series's `UNTIL` instead of its own open-ended continuation.
   Confirmed via a debug script that `rrule.getFirstValue() === master.getFirstPropertyValue('rrule')`.
   Fix: capture `.clone()` of the value *before* truncating, and do it before
   the truncation call, not just before reading `.toString()` (`editScope.ts`,
   `applyThisAndFuture`). General lesson: assume ical.js accessors return
   live references, not snapshots, anywhere a value is read now and mutated
   later in the same function.
4. **`DavCalendarStore.syncCalendar()` was completely broken** — confirmed
   the exact thing the previous iteration of this file predicted
   ("has not been tested against Radicale at all"). tsdav's
   `smartCollectionSync({ method: 'webdav' })` throws `"collection.objectMultiGet
   is required for webdav sync changes"` unless you pass a
   `collection.objectMultiGet` function — sync-collection REPORT only
   returns changed hrefs+etags, not full ICS bodies, so tsdav needs a way
   to fetch them. Fix: `collection: { url, syncToken, objectMultiGet:
   client.calendarMultiGet.bind(client) }`. This was invisible until the
   SQLite cache (below) became the first real caller of `syncCalendar()`.

## Bugs found by code review (all fixed)

Unlike the bugs above, these were caught by reading the code rather than
by driving requests through it — worth noting since it means the
curl-driven verification approach, while necessary, isn't sufficient on
its own for security-shaped bugs that don't fail loudly.

1. **SSRF / credential leak via `calendarId`.** `assertHrefSameHost()`
   (`server/src/dav/hostAllowlist.ts`) existed specifically to stop a
   client-supplied URL from making the server send CalDAV Basic-auth
   credentials to an arbitrary host — but it was only applied to `href`
   (`updateObject`/`deleteObject`/`getRawObject(s)`), not to `calendarId`,
   which decodes to an equally client-controlled raw URL via
   `decodeId()`. A forged `:id` route param base64url-encoding an
   off-host URL would have made `getEvents`/`createObject`/`syncCalendar`
   issue an authenticated request to it. Fixed by adding the same
   `assertHrefSameHost(ctx.baseUrl, url)` check right after `decodeId()`
   in all three (`DavCalendarStore.ts`). Also added a global
   `setErrorHandler` in `index.ts` mapping `DisallowedHostError` to a
   clean 403 instead of the default uncaught-throw 500, matching how
   `session.ts` already handled it for login. Verified: a request with a
   forged off-host `:id` now 403s with no request reaching the target
   host.
2. **Missing `summary` validation.** `eventFieldsError` (`ical/validate.ts`)
   only checked `start`/`end` even though `EventFields.summary` is
   required by the shared type — a request with no `summary` would reach
   `buildVeventComponent` and write a malformed `SUMMARY` instead of
   getting a clean 400. Fixed by adding the same required-field check.
3. **`RECURRENCE-ID`/split-boundary value-type mismatch in
   `editScope.ts`.** `applyThisOccurrence` and `applyThisAndFuture` built
   the RECURRENCE-ID (or this-and-future split boundary) using
   `fields.allDay` — the edit's *new* value — rather than the *master's
   own* DTSTART value type, which is what RFC 5545 actually requires a
   RECURRENCE-ID to match. Toggling all-day during a `this`/`thisAndFuture`
   edit would produce a value-type mismatch. `deleteThisOccurrence`/
   `deleteThisAndFuture` already did this correctly (read the master's
   `dtstart.isDate`); the fix extracted that into a shared
   `masterIsAllDay()` helper and used it in all four functions. Verified
   against real Radicale: editing a single occurrence of a weekly
   `America/New_York` series to all-day now writes
   `RECURRENCE-ID:20260413T140000Z` (DATE-TIME, matching the master),
   not a mismatched `RECURRENCE-ID;VALUE=DATE`, and Radicale accepts the
   write (200, not 400).

## Search, ICS import, WebCal/ICS subscriptions

All three verified against real Radicale (search against existing test
data; import and subscriptions against files/a local static-file server set
up for the purpose — see verification notes below each).

- **Search** — `GET /api/search?q=`, `server/src/routes/search.ts`. No
  full-text index: loops `discoverCalendars` + `getEvents` across every
  calendar over a default ±1yr/±2yr window (overridable via `start`/`end`
  query params) and substring-matches summary/description/location,
  case-insensitive. Capped at 100 results. This means search cost scales
  with calendar count and window size, not with a real index — fine at
  personal-calendar scale, would need real server-side `text-match` CalDAV
  filters (RFC 4791) or the SQLite cache's table to actually scale.
  Frontend: `SearchBox.vue`, sidebar, 300ms debounce, min 2 chars.
- **ICS import** — `POST /api/calendars/:id/import`, body `{ ics: string
  }`. `server/src/ical/importIcs.ts` splits a multi-VEVENT file into
  one VCALENDAR per original UID (grouping a master with its own
  RECURRENCE-ID overrides), assigns each a **fresh** UID (never reuses the
  source file's UIDs, to avoid collisions with existing data), and creates
  each via the normal `store.createObject` path — so imported events are
  fully real, normal calendar objects afterward, not a special type.
  Partial failure doesn't abort the batch (`imported`/`total` counts
  returned). Frontend: `ImportDialog.vue`, reads the file client-side via
  `File.text()` and POSTs it as a JSON string (no multipart/form-data
  dependency added). **Verification gotcha**: a manual curl test using
  `echo "$JSON" | curl -d @-` failed with `"component began but did not
  end"` — this was a shell piping artifact truncating stdin, not a real
  bug; retesting with `--data-binary @file.json` succeeded (3/3 events,
  including a recurring one, imported and expanded correctly). Worth
  remembering next time a curl-piped JSON body mysteriously fails to
  parse — check the pipe before the code.
- **WebCal/ICS subscriptions** — `GET /api/subscriptions/events?url=&start=&end=`,
  `server/src/ical/subscription.ts`. Fetches an arbitrary external
  http(s)/webcal(→https) URL server-side, parses it exactly like import
  does (grouped by UID, expanded via the same `expandCalendarObject` used
  everywhere else), returns `CalendarObject[]` with a synthetic
  `sub:<sha256(url)[:16]>` calendarId. No etags exist for this kind of
  resource (constant placeholder `'subscription'` etag) since these
  events are never written back anywhere — read-only by construction, not
  just by convention. **Noted but accepted as a real SSRF surface**:
  route is gated by `requireSession` (must be logged in), same trust level
  as the CalDAV login itself (also a user-supplied URL fetched
  server-side) — acceptable for a personal self-hosted instance, would
  need reconsidering before exposing this more broadly (e.g. an
  allowlist, like `ALLOWED_CALDAV_HOSTS` does for the CalDAV login).
  Frontend: subscriptions are **entirely client-side state**
  (`stores/subscriptions.ts`, localStorage, same pattern as color
  overrides / week-start) — the server has no concept of "this user's
  subscription list," it just proxies whatever URL it's given per
  request. `SubscriptionList.vue` in the sidebar; events merge into
  `fullCalendarEvents` in `CalendarView.vue` with `editable: false`, and
  `EventDetailPopover` hides its Edit button for them (`readOnly` prop).

## Calendar sharing

User wants to share a calendar between two users on the same CalDAV
server. Researched, spike-tested, and finally built across four sessions;
see `/home/geoff/.claude/plans/shimmering-snacking-wilkinson.md` for the
original spike plan (the owner-initiated "Share" UI described below was
built afterward, directly, not through that plan). **Both Radicale
(`/.sharing/v1/map`) and Baikal (CalDAV `cs:share` POST, the Apple
calendarserver-sharing draft) have real, working sharing**, and testing
against real Baikal (previously never done at all) surfaced and fixed two
genuine app bugs (see "Baikal instance" below) along the way.

**What's built**: a "Share this calendar" action (↗ icon next to each
calendar in `CalendarList.vue`, opens `ShareCalendarDialog.vue`) that
takes a recipient (username or email) and a read/edit toggle, and
`POST /api/calendars/:id/share` (`server/src/dav/sharing.ts`,
`shareCalendar()`) which tries the Radicale mechanism first, falls back to
the Baikal mechanism on failure, and surfaces a clear 422 error if neither
works (e.g. unresolvable recipient) rather than reporting false success.
**Scoped to owner-initiated sharing only** -- see the "Known limitation"
paragraph below the numbered workflow for what's deliberately not
covered.

- CalDAV itself (RFC 4791) has no sharing mechanism.
- **First spike (rights-file approach)**: granting `shareduser` `rw` on
  `testuser`'s calendar via Radicale's legacy `from_file` rights backend
  gave real CalDAV write access (confirmed via curl and through the app),
  but the shared calendar never showed up in `shareduser`'s `GET
  /api/calendars` -- a rights-file grant permits raw path access without
  mounting the collection into the grantee's own calendar-home-set, which
  is all `discoverCalendars()`/`fetchCalendars()` ever queries. Left as
  an open gap at the time.
- **Second spike (`/.sharing/v1/map` API) closes that gap.** Enabled via
  `.dev-radicale/config/config`'s `[sharing]` section (`type = files`,
  `collection_by_map = true`, `permit_create_map = true`). Workflow,
  confirmed end-to-end against real Radicale:
  1. Owner creates the share: `POST /.sharing/v1/map/create` with
     `PathOrToken` = **the path under the recipient's own principal**
     where the share should appear (e.g. `/shareduser/testuser-personal/`
     -- not a path under the owner's own principal, which 403s: the
     `Access` check is against the *recipient's* rights on
     `PathOrToken`), `PathMapped` = the real collection
     (`/testuser/personal/`), `User` = recipient's username, `Permissions`.
     All sharing-API paths need a **leading slash** (bare
     `"testuser/personal/"` 500s with an `AssertionError` deep in
     `pathutils.strip_path` -- `sanitize_path` requires a leading `/`).
  2. Both sides must separately call `map/enable` and `map/unhide` with
     the same `PathOrToken` (owner first, then recipient) before the
     share is live -- a share sits inert (both `EnabledBy*`/`HiddenBy*`
     flags false/true) until both confirm.
  3. Once both sides have enabled/unhidden it, the collection is
     literally mounted: `PROPFIND /shareduser/` (depth 1) returns
     `/shareduser/testuser-personal/` as a real `C:calendar` resource
     with the owner's display name carried over -- and confirmed via the
     app itself, `GET /api/calendars` as `shareduser` now lists it
     automatically, with **zero app code changes**, through the exact
     same unmodified `discoverCalendars()` path used for every other
     calendar.
  4. **Write access resolved**: SHARING.md's documented Permissions
     vocabulary (`r`/`p`/`P`/`e`/`E`) looked read-only, and a share
     created with `Permissions: "r"` did correctly 403 on `PUT`. But
     `map/update` with `Permissions: "rw"` was accepted with no error,
     and a subsequent `PUT` through the mounted path returned `201` and
     genuinely landed in the owner's real collection (confirmed by
     reading it back via the owner's own direct path) -- `w` is a real,
     working letter for map-share `Permissions` despite not appearing in
     SHARING.md's examples. Update/delete through the mounted path also
     confirmed working (`204`/`200`, each verified by an independent
     read showing the change), both via raw curl and via the app's own
     `POST`/`PUT`/`DELETE /api/calendars/:id/events` routes using the
     calendar id the app itself discovered.
- **Third spike: Baikal, confirmed working too.** Earlier iterations of
  this file said Baikal's sharing was "undocumented/DB-level-in-places and
  untestable" based on old GitHub issues (#704, #1108) describing
  sabre/dav's `Sharing` plugins as off by default and broken when manually
  wired up. **That's stale for the actual current Baikal release
  (0.11.1)**: reading `Core/Frameworks/Baikal/Core/Server.php` directly
  shows both `Sabre\DAV\Sharing\Plugin` and `Sabre\CalDAV\SharingPlugin`
  are **unconditionally registered** whenever CalDAV is enabled -- no
  config flag, no manual wiring needed, unlike what those older issues
  described for older versions. See "Baikal instance" below for how it's
  set up. Sharing flow, confirmed end-to-end:
  1. Owner sends an invite: `POST` to the calendar collection URL
     (`/dav.php/calendars/testuser/default/`) with a `cs:share` XML body
     (`xmlns:cs="http://calendarserver.org/ns/"`), `<cs:set><d:href>` =
     **`mailto:` + the recipient's actual registered email address**, not
     their username -- using the username alone silently creates a
     `calendarinstances` row with an empty `principaluri` (invite
     effectively lost; confirmed via direct sqlite/PDO inspection of
     `Specific/db/db.sqlite`, `share_invitestatus` was `4` =
     `INVITE_INVALID` per `Sabre\DAV\Sharing\Plugin`'s constants), plus
     `<cs:read-write/>` for write access (`<cs:read/>` also exists for
     read-only).
  2. Unlike Radicale's map shares, **no separate accept/enable step** --
     the invite auto-accepts (`share_invitestatus` = `2` =
     `INVITE_ACCEPTED`) and is immediately mounted at
     `/dav.php/calendars/<recipient>/<random-uuid>/` with
     `resourcetype` including `cs:shared` (vs. `cs:shared-owner` on the
     owner's own calendars) -- visible immediately via a plain `PROPFIND`
     on the recipient's calendar-home, and (confirmed) via this app's own
     unmodified `GET /api/calendars`.
  3. Full CRUD confirmed both via raw curl (`PUT`→201, `PUT`
     again→204, `DELETE`→204, each verified by an independent read via
     the owner's own direct path showing the change) and through the
     app's own routes using the app-discovered calendar id.
- **Two real app bugs found and fixed by this Baikal testing** (neither
  was catchable against Radicale alone -- this is exactly the "Never run
  against Baikal" gap the previous iteration of this file flagged as
  unverified):
  1. **`Calendar.color` could come back as a malformed object, not a
     string.** `DavCalendarStore.discoverCalendars` had
     `color: cal.calendarColor ?? '#0082c9'` -- fine against Radicale,
     which always returns a real color string, but Baikal's default
     calendar has no color ever set and returns a genuinely *empty* XML
     element (`<x1:calendar-color xmlns:x1="..."></x1:calendar-color>`).
     tsdav's XML parser turns that into `{ _attributes: {...} }` rather
     than an empty string -- truthy, so `??` never caught it, and the API
     shipped a non-string `color` field straight into a `Calendar`
     response. Fixed with an explicit `typeof === 'string'` check
     (`DavCalendarStore.ts`).
  2. **Fastify's default max route-param length (100 chars) 414'd every
     request with a real calendar id, against Baikal specifically.**
     Radicale's shorter collection URLs
     (`http://localhost:5232/testuser/personal/`) stayed under the limit
     by luck; Baikal's longer ones
     (`http://127.0.0.1:8080/dav.php/calendars/shareduser/<uuid>/`),
     once base64url-encoded into a calendar id, exceeded it, so every
     `/api/calendars/:id/...` route 414'd. Fixed by passing
     `maxParamLength: 500` to the `Fastify(...)` constructor
     (`server/src/index.ts`).
- **Built: the "Share this calendar" UI**, once it became clear driving
  the raw APIs by hand was unpleasant enough to be worth a real feature.
  `server/src/dav/sharing.ts`'s `shareCalendar()` tries
  `tryRadicaleShare()` first, falls back to `tryBaikalShare()` on any
  failure, and throws a combined `ShareFailedError` (→ `422`, not a
  generic 500) with both attempts' error messages if neither works --
  deliberately not silently succeeding, since Baikal itself has exactly
  this failure mode (see next bullet).
  1. **Radicale side** (`tryRadicaleShare`) does `map/create` then
     `map/enable` + `map/unhide` as the owner -- i.e. the app automates
     the owner's half of the workflow documented above.
     `PathOrToken` is built as `/${recipient}/${ownerUsername}-${slug}/`
     so distinct shares from different owners don't collide in the
     recipient's namespace.
  2. **Baikal side** (`tryBaikalShare`) sends the `cs:share` POST, then
     -- critically -- **re-fetches `cs:invite` and checks the specific
     entry's status before reporting success**, because Baikal returns a
     plain `200 OK` even when the recipient can't be resolved at all
     (confirmed by spike-testing: a `mailto:` address with no matching
     user silently produces a `cs:invite-invalid` entry, no error
     response). Skipping this check would mean the UI lies about success.
     **Gotcha hit while building this**: the XML parser (`xml-js`,
     `compact: true`) keys elements by their literal wire tag name --
     Baikal's response declares `xmlns:d="DAV:"` as a *prefixed*
     namespace, so the href is under the key `'d:href'`, not `'href'`.
     A hand-written sample XML used to sanity-check the parser during
     development happened to use `xmlns='DAV:'` as an unprefixed default
     namespace instead, which produced `'href'` and masked this until
     tested against Baikal's real response body -- worth remembering if
     this parsing code is ever extended to other `cs:` properties.
  3. Both mechanisms confirmed end-to-end through the real route (not
     just the underlying protocol calls) against both live dev servers,
     including the Baikal failure path (unresolvable recipient → clean
     `422`, not a false `200`).
- **Built: unsubscribe (recipient) and delete (owner) for shared calendars.**
  `DELETE /api/calendars/:id` (owner-only, deletes the whole collection --
  also revokes it for every recipient) and `POST
  /api/calendars/:id/unsubscribe` (recipient-only, removes just the
  current user's own view, leaving the owner and any other recipients
  untouched). `CalendarStore.deleteCalendar`/`unsubscribeCalendar` added
  to the interface, implemented in both `DavCalendarStore` (real DAV
  calls) and `SqliteCalendarStore` (write-through + purges the
  calendar's cache rows). `unsubscribeFromCalendar()`
  (`server/src/dav/sharing.ts`) tries Radicale's map `hide` action first
  (the one toggle a non-owner `User` is permitted to call per
  `radicale/sharing/__init__.py`'s POST handler -- confirmed by reading
  it directly, not just SHARING.md), then falls back to a plain DAV
  `DELETE` for Baikal -- confirmed by reading
  `CalDAV/Backend/PDO.php::deleteCalendar()`: it looks up the *instance's*
  access level and only wipes the real collection when that's
  `ACCESS_SHAREDOWNER`, otherwise (a recipient's `ACCESS_READ`/`ACCESS_READWRITE`
  instance) it deletes just that one `calendarinstances` row. Owner delete
  reuses this same plain `DELETE`, which is exactly what makes the
  Baikal-recipient path safe for a shared calendar but only when `hide` is
  tried and fails first for Radicale -- a raw `DELETE` against a Radicale
  map-mounted path would transparently delete the *owner's real*
  collection through the resolver, since Radicale's map resolver applies
  to every method, not just reads. **Trust boundary, same shape as the
  existing "share button hidden client-side on already-shared calendars"
  pattern**: this only stays safe because the unsubscribe route is meant
  to be called exclusively from the "Shared with me" list, never a user's
  own calendars -- there's no server-side check distinguishing "this
  calendar is actually shared to me" from "this is my own calendar" at
  the route level beyond what `hide`'s own owner/user permission check
  enforces on Radicale (Baikal has no such check at all: a plain `DELETE`
  from an owner on their own `ACCESS_SHAREDOWNER` calendar *is* the
  intended full-delete behavior, which is why the two routes share one
  code path there).
  Frontend: `CalendarListItem.vue` gets a 🗑 delete button on owned
  calendars and a ✕ unsubscribe button on shared-with-me ones, both
  behind a native `confirm()` (no custom confirm-dialog component exists
  elsewhere in the app to match, so this follows the simplest available
  pattern rather than introducing one); `stores/calendars.ts` gets
  `deleteCalendar`/`unsubscribeCalendar` actions that call the API then
  drop the calendar from local state (list, `enabled`, color overrides).
  **Verified end-to-end against both real dev servers**: Radicale --
  created a throwaway calendar and deleted it as owner (204, gone from a
  follow-up `GET /api/calendars`); unsubscribed `shareduser` from an
  existing map-shared "Test" calendar (`hide` path) and confirmed it
  vanished from `shareduser`'s list while `testuser` (the owner) still
  saw it unchanged afterward. Baikal -- created and shared a calendar to
  `shareduser`, unsubscribed as `shareduser` (plain-`DELETE` path) and
  confirmed the same owner-untouched/recipient-gone split; separately
  deleted a different owned+shared calendar as the owner and confirmed it
  vanished from *both* users' lists (full delete, not just the owner's
  instance).
- **Bug found via real usage, fixed**: unsubscribing from a Radicale share
  and refreshing the page brought the invite right back in "Pending
  shares." Root cause: Radicale's `hide` action (what unsubscribe uses,
  see above) has no separate "declined" state -- a hidden-but-owner-
  enabled share is byte-for-byte identical to one never accepted, so
  `listPendingRadicaleShares` correctly-but-unhelpfully listed it as
  pending again on the very next load. There's no way to fix this
  server-side without Radicale gaining a real decline state, and the
  recipient has no permission to actually delete the owner's share record
  (`map/delete` is owner-only, confirmed by reading
  `radicale/sharing/__init__.py`'s POST handler). Fixed with client-side
  suppression: `PendingShare` gained `updatedAt` (Radicale's
  `TimestampUpdated`, ms), `UnsubscribeResult.dismissedPending` returns
  `{ pathOrToken, dismissedAt }` when the hide path was used, and
  `stores/calendars.ts` persists a `pathOrToken -> dismissedAt` map to
  localStorage (`calendar.dismissedPendingShares`, same pattern as color
  overrides). `PendingSharesList.vue` filters out any pending entry whose
  own `updatedAt` hasn't moved past its recorded `dismissedAt` -- so it
  stays hidden until the owner does something new with that specific
  share (which bumps `TimestampUpdated` past the dismissal point). Also
  added a plain "Dismiss" button directly on the pending-shares list
  (`stores/calendars.ts`'s `dismissPending()`, no server call needed --
  a pending share is already hidden/unaccepted by definition) for shares
  that were already stuck in this state before the fix shipped, since
  those never went through the new unsubscribe code path that records a
  dismissal. **Verified against real Radicale**: confirmed via three live
  fixture shares (Personal/Work/Test, all `EnabledByUser: true,
  HiddenByUser: true` from earlier manual unsubscribe testing, `TimestampUpdated`
  clustered ~3s apart) that this was really from a human clicking
  Unsubscribe on all three in the UI, not a bug in the unsubscribe call
  itself; then confirmed end-to-end with a fresh throwaway share that
  `POST .../unsubscribe`'s returned `dismissedAt` postdates the share's
  own `updatedAt`, which is exactly the condition `PendingSharesList.vue`
  filters on.
- **Second bug found via real usage, fixed**: deleting an owned calendar
  that had been shared out (Radicale) left a dangling share record behind
  -- `deleteCalendar()`'s plain DAV `DELETE` removes the physical
  collection but never touched Radicale's separate sharing database, and
  `sharing_collection_by_map_resolver` never checks that `PathMapped`
  still exists. Since the stale entry was still `EnabledByUser` from
  before, `listPendingRadicaleShares` kept showing it to the recipient as
  a legitimate-looking pending invite for a calendar that no longer
  existed -- reported as "a calendar came back" after removing a
  recipient from a share, traced to exactly this (a leftover share record
  from an earlier delete during this feature's own development).
  Fixed with `deleteRadicaleSharesForPath(ctx, pathname)`
  (`server/src/dav/sharing.ts`), called from `DavCalendarStore.deleteCalendar`
  right after a successful `DELETE`: fetches every map share the owner has
  (`fetchRadicaleMapList`, already used elsewhere), filters to the ones
  pointing at the just-deleted `PathMapped`, and calls `map/delete` on
  each. Best-effort/fails-open, same spirit as the rest of this file's
  Radicale sharing code -- the calendar is already gone by the time this
  runs, so a failure here is a hygiene issue, not a correctness one. No
  Baikal equivalent needed: Baikal's own `deleteCalendar` (PDO backend)
  already wipes every `calendarinstances` row, shared or not, in the same
  `DELETE` when the caller's access is `ACCESS_SHAREDOWNER` (see the first
  "Built: unsubscribe/delete" entry above). **Verified against real
  Radicale**: shared a fresh calendar to `shareduser`, confirmed the share
  appeared in `map/list`, deleted it as the owner, confirmed the share
  entry was gone from `map/list` immediately afterward (previously it
  would have survived).
- **Third bug found via real usage, fixed**: re-sharing a calendar to a
  recipient who had previously unsubscribed from it failed with `Radicale
  map/create failed: 409` (the combined error message also always shows a
  Baikal 405 alongside it -- expected noise from the try/fallback design
  when the actual server is Radicale, not itself a bug). Root cause:
  `tryRadicaleShare`'s `PathOrToken` is deterministic
  (`/${recipient}/${owner}-${slug}/`), and unsubscribe only hides the
  recipient's side (see above) rather than deleting the share record, so
  re-sharing collides with the still-existing (but hidden) entry --
  Radicale's `map/create` correctly 409s on an existing `PathOrToken`.
  Fixed: on a 409, `tryRadicaleShare` now looks up the existing entry via
  `fetchRadicaleMapList` (matching `Owner`+`PathMapped`+`User`), resets
  its `Permissions` via `map/update` (in case read/readwrite changed), and
  runs the same owner-side enable+unhide it would for a brand-new share
  -- reported as `pending: true` either way, since the recipient still
  needs to unhide their own side regardless of which path was taken.
  **Verified against real Radicale**: shared a fresh calendar, accepted it
  as the recipient, unsubscribed, then re-shared to the same recipient --
  previously 409'd, now succeeds and correctly reappears in the
  recipient's pending list.
- **Fourth bug, a clock-domain bug in the fix for the first one above,
  found via real usage and fixed**: the "resurface only if the owner did
  something new" dismissal check almost never worked once real wall-clock
  time was involved, because `PendingShare.updatedAt` (Radicale's
  `TimestampUpdated`) and the dismissal timestamp were being read from two
  different clocks. Root cause, found by reading
  `radicale/sharing/__init__.py` directly: Radicale computes
  `TimestampUpdated` as `int((datetime.now() - datetime(1970, 1,
  1)).total_seconds())` -- `datetime.now()` is the server host's **naive
  local time**, subtracted from a naive epoch, which silently computes
  "seconds since local midnight 1970" and reports it as if it were a real
  Unix timestamp. On this dev host (EDT, UTC-4) every `TimestampUpdated`
  therefore comes back ~4 hours behind true UTC. The dismissal write path
  (`PendingSharesList.vue`'s "Dismiss" button, and
  `unsubscribeFromCalendar`'s returned `dismissedAt`) was using the
  browser's/Node's real `Date.now()` for the *other* side of the `>`
  comparison in `PendingSharesList.vue`'s `load()` -- so a dismissal
  recorded via `Date.now()` would almost always be numerically *larger*
  than any subsequent Radicale-clock `updatedAt`, permanently suppressing
  a share even after the owner took a genuinely new action on it. Fixed
  by keeping both sides of every comparison on Radicale's own clock: the
  "Dismiss" button now stores `share.updatedAt` (a value already sourced
  from Radicale) instead of `Date.now()`, and `unsubscribeFromCalendar`
  re-fetches the share's own fresh `TimestampUpdated` via
  `fetchRadicaleMapList` right after a successful `hide` instead of
  stamping the moment with the Node process's `Date.now()`. **Verified
  against real Radicale**: confirmed the returned `dismissedAt` now
  exactly equals the share's own `updatedAt` as independently re-fetched
  from `GET /api/sharing/pending` immediately afterward, on a host with a
  non-UTC local clock -- previously these differed by the host's full UTC
  offset in exactly the direction that broke the comparison.
- **Fifth bug, a stale-data fallout of the fourth one, found via real
  usage and fixed**: fixing the clock-domain bug above didn't actually
  un-stick an already-corrupted dismissal -- a `dismissedAt` saved by the
  old code (real `Date.now()`, always larger than any Radicale-clock
  `updatedAt`) permanently suppresses that share in `localStorage`
  regardless of what the server reports afterward, since the fix only
  changes how *new* dismissals are computed. Confirmed by testing: after
  re-sharing "Personal" (previously unsubscribed-from under the old, buggy
  code), the server correctly bumped `updatedAt` and `GET
  /api/sharing/pending` reported it, but it still didn't show up client-side
  because of the stale `localStorage` entry. Fixed by renaming the
  `localStorage` key (`calendar.dismissedPendingShares` ->
  `calendar.dismissedPendingShares.v2` in `stores/calendars.ts`) rather
  than trying to detect/repair individual bad entries after the fact --
  there's no reliable way to tell a corrupted v1 entry from a valid one,
  and losing a dismissal is a one-click, no-cost mistake to recover from
  (the "Dismiss" button re-hides it instantly) versus a silently-still-wrong
  entry surviving under any per-entry repair heuristic.
- **Sixth bug, CRITICAL, found via code review and confirmed by an actual
  (costly) test**: `unsubscribeFromCalendar`'s original fallback logic --
  "try Radicale's map `hide`; if the response isn't a success, assume
  this must not be a Radicale share and fall back to a plain DAV
  `DELETE`" -- is not safe. A raw `DELETE` issued by the recipient
  against their own *mounted* Radicale map path does **not** merely
  remove their own instance the way Baikal's equivalent does: Radicale's
  map resolver transparently forwards `DELETE` to the owner's real
  underlying collection with no additional permission check beyond the
  share's `Permissions` string, which this app always sets to `r`/`rw`
  (never anything that would block a full collection delete). **This was
  confirmed by directly testing the exact call during this review** --
  `shareduser` issuing a plain `DELETE` against their own mounted
  `/shareduser/testuser-personal/` returned `200`, and the real owner
  collection `/testuser/personal/` was immediately, irreversibly gone (404
  on a direct PROPFIND afterward -- Radicale's filesystem storage has no
  trash/undo). **This destroyed the actual "Personal" fixture's event
  data during this session** (recreated the empty collection at the same
  path and re-shared it to restore the documented fixture setup below,
  but the original events inside it are gone for good). Fixed: the
  decision between `hide` and `DELETE` is now made by *positively
  confirming* the calendar is a Radicale map share the current user
  actually receives (`fetchRadicaleMapList` matching `User`+`PathOrToken`)
  **before** doing anything -- if it is, only `hide` is ever attempted,
  and any failure there throws rather than falling through to `DELETE`;
  `DELETE` is only reached when this lookup confirms it's *not* a
  Radicale share (Baikal, or any server where `fetchRadicaleMapList`
  fails open to `[]`). Re-verified end-to-end afterward: a fresh
  Radicale share's unsubscribe still correctly uses `hide` and the
  owner's real collection survives it.
  **General lesson worth remembering for any future work on this file**:
  "operation A failed, therefore condition X must be false" is not a safe
  basis for choosing a destructive fallback B -- confirm X independently
  first, especially when B is irreversible and A's failure could have
  many other causes (transient error, wrong path, share already gone,
  etc).
- ~~Known limitation~~: closed, see "Built: in-app accept flow" below --
  the recipient's independent `map/enable`+`map/unhide` step now has a
  real in-app UI (`PendingSharesList.vue`) instead of needing to be done
  outside the app.
- **Built: "Shared with me" section.** `CalendarList.vue` now splits into
  two headed `<ul>`s (own calendars, then "Shared with me" -- only
  rendered when non-empty) based on a new `Calendar.isShared` field.
  Detected differently per server, since Radicale gives no signal at all
  on the calendar object itself:
  - **Baikal**: `resourcetype` includes a `cs:shared` marker (vs.
    `cs:shared-owner` on a calendar the user owns) -- tsdav already fetches
    `resourcetype` by default and strips/camelCases the `cs:` prefix to
    `shared`, so this was free to read once discovered (`cal.resourcetype`
    on the object `client.fetchCalendars()` already returns).
  - **Radicale**: confirmed by testing that a map-shared calendar's
    `resourcetype` is **identical** to an owned one -- no marker exists.
    The only way to know is to separately call `/.sharing/v1/map/list` and
    cross-reference (`listRadicaleSharedPaths()` in `sharing.ts`, called
    once per `discoverCalendars()`, best-effort/fails-open to "no shares"
    so a server with sharing disabled doesn't break discovery). **Bug hit
    while building this**: the list entries' `PathMapped` field is the
    *owner's* real collection path, but `fetchCalendars()` returns each
    calendar's URL as it's *mounted* under the viewing user's own
    principal -- comparing against `PathMapped` matched nothing at all;
    the fix was comparing against `PathOrToken` (the mounted path)
    instead. Confirmed working end-to-end afterward against both servers
    (a user with only shared calendars correctly showed 100% of them under
    "Shared with me"; a user with one shared + one owned calendar on
    Baikal correctly split 50/50).
  - The share (↗) button is hidden on already-shared calendars
    (`CalendarListItem.vue`) -- this app has no way to re-share a
    calendar you don't own, and showing the button there would imply
    otherwise.
  - SQLite cache schema gained an `is_shared` column
    (`store/sqlite/schema.ts`); no migration system exists yet, but this
    is safe since `CACHE_ENABLED` has never been turned on this session
    and the column only matters once it is.
- **Built: in-app accept flow for the Radicale "recipient must
  independently enable+unhide" gap**, closing the "Known limitation"
  noted above. `GET /api/sharing/pending` (`listPendingRadicaleShares()`
  in `sharing.ts`) lists Radicale map shares where the current user is
  the recipient but hasn't yet both enabled *and* unhidden their own
  side (a share explicitly re-hidden after accepting is treated as
  pending again -- Radicale's model has no separate "declined" state,
  only hidden/not); `POST /api/sharing/pending/accept` (body
  `{ pathOrToken }`) does the enable+unhide on the recipient's behalf.
  Frontend: `PendingSharesList.vue`, shown above the calendar list only
  when non-empty, one row per pending share ("`<owner>` shared
  `<label>`" + an Accept button); accepting refetches the calendar list
  so the newly-accepted share immediately appears under "Shared with
  me" with no separate reload needed. Baikal has no equivalent concept
  at all (its shares auto-accept) -- `listPendingRadicaleShares` always
  returns `[]` there, same fails-open pattern as `listRadicaleSharedPaths`.
  - **`label` fix**: originally just the last path segment of
    `PathMapped` -- fine for a hand-created collection like
    `/testuser/personal/`, but for a calendar *this app* created
    (`createCalendar`'s collection slug is `crypto.randomUUID()`, not a
    readable name), that showed the recipient a raw UUID instead of the
    calendar's actual name. Confirmed by testing that a direct
    `PROPFIND` on the share's own `PathOrToken` returns the real
    `displayname` even *before* the recipient accepts (while still
    hidden) -- `fetchShareDisplayName()` now fetches this per pending
    share and only falls back to the path-segment guess if that fails.
    Radicale's own PROPFIND responses use `displayname` unprefixed
    (default `xmlns="DAV:"`), unlike Baikal's `d:`-prefixed `d:href`
    from the earlier `cs:invite` parsing gotcha -- `findDisplayName()`
    checks both forms defensively even though this path is Radicale-only.
  - Also added a `title` attribute (native tooltip on hover) to both the
    calendar-list name (`CalendarListItem.vue`) and the pending-share
    label (`PendingSharesList.vue`) -- both use `overflow: hidden` +
    `text-overflow: ellipsis` in the narrow sidebar, so a long name gets
    visually truncated; hovering now shows the full text.
  **Verified end-to-end against real Radicale** via the app's own routes
  (not just the underlying Radicale calls): created a share with only
  the owner's side enabled, confirmed it appeared in `GET
  /api/sharing/pending` as `shareduser` and did *not* yet appear in `GET
  /api/calendars`, accepted it via `POST /api/sharing/pending/accept`,
  confirmed it vanished from pending and appeared in `/api/calendars`
  with `isShared: true`.
- **Dev-instance side effects, both git-untracked (same as the rest of
  `.dev-radicale/`)**:
  - `.dev-radicale/config/config` has a `[rights]` section (custom
    `from_file` rights, replacing the previous zero-config `owner_only`
    default -- reimplements equivalent behavior for every user plus one
    extra rule from the first spike) and a `[sharing]` section
    (`permit_create_map = true`, `collection_by_map = true`, `type =
    files`, database under `.dev-radicale/data/collection-db/`).
  - A second user (`shareduser`/`shareduser`) exists in
    `.dev-radicale/config/users` alongside `testuser`.
  - Two live, fully-accepted map shares now exist as reusable test
    fixtures: `testuser`'s Personal calendar shared to `shareduser` at
    `/shareduser/testuser-personal/`, and `testuser`'s Work calendar at
    `/shareduser/testuser-work-pending/` (name is a leftover from
    accept-flow testing -- it's fully accepted now, not actually
    pending, despite the path). Both `Permissions: "rw"`,
    enabled+unhidden on both sides. Useful for future testing without
    redoing this setup; if rights- or sharing-related behavior looks
    wrong later, check `.dev-radicale/config/rights` and `[sharing]` in
    `.dev-radicale/config/config` first.
- Also re-confirmed, in passing, the same transient-404 quirk noted
  elsewhere in this file: a `calendar-query` REPORT against a
  freshly-written object occasionally 404s once immediately after the
  write, then succeeds on retry. Not investigated further; retry-tolerant
  by nature of how the app already polls.

## Calendar creation

`POST /api/calendars` (`server/src/routes/calendars.ts`), `CalendarStore.createCalendar()`
in both `DavCalendarStore` (issues a real `MKCALENDAR` via `client.makeCalendar()`,
collection URL is `<calendar-home-set>/<random uuid>/`) and `SqliteCalendarStore`
(pass-through + upserts the new row into the `calendars` cache table so it's
visible immediately without waiting on the next `discoverCalendars` call).
Frontend: inline "+ New calendar" form at the bottom of `CalendarList.vue`
(name + color, no modal). Delete now exists (`DELETE /api/calendars/:id`,
see "Calendar sharing" for its interaction with shares) — rename
(`PATCH /api/calendars/:id`) still doesn't.

**Verified against real Radicale**: created a calendar via the API, confirmed
it round-trips through a separate `GET /api/calendars` call afterward (a
real new CalDAV collection, not just an artifact of the create response),
then cleaned it up with a direct `DELETE` against Radicale (the app itself
has no calendar-delete route to do this through).

**Bug found and fixed**: creating a calendar (or adding a subscription)
mid-session, then adding an event to it, silently never showed the event on
the calendar grid -- no console error, because the write itself succeeded
(confirmed 201 in server logs). Root cause: `loadVisibleRange()` in
`CalendarView.vue` was only ever triggered by FullCalendar's `onDatesSet`
(date navigation); nothing re-ran it when the set of enabled calendars or
subscriptions changed mid-session. Worse, `eventsStore.reloadLastRange()`
(called after every create/update/delete) replays `lastLoadedIds`, a
snapshot of calendar IDs captured *before* the new calendar existed, so
even the post-write refetch never picked it up. Fixed with two `watch()`s
in `CalendarView.vue` -- one on `enabledCalendarIds`, one on a new
`enabledSubscriptionIds` computed -- both calling `loadVisibleRange()` on
change. Confirmed via server request logs that the calendar-events half of
this now works (the new calendar's `/events` endpoint is polled and
returns 200 after being created mid-session). Not independently
re-verified in a browser by this session (no browser tool was available)
-- diagnosed from server logs plus reading the store code.

**Three more bugs found by code review (client never exercised in a
browser, per the note above) and fixed in the same pass as the read-only
calendar-picker gap documented under "Read-only calendar support"**:

- `EventEditDialog.vue`'s `parseIcalUntil()` (recurrence end-date display)
  used `.toLocal()` -- the browser's zone -- instead of the event's own
  zone, unlike every other date field in that file (see the file's own
  top-of-component comment on why that matters). A viewer in a different
  timezone than an event with a recurring `UNTIL` could see the end date
  silently off by a day, and re-saving without touching that field baked
  the shift into the stored `UNTIL`. Fixed by threading `initialZone`
  through `parseRepeat`/`parseIcalUntil` the same way `initialDate`/
  `initialTime` already do.
- No client-side handling of a session expiring mid-tab: `api.ts`'s
  `request()` had no special case for a 401, so once the session TTL
  (`SESSION_TTL_SECONDS`, default 24h) lapsed with the tab still open,
  every subsequent save/delete/drag/resize just failed with a generic
  "Failed to ..." banner and no indication the user needed to sign in
  again -- easy to hit for a calendar app, which people leave open all
  day. Fixed with a `SESSION_EXPIRED_EVENT` `window` event dispatched from
  `request()` on any non-`/session` 401, handled in `App.vue` by clearing
  the session store and routing to `/login?expired=1`; `LoginView.vue`
  shows "Your session expired. Please sign in again." when that query
  param is present.
- `eventsStore.reloadLastRange()` (called after every create/update/delete)
  always force-refetched *every* currently-enabled calendar's visible
  range, not just the one calendar that actually changed -- editing one
  event on one calendar re-fetched all of them, bypassing the 30s
  freshness cache entirely, and getting more expensive as more calendars
  are enabled. Fixed by giving `loadRange`'s `force` param an array form
  (force only those ids; everything else still goes through the normal
  freshness check) and having `reloadLastRange(calendarIds?)` pass through
  the specific calendar(s) a given write actually touched -- both the
  source and destination when `updateEvent` moves an event to a different
  calendar. The 412-conflict and drag/resize-failure recovery paths still
  call `reloadLastRange()` with no args (full refresh), since those are
  rare error-recovery cases, not the common path.

**Second, unrelated bug found via the user's actual browser console**:
subscriptions' "Add" button appeared to do nothing, with no visible error.
Root cause: `stores/subscriptions.ts`'s `add()` called `crypto.randomUUID()`
directly, which only exists in a secure context (HTTPS, or the literal
hostname `localhost`) -- accessing the app over plain HTTP via a LAN IP
(e.g. `http://192.168.10.50:5173`, the way this app is normally reached
from another device, see "External access" below) leaves it `undefined`,
so the call threw *before* the new subscription was ever pushed into the
store -- the sidebar list genuinely never updated, it wasn't a rendering or
reactivity bug. Fixed with a `generateId()` helper that falls back to a
non-crypto id (`Date.now().toString(36)` + random suffix) when
`crypto.randomUUID` isn't available; fine since this id is only ever a
local-storage key, never sent to a server. No other client-side
`crypto.*` call exists to audit for the same issue.

## External access

The client dev server must be started with `vite --host 0.0.0.0` (not the
bare `vite` in `client/package.json`'s `dev` script) to be reachable from
another device on the LAN, e.g. `http://192.168.10.50:5173`. The API
server already binds `0.0.0.0` by default (`server/src/index.ts`). This is
plain HTTP with no firewall/auth in front of it -- fine on a trusted LAN,
not something to expose past that as-is. Being on plain HTTP + a non-
`localhost` hostname also means secure-context-only browser APIs
(`crypto.randomUUID()`, discovered the hard way above) are unavailable --
worth checking for before adding any other such API client-side.

## Docker packaging

Single-image build (`Dockerfile` at repo root) rather than separate
server/client images -- justified by `server/src/index.ts` already
serving the client's build output itself via `@fastify/static` registered
against `../../client/dist` (relative to `server/dist/index.js`), so there
was never a second server to split out.

- Multi-stage: a `build` stage with `python3`/`make`/`g++` installed (only
  needed so `npm ci` can compile `better-sqlite3`'s native addon when no
  prebuilt binary matches the image's exact platform/arch/Node ABI), then
  `npm run build` (root script: shared -> server -> client, in that
  order, matching their dependency direction) and `npm prune --omit=dev`
  to drop dev-only deps (`vite`, `vue-tsc`, `tsx`, `vitest`, `typescript`,
  ...) while keeping the already-compiled native binary. A `runtime` stage
  (no build toolchain) copies over just `node_modules`, each workspace's
  `package.json` + `dist`, and `client/dist`.
- **This depends on the npm workspaces symlink layout**: `node_modules/@yourcal/{shared,server,client}`
  are relative symlinks (`../../shared` etc, confirmed by inspecting the
  actual symlinks on disk) -- copying `node_modules` verbatim and
  separately recreating each workspace's `package.json`+`dist` at the same
  relative path is what makes those symlinks resolve correctly in the
  final image without carrying `src/` for any of them. `client/package.json`
  itself is deliberately **not** copied into the runtime stage -- nothing
  ever `require()`s `@yourcal/client` (the client's build output is served
  as static files, not imported as a module), so the dangling
  `node_modules/@yourcal/client -> ../../client` symlink pointing at a
  `dist`-only directory is harmless.
- `docker-compose.yml` wires `SESSION_SECRET` (required, no default --
  `openssl rand -hex 32`, since `server/src/session.ts` decodes it
  directly as raw 32-byte key material), `ALLOWED_CALDAV_HOSTS`,
  `CACHE_ENABLED`/`CACHE_SYNC_TTL_MS`, and a named volume at
  `/app/data` (only load-bearing when caching is on -- see "SQLite
  read-cache" below). `.env.example` documents the same variables for a
  local `.env` (gitignored).
- **Known interaction worth flagging, not fixed**: the Dockerfile sets
  `NODE_ENV=production`, which makes `server/src/session.ts` mark the
  session cookie `Secure` -- a browser will refuse to send it over plain
  HTTP. This directly conflicts with the "External access" pattern
  documented above (reaching the app over plain HTTP via a LAN IP) --
  anyone deploying this container beyond `localhost` needs a
  TLS-terminating reverse proxy in front, or to consciously override
  `NODE_ENV` in `docker-compose.yml` and accept the cookie going out over
  plain HTTP. Deliberately not silently downgraded here since that's a
  real security tradeoff the deployer should make explicitly, not one to
  bury in default packaging.
- **Not verified end-to-end**: this host has no Docker installed (same
  gap noted historically in this file for Baikal, before that got a
  human-driven PHP setup instead) -- the Dockerfile/compose file were
  checked by hand (symlink resolution, the `clientDist` relative-path math
  landing on `/app/client/dist` given the `/app/server/dist/index.js` +
  `/app/client/dist` layout, `npm prune`'s dev/prod boundary) but never
  actually built or run. Whoever has Docker available should run `docker
  compose up --build` and re-run at least a login + one calendar
  read/write through it as a sanity check that packaging didn't change
  behavior, the same verification bar every other feature in this file
  was held to.

## SQLite read-cache (`SqliteCalendarStore`)

Built per the scoping plan at `/home/geoff/.claude/plans/lucky-zooming-moth.md`
(worth reading in full for the schema/design rationale) — the user chose to
build it despite that plan explicitly flagging it as premature (no observed
performance problem). Verified end-to-end against real Radicale:

- Enable with `CACHE_ENABLED=true` (default off — `DavCalendarStore` is used
  directly otherwise). `SQLITE_PATH` (default `./data/cache.db`) and
  `CACHE_SYNC_TTL_MS` (default 30000) are also configurable. See
  `server/src/config.ts`, `server/src/routes/calendars.ts`.
- `server/src/store/SqliteCalendarStore.ts` is a decorator over any
  `CalendarStore` (in practice `DavCalendarStore`) — reads are cache-first
  with TTL-gated sync, writes are always write-through then reflected into
  the cache. `server/src/store/sqlite/{db,schema,userKey}.ts` are the
  supporting pieces. Cache key is `sha256(baseUrl + username)` — never the
  password, which is never persisted to SQLite (see `userKey.ts`).
- Tables use `STRICT` (better-sqlite3 v13 bundles a SQLite new enough to
  support it) — pinned to `^13.0.1` per explicit user request ("major
  improvements" they wanted, though the concrete thing actually used here
  is just `STRICT` tables; worth asking what else they had in mind if this
  gets revisited).
- **Verified**: cold-cache correctness (first read matches uncached
  response), warm-cache hit is ~74x faster than a cold sync (9ms vs
  669ms, measured against local Radicale — likely a much bigger delta
  against a real remote server, which is exactly the case this was built
  for despite not having been observed as a problem yet), write-then-read
  consistency (a created event is visible immediately, before the next
  sync), external-change staleness is correctly bounded by the TTL
  (invisible immediately after an out-of-band write, visible once the TTL
  elapses), and the 412-conflict + recurring this-occurrence edit-scope
  tests (both from earlier in this file) re-pass unchanged through the
  cached path — including the `getRawObject` cache-hit case specifically,
  which is the one piece of state the whole cache design hinges on
  (see "Architecture reminders" below, and the plan doc).
- **Not implemented / explicitly out of scope for v1** (per the plan):
  cross-device invalidation beyond the TTL bound, background/interval sync
  workers, pre-expanded occurrence caching, cache eviction. `GET
  /:id/events` still doesn't have a real remote-server timing comparison —
  the 74x number above is against localhost Radicale, which is not the
  case this cache actually matters for.

## tsdav / ical.js API notes (things that weren't guessable, had to check dist/*.d.ts)

- `createDAVClient(...)` (the standalone function tsdav exports) returns an
  anonymous object type, **not** the `DAVClient` class — don't type it as
  `DAVClient`. We use `new DAVClient({...}); await client.login()` instead
  (`server/src/dav/client.ts`), specifically because the class exposes
  `.account` after login, which is what proves credentials are valid.
- `client.smartCollectionSync({ ..., detailedResult: true })` returns
  `{ ...collection, objects: { created, updated, deleted } }` — the
  created/updated/deleted arrays are nested under `.objects`, not top-level.
- `ICAL.Event.getOccurrenceDetails(time)` returns `{ item, startDate, endDate, recurrenceId }`.
  **Always use the returned `startDate`/`endDate`, never `item.startDate`** —
  `item` is the master event for plain (non-exception) occurrences, so
  `item.startDate` is the *series* start, not this occurrence's start. This
  is the single easiest mistake to reintroduce if `recurrence.ts` gets
  refactored.
- Exception/override wiring for expansion is `event.relateException(overrideVeventComponent)`
  for each non-master VEVENT sharing a UID, called before `.iterator()`/`.getOccurrenceDetails()`.
- `ICAL.Recur.until` is a plain writable property (`Time | null`), not a
  setter method — and setting it requires also clearing `.count` (a RRULE
  can't have both COUNT and UNTIL). See `editScope.ts`'s `truncateRrule()`.

## Architecture reminders for future work

- The `CalendarStore` interface (`server/src/store/CalendarStore.ts`) is the
  seam a future SQLite mirror slots into. It now includes `getRawObject()`
  in addition to what the original plan sketched — needed because recurring
  writes require the current ICS before an edit-scope transform can run, and
  a stateless proxy has nowhere else to get it. Any mirror implementation
  needs to serve this from its local copy, not re-fetch from CalDAV, or the
  whole point of the mirror is lost.
- `CalendarObject.href` was added to the shared type (not in the original
  plan's sketch) — it's an opaque locator the frontend must echo back
  verbatim on every write, never parse or construct. This is what lets
  `updateObject`/`deleteObject` find the resource without the backend
  keeping any server-side state beyond the session cookie.
- The frontend does **not** patch its event cache in place after a write —
  `useEventsStore`'s `createEvent`/`updateEvent`/`deleteEvent` all just
  await the API call and then refetch the whole visible range. The one
  exception is drag/resize, which gets real optimistic UX for free from
  FullCalendar's own `revert()` mechanism. Fine-grained cache patching
  (avoiding a full reload after every dialog save) is a reasonable later
  optimization, not a correctness issue.

## Feature batch: calendar rename, read-only, per-event color, reminders

Four items from the approved plan at
`/home/geoff/.claude/plans/dazzling-bouncing-frog.md`, all verified against
real Radicale (curl-driven, same discipline as everything else in this
file). Export, conflict UX, share management, and advanced recurrence from
the same plan are not yet built.

- **Calendar rename/edit.** `PATCH /api/calendars/:id` (`server/src/routes/calendars.ts`),
  `DavCalendarStore.updateCalendar` does a raw PROPPATCH (tsdav has no
  wrapper) setting `d:displayname`/`ca:calendar-color`, confirmed working
  against real Radicale including a live rename+recolor+restore round trip.
  Owner-only (403 if `calendar.isShared`), same ownership-check pattern as
  delete/unsubscribe. `SqliteCalendarStore.updateCalendar` write-throughs
  and patches the cached row.
- **Read-only calendar support.** `server/src/dav/privileges.ts`'s
  `isCalendarReadOnly()` does a raw `current-user-privilege-set` PROPFIND
  per calendar (tsdav's `fetchCalendars()` doesn't request this property at
  all) in `DavCalendarStore.discoverCalendars`. **Confirmed by spike-testing
  against real Radicale, and this mattered**: the calendar *owner* gets a
  bare `write` privilege, but a `rw`-permission share *recipient* only ever
  gets `read` + `write-content` — never a plain `write` — and an
  `r`-permission recipient gets only `read`. So `readOnly` has to check for
  the absence of *both* `write` and `write-content`, not just `write`.
  Enforced server-side too, not just discovered: `requireWritableCalendar()`
  in `calendars.ts` gates all four event-write routes (create/import/update/delete),
  403ing before any DAV call — verified live (a `rw`→`r` reshared calendar's
  event-create request correctly 403'd). Client wiring: `Calendar.readOnly`
  now drives `EventDetailPopover`'s existing readOnly UI (previously only
  fed by the ICS-subscription case) and FullCalendar's per-event `editable`.
  **Gap found and fixed in a later session**: none of this reached the
  New Event / Edit Event dialog's own Calendar dropdown or the Import
  dialog's Calendar dropdown — both rendered every calendar including
  read-only ones, so a user could pick one, fill out a whole event (or a
  whole .ics import), and only find out it was rejected after submit hit a
  403, with the create dialog already closed and the typed content gone.
  Fixed by filtering both dropdowns to writable calendars
  (`EventEditDialog.vue`'s `writableCalendars`, `ImportDialog.vue`'s
  `writableCalendars`), keeping the event's current calendar selectable
  even if it's since become read-only so re-pointing it elsewhere still
  works.
- **Per-event color.** RFC 7986 `COLOR`, a plain string VEVENT property (no
  `ICAL.Recur.fromString`-style wrapping trap the way RRULE has).
  `EventFields.color`/`CalendarObject.color`, read/write in `mapper.ts`,
  edit UI in `EventEditDialog.vue` (swatch defaults to the calendar's own
  color when unset). Verified round-tripping through create+read against
  real Radicale. Flows through `editScope.ts` for free (rebuild-from-fields
  architecture), no changes needed there.
- **Event reminders (VALARM).** `EventFields.alarms`/`CalendarObject.alarms`,
  a `{ minutesBefore: number }[]` (v1 scope: `DISPLAY` action, relative
  before-start `TRIGGER` only — an absolute-datetime trigger or an
  after-start/positive-duration trigger is silently not read back, same
  posture `EventEditDialog.vue` already takes for RRULEs it can't parse).
  **Spike-tested before writing any server code** (learned from this file's
  own RRULE `Recur.fromString` gotcha): unlike RRULE, a raw `-PT15M` string
  passed straight to `updatePropertyWithValue('trigger', ...)` serializes
  and re-parses correctly as an `ICAL.Duration` — no typed-value wrapper
  needed. `mapper.ts`'s `buildVeventComponent`/`parseAlarms` do the
  round-trip; `editScope.ts` needs no changes (same rebuild-from-fields
  reasoning as per-event color). **Verified against real Radicale**: created
  an event with two alarms (10 min, 1 day before), confirmed both round-trip
  through the API and confirmed the raw ICS Radicale stored has real,
  standard `BEGIN:VALARM`/`ACTION:DISPLAY`/`TRIGGER:-PT10M`/`TRIGGER:-P1D`
  blocks — portable to any other CalDAV client, not app-only metadata.
  Delivery is in-tab only (explicit user choice, no service worker/push):
  `stores/notifications.ts` requests `Notification` permission only on an
  explicit sidebar button click (never unprompted), and schedules
  `setTimeout`s for alarms firing within the next 24h whenever the visible
  event range changes, re-arming on every load since timers don't survive a
  reload. No background delivery when the tab isn't open — surfaced in the
  UI copy, not just left implicit.
- **Share management** (list/change-permission/revoke shares an owner has
  created) is done for Radicale, verified end-to-end against real Radicale:
  created a share, listed it (`accepted: false` before the recipient
  unhides their side, correctly), changed its permission `rw`→`r` and
  confirmed via re-list, revoked it and confirmed it disappeared from the
  list. `listSharesForCalendar`/`updateSharePermission`/`revokeShare`
  (`server/src/dav/sharing.ts`) follow the same "positively confirm which
  mechanism a share uses before doing anything" discipline as
  `unsubscribeFromCalendar`'s Sixth-bug fix -- never infer Radicale-vs-Baikal
  from a failure. **Baikal side (list/update/revoke) is implemented but
  NOT spike-tested** in this session -- this environment has no PHP
  installed (no `sudo` available to install it, see "How to run a local
  Baikal for testing"), so `updateSharePermission`/`revokeShare`'s Baikal
  branches (`cs:share` re-invite for permission change, `cs:remove` for
  revoke) are written against the calendarserver-sharing draft's documented
  shape but unverified against a real server, unlike everything else
  sharing-related in this file. Surfaces a clear `ShareFailedError` on
  failure rather than silently no-opping, but should be spike-tested
  against real Baikal before being trusted in production. New routes:
  `GET/PATCH/DELETE /api/sharing/calendars/:id/shares[/:token]`
  (`server/src/routes/sharing.ts`), owner-only (403 if `isShared`, same
  pattern as PATCH-calendar/delete). `OwnedShare.token` is a base64url
  encoding of the underlying `PathOrToken` (Radicale) or `mailto:` href
  (Baikal), reusing `idCodec.ts`'s `encodeId`/`decodeId` to avoid a raw
  slash-containing value in a route param. Client: `ShareCalendarDialog.vue`
  gained a "Currently shared with" panel above the invite form, one row per
  share with a permission `<select>` and a revoke button.
- **Advanced recurrence** is done, all three sub-parts verified against
  real Radicale:
  - **Ordinal `BYDAY` ("2nd Tuesday", "last Friday")** -- confirmed the
    server needed zero changes (`recurrence.ts`'s expansion is 100%
    delegated to ical.js's own iterator, and `mapper.ts` just round-trips
    whatever RRULE string the client sends); this was purely
    `EventEditDialog.vue`'s repeat picker gaining a monthly "day N" vs "the
    [ordinal] [weekday]" sub-choice. Verified live: `FREQ=MONTHLY;BYDAY=2TU`
    created via the real API expanded to the correct 2nd-Tuesday dates
    across 6 months (Aug 11, Sep 8, Oct 13, Nov 10...).
  - **RDATE** -- confirmed ical.js's iterator honors RDATE with zero extra
    wiring (spike-tested before touching any code). `EventFields.rdate`/
    `CalendarObject.rdate` added; `mapper.ts` writes via
    `addPropertyWithValue` with a real `ICAL.Time` (never a raw string,
    learned from the RRULE `Recur.fromString` trap) and reads back via
    `getAllProperties('rdate')`. Verified live: a `FREQ=MONTHLY;BYDAY=2TU`
    series with an `RDATE` of Dec 25 (a date the pattern wouldn't produce
    on its own) correctly included Dec 25 alongside the regular monthly
    occurrences.
  - **Override preservation** in `applyAll`/`applyThisAndFuture`
    (`editScope.ts`) -- previously *all* per-occurrence overrides were
    unconditionally dropped on either edit. Now: `applyAll` snapshots
    overrides before rebuilding the master, then shifts each override's
    `RECURRENCE-ID`/`DTSTART`/`DTEND` by however much the master's own
    `DTSTART` moved (via the new `shiftOverride()` helper,
    `ICAL.Time.subtractDate`/`.addDuration`), leaving every other field
    (summary/description/color/alarms/etc) completely untouched.
    `applyThisAndFuture` does the same for overrides at/after the split
    point, additionally re-keying them onto the new series's UID (ical.js
    associates an override to its master purely by shared UID). Both fall
    back to the old drop-everything behavior only when the edit also
    toggles all-day-ness (no sensible time delta exists across a
    DATE↔DATE-TIME boundary). **Verified live** with the exact scenario
    this file previously documented as broken: a weekly series with one
    occurrence manually moved +2h and given a custom title+color, then the
    whole series edited "all" to shift by +1h and rename -- the overridden
    occurrence correctly ended up at +3h from the original series time
    (preserving its own +2h offset on top of the series's +1h shift) with
    its custom title and color both intact, while every other occurrence
    picked up the new title and +1h time.
