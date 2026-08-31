# AGENTS.md

Monorepo: `shared` (types) / `server` (Fastify API) / `client` (Vue 3 SPA),
npm workspaces. Package/workspace names are `yourcal` / `@yourcal/*`. The
CalDAV server is the sole identity provider — no local user store.

Verification discipline throughout: features are driven against a real
CalDAV server with curl, not just typechecked. Automated tests
(`server/src/**/*.test.ts`, `npm test` / vitest, run in CI) cover the
mapper, recurrence, edit scopes, import/export, bounds, SSRF, privileges,
the SQLite store, and route handlers — but they don't exercise the CalDAV
server's own RRULE/ETag validation, which is still only checked by hand.

## Open items

- **Conflict-handling UX** — not built.
- **`GET /api/calendars/:id/sync`** — `DavCalendarStore.syncCalendar()` is
  implemented but no route exposes it and it's never been tested against a
  real server.
- **VTODO/task list UI** — deliberately out of scope. `Calendar.supportsTasks`
  is discovered and plumbed through the store layer but has no UI and should
  stay that way. Attendees/attachments are also out of scope.
- **Baikal coverage** — real Baikal 0.11.1 has only been exercised for
  sharing and plain event CRUD. RRULE/EXDATE/timezone edge cases are
  Radicale-only-verified. Baikal share **management** (list/update/revoke,
  as opposed to creating a share) is implemented but never spike-tested (no
  PHP on this host).
- **Frontend** has only been clicked through piecemeal in a real browser;
  no systematic pass over every dialog / drag / resize path.
- **Docker** image is unbuilt/unrun (no Docker on this host) — see below.

Done, each with a section below: search, ICS import, WebCal/ICS
subscriptions, recurring-event UI (interval / `BYDAY` picker / end
condition, ordinal `BYDAY`, `RDATE`, override preservation), timezone
support, VALARM reminders, per-event `COLOR`, calendar create / rename /
delete, read-only calendars, ICS export, calendar sharing (create / accept
/ unsubscribe / owner-side management), SQLite read-cache, calendar sort,
undo toast, agenda / year / mini-month navigator, duplicate event /
copy-paste.

## Toolchain pins

**`typescript` is pinned to `^7.0.2`** (dependabot PR #9). Two parts of the
toolchain don't support TS7 yet:

- **`@typescript-eslint`** peer-caps at `typescript <6.1.0`
  ([issue #10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940),
  "1-2 major releases" out). Workaround: CI runs `npm ci --legacy-peer-deps`.
  Treat lint output with suspicion on TS7-only syntax. There's also no
  `eslint.config.js` in the repo at all, so `npm run lint` currently fails
  regardless — separate pre-existing gap.
- **`vue-tsc`** hard-crashes on TS7 (`ERR_PACKAGE_PATH_NOT_EXPORTED` for
  `./lib/tsc`, removed in TS7 —
  [vuejs/language-tools#6124](https://github.com/vuejs/language-tools/issues/6124),
  [#5381](https://github.com/vuejs/language-tools/issues/5381)). Workaround:
  `client`'s `build` script is just `vite build`; type-checking moved to a
  separate `npm run typecheck -w client` that **nothing runs automatically**
  — client type errors are caught by neither `build` nor CI until this is
  revisited.

**Revisit both** when the upstreams ship TS7 support: drop
`--legacy-peer-deps` and put `vue-tsc -b` back in front of `vite build`.

**`@fullcalendar/*` pinned to `^6.1.21`** across all five packages.
Dependabot PR #9 bumped only `core`/`vue3` to `7.0.2`; `daygrid`/
`interaction`/`timegrid` have no stable v7 (only `-rc`), and FullCalendar
requires one matched major across the family — the mixed set broke module
resolution at build time. Reverting also required regenerating
`package-lock.json` from scratch (a plain reinstall kept a stale nested
`core@7.0.2`). Revisit when all five have a matching stable v7.

## Dev CalDAV servers (no Docker on this host)

Both `.dev-radicale/` and `.dev-baikal/` are git-untracked scratch state.

### Radicale (3.7.7)

```
python3 -m venv .dev-radicale/venv
.dev-radicale/venv/bin/pip install radicale bcrypt
.dev-radicale/venv/bin/python -m radicale --config .dev-radicale/config/config
```

Binds `127.0.0.1:5232`, serves DAV at the root. htpasswd auth
(`.dev-radicale/config/users`), filesystem storage under
`.dev-radicale/data/`. A calendar must be created per user with a raw
`MKCALENDAR` (Radicale doesn't auto-create one).

Config additions for sharing (all git-untracked): a `[rights]` section
(custom `from_file` rights reimplementing `owner_only` for every user plus
one legacy spike rule) and a `[sharing]` section (`type = files`,
`collection_by_map = true`, `permit_create_map = true`, db under
`.dev-radicale/data/collection-db/`). Users: `testuser`/`testuser`,
`shareduser`/`shareduser`.

Reusable fixtures — two fully-accepted map shares from `testuser` to
`shareduser`: Personal at `/shareduser/testuser-personal/`, Work at
`/shareduser/testuser-work-pending/` (the `-pending` in the path is a
stale label; it's accepted). Both `Permissions: "rw"`. If
sharing/rights behavior looks wrong, check `.dev-radicale/config/rights`
and `[sharing]` first.

### Baikal (0.11.1)

Needs PHP with `mbstring`, `xml`/`dom`/`simplexml`, `pdo_sqlite` — not on
this host, no `sudo`, so a **human** must set this up.

```
curl -sL -o .dev-baikal/baikal.zip \
  https://github.com/sabre-io/Baikal/releases/download/0.11.1/baikal-0.11.1.zip
unzip -q .dev-baikal/baikal.zip -d .dev-baikal && rm .dev-baikal/baikal.zip
php -S 127.0.0.1:8080 -t .dev-baikal/baikal/html
```

`vendor/` ships prebuilt (no `composer install`). First run needs the
install wizard at `/admin/install/` — a multi-step form, scriptable via
curl (grab `PHPSESSID` + `CSRF_TOKEN` from each GET, POST each step).
**Gotcha**: the wizard's hidden `refreshed` field must stay `0` on a real
submit; `refreshed=1` silently re-renders the empty form instead of
persisting. Config lands in `.dev-baikal/baikal/config/baikal.yaml`, db in
`.dev-baikal/baikal/Specific/db/db.sqlite`.

Users are created via `/admin/?/users/new/1/` (same CSRF pattern). Baikal
auto-creates one calendar per user. `testuser`/`testuser` and
`shareduser`/`shareduser` (email `shareduser@example.com`) already exist;
admin is `admin`/`bAikalAdmin1!`.

CalDAV base URL for the login form: `http://127.0.0.1:8080/dav.php` (Baikal
serves DAV under `/dav.php`, not the root).

## API notes: tsdav / ical.js (non-obvious, from `dist/*.d.ts`)

- **`createDAVClient(...)`** (the standalone fn) returns an anonymous
  object type, not the `DAVClient` class. We use `new DAVClient({...});
  await client.login()` (`server/src/dav/client.ts`) because the class
  exposes `.account` after login, which proves the credentials are valid.
- **`client.smartCollectionSync({ detailedResult: true })`** nests the
  arrays under `.objects` (`{ ...collection, objects: { created, updated,
  deleted } }`), not top-level.
- **`smartCollectionSync({ method: 'webdav' })`** throws unless you pass
  `collection.objectMultiGet` — sync-collection REPORT only returns changed
  hrefs+etags, not bodies. Use `objectMultiGet: client.calendarMultiGet.bind(client)`.
- **`ICAL.Event.getOccurrenceDetails(time)`** → `{ item, startDate,
  endDate, recurrenceId }`. Always use the returned `startDate`/`endDate`,
  never `item.startDate` — `item` is the master for non-exception
  occurrences, so `item.startDate` is the *series* start. Easiest mistake
  to reintroduce in `recurrence.ts`.
- Override wiring for expansion: `event.relateException(overrideVevent)`
  per non-master VEVENT sharing a UID, before `.iterator()` /
  `.getOccurrenceDetails()`.
- **`ICAL.Recur.until`** is a plain writable property (`Time | null`), and
  setting it requires also clearing `.count` (no COUNT+UNTIL together). See
  `editScope.ts`'s `truncateRrule()`.
- **ical.js accessors return live references, not snapshots.**
  `getFirstPropertyValue('rrule')` hands back the master's actual `Recur`
  instance — `.clone()` it before mutating anything you also read
  elsewhere in the same function.
- **`updatePropertyWithValue('rrule', string)` silently corrupts the
  value** — ical.js iterates the string char-by-char
  (`RRULE:0=F;1=R;...`). Always `ICAL.Recur.fromString(...)` first. RDATE
  is the same trap: pass a real `ICAL.Time`, never a string. VALARM
  `TRIGGER` is the *exception* — a raw `-PT15M` string round-trips fine as
  an `ICAL.Duration`.
- **`ICAL.Time` zone reassignment**: setting `.zone` relabels without
  converting (14:00 UTC "becomes" 14:00 local). Use `.convertToZone(zone)`.
  For all-day values, build with `ICAL.Time.fromDateString(...)` — no
  JS-Date/timezone round trip.

## Architecture reminders

- **`CalendarStore`** (`server/src/store/CalendarStore.ts`) is the seam a
  cache/mirror slots into. It includes `getRawObject()` because recurring
  writes need the current ICS before an edit-scope transform runs — a
  mirror must serve this from its local copy or the mirror is pointless.
- **`CalendarObject.href`** is an opaque locator the frontend echoes back
  verbatim on every write (never parse/construct it). It's what lets
  `updateObject`/`deleteObject` work with no server-side state beyond the
  session cookie.
- The frontend does **not** patch its event cache after a write —
  `useEventsStore`'s create/update/delete await the API then refetch the
  visible range. Exception: drag/resize gets optimistic UX from
  FullCalendar's `revert()`. Fine-grained cache patching is a valid later
  optimization, not a correctness issue.
- `getRawObject()` passes the object's own href as `calendar.url` to
  `fetchCalendarObjects({ calendar: { url: href }, objectUrls: [href] })`
  — exercised heavily against Radicale, works; not tested against Baikal.
- Transient quirk: a `calendar-query` REPORT against a freshly-written
  object occasionally 404s once, then succeeds on retry. The app's polling
  is retry-tolerant by nature; not investigated further.

## Sessions

`POST/GET/DELETE /api/session`. Lifetime configurable via
`SESSION_TTL_DAYS` (default 1; `server/src/config.ts`, days for
readability, converted to seconds), applied to both
`@fastify/secure-session`'s `expiry` (baked into the encrypted payload,
checked every request) and the cookie `maxAge` (`server/src/session.ts`).
Bug fixed here: previously the cookie had no `maxAge` at all, making it a
browser-session cookie regardless of the payload TTL.

Client handles mid-tab expiry: `api.ts`'s `request()` dispatches a
`SESSION_EXPIRED_EVENT` on any non-`/session` 401; `App.vue` clears the
store and routes to `/login?expired=1`, where `LoginView.vue` shows a
"session expired" message.

## Bugs worth remembering (all fixed)

Found by real server round-trips:

- **All-day events written as timed** — `fromJSDate(date, !allDay)` +
  retroactive `.isDate = true` produced a floating `DTSTART` and read back
  `allDay: false` (phantom "12a"). Fixed with `ICAL.Time.fromDateString()`.
- **RRULE / RDATE string corruption**, **live `Recur` reference truncated
  in `applyThisAndFuture`** — see the ical.js API notes above.
- **`syncCalendar()` missing `objectMultiGet`** — see the API notes;
  surfaced only once the SQLite cache became its first caller.

Found by code review (these don't fail loudly — curl alone wouldn't catch
them):

- **SSRF / credential leak via `calendarId`.** `assertHrefSameHost()`
  guarded `href` but not `calendarId`, which `decodeId()`s to an equally
  client-controlled URL — a forged `:id` could make `getEvents` /
  `createObject` / `syncCalendar` send Basic-auth credentials off-host.
  Fixed by asserting right after `decodeId()` in all three
  (`DavCalendarStore.ts`), plus a global `setErrorHandler` mapping
  `DisallowedHostError` → 403.
- **Missing `summary` validation** — `eventFieldsError` checked only
  `start`/`end`; added the required-field check.
- **`RECURRENCE-ID` value-type mismatch** — `applyThisOccurrence` /
  `applyThisAndFuture` built the RECURRENCE-ID from `fields.allDay` (the
  edit's *new* value) rather than the master's own DTSTART type. Extracted
  `masterIsAllDay()` and used it in all four edit/delete functions.

Found in a real browser:

- **`crypto.randomUUID()` is `undefined` over plain HTTP + a non-`localhost`
  host** — subscriptions' "Add" threw before pushing to the store. Added a
  `generateId()` fallback (`Date.now().toString(36)` + suffix; fine, it's
  only a localStorage key). No other client-side `crypto.*` call exists.
- **`parseIcalUntil()` used `.toLocal()`** instead of the event's own
  zone, so a recurring `UNTIL` end date could show (and re-save) off by a
  day. Threaded `initialZone` through like the other date fields.
- **Mid-session calendar/subscription not picked up** —
  `loadVisibleRange()` only fired on FullCalendar date-nav, and
  `reloadLastRange()` replayed a stale `lastLoadedIds`. Added `watch()`es
  on `enabledCalendarIds` and `enabledSubscriptionIds`.
- **`reloadLastRange()` force-refetched every enabled calendar** after any
  single-event write, bypassing the 30s freshness cache. Gave `loadRange`'s
  `force` an array form; `reloadLastRange(calendarIds?)` now passes only the
  touched calendar(s) (source + destination on a cross-calendar move).
  Error-recovery paths still do a full refresh.

**General lesson (from the CRITICAL sharing bug below):** "operation A
failed, therefore condition X is false" is not a safe basis for a
destructive fallback B. Confirm X independently first — especially when B
is irreversible and A can fail for many reasons.

## Timezone handling

ical.js registers only `UTC`/`GMT`/`Z` by default — no IANA data — so
before this was fixed every non-UTC event was silently written as UTC.

- `server/src/ical/timezones.ts`: `ensureTimezoneRegistered(tzid)` pulls
  real VTIMEZONE data from `@touch4it/ical-timezones` and registers it on
  first use. `registerEmbeddedTimezones(comp)` handles the read side — a
  raw `new ICAL.Component(ICAL.parse(ics))` does **not** auto-register an
  embedded VTIMEZONE, so this is called at every ICS-parse entry point
  (`icsToCalendarObject`, `expandCalendarObject`, `editScope.ts`'s
  `parseCalendar()`), making reads correct for any server's VTIMEZONE.
- Every VCALENDAR the app writes calls `ICAL.helpers.updateTimezones(comp)`
  before `.toString()`, so a matching VTIMEZONE always travels with the
  event.
- `EventEditDialog.vue` has a real timezone picker
  (`Intl.supportedValuesOf('timeZone')`); `EventDetailPopover.vue` shows
  the event's zone when it differs from the viewer's.

Verified: a weekly `America/New_York` series holds 9am wall-clock across
the March DST transition (`14:00Z` → `13:00Z`), with a correct
`VTIMEZONE` block in the stored ICS. Not tested: non-DST-observing zones,
or a VTIMEZONE authored by a different server.

## Recurrence: known simplifications

- **Editing "all" / "this and future" drops overrides only when the edit
  also toggles all-day-ness** — otherwise overrides are shifted and
  carried (see "Advanced recurrence"). No sensible time delta exists
  across a DATE↔DATE-TIME boundary.
- No separate expansion "horizon" cap — the iterator stops at `range.end`,
  so the requested range is the bound. Fine as-is.

## Search, ICS import, subscriptions

- **Search** — `GET /api/search?q=` (`server/src/routes/search.ts`),
  substring over summary/description/location, case-insensitive, capped at
  100, sorted by start. Two backends:
  - **Cache off (`DavCalendarStore`)** — the route's own `windowSweep`:
    loops `discoverCalendars` + `getEvents` over a default ±1yr/±2yr window
    (overridable via `start`/`end`). Bounded by that window by
    construction; scales with calendar count × window.
  - **Cache on (`SqliteCalendarStore`, i.e. `CACHE_ENABLED`)** — the store
    exposes an optional `searchEvents(ctx, q)`; the route uses it instead.
    It freshens every calendar (`ensureFresh`), then substring-scans a
    per-object lowercased `search_text` blob (SUMMARY/DESCRIPTION/LOCATION
    of every VEVENT, built by `ical/searchText.ts`, stored on the `objects`
    row alongside `start_ts`/`end_ts`). **Full history, no window.**
    Returns one hit per stored object — the *series master* for a
    recurring event, not every occurrence (unlike the sweep, which
    expands). Substring, not FTS5: FTS5 would silently change matching from
    substring to token-prefix, and an `instr()` column scan of a personal
    calendar is sub-millisecond. `search_text` is NULL for rows synced
    before this shipped until their next sync — those just don't match.
  - Frontend: `SearchBox.vue`, 300ms debounce, min 2 chars; sends only `q`.
- **ICS import** — `POST /api/calendars/:id/import`, body `{ ics }`.
  `server/src/ical/importIcs.ts` splits a multi-VEVENT file into one
  VCALENDAR per source UID (master + its RECURRENCE-ID overrides), assigns
  each a **fresh** UID (avoids collisions), creates via the normal
  `store.createObject`. Partial failure doesn't abort
  (`imported`/`total`). Frontend: `ImportDialog.vue`, reads via
  `File.text()`, POSTs as a JSON string.
- **Subscriptions** — `GET /api/subscriptions/events?url=&start=&end=`
  (`server/src/ical/subscription.ts`). Fetches an external
  http(s)/webcal URL server-side, parses like import, returns
  `CalendarObject[]` with a synthetic `sub:<sha256(url)[:16]>` id and a
  constant `'subscription'` etag (read-only by construction). **SSRF
  surface, accepted**: gated by `requireSession` only, same trust level as
  the CalDAV login — would need an allowlist before wider exposure.
  Subscriptions are **entirely client-side state**
  (`stores/subscriptions.ts`, localStorage); the server just proxies each
  URL per request. `SubscriptionList.vue` in the sidebar; events merge
  into `CalendarView.vue` with `editable: false`.

## Calendar sharing

Shares a calendar between two users on the same CalDAV server. CalDAV
itself (RFC 4791) has no sharing; each backend has its own mechanism, and
**the code must positively confirm which mechanism a share uses before
acting — never infer it from a failed call** (see the CRITICAL bug below).

### Radicale — `/.sharing/v1/map` API

Enabled via the `[sharing]` config section above. A share needs both
sides to `map/enable` + `map/unhide` (owner, then recipient) before it's
live; until then it's inert. Once live the collection is genuinely mounted
under the recipient's principal and shows up through the unmodified
`discoverCalendars()` path.

Essentials learned the hard way:

- All sharing-API paths need a **leading slash** (bare `"testuser/personal/"`
  500s deep in `pathutils.strip_path`).
- `PathOrToken` = the path under the **recipient's** principal
  (`/shareduser/testuser-personal/`); `PathMapped` = the owner's real
  collection. The `Access` check is against the recipient's rights on
  `PathOrToken`, so a path under the owner's principal 403s.
- `Permissions: "rw"` works for write access despite `w` not appearing in
  SHARING.md's vocabulary examples; `"r"` correctly 403s on `PUT`.
- A map-shared calendar's `resourcetype` is **identical** to an owned one
  — no marker. "Shared with me" detection cross-references
  `/.sharing/v1/map/list` (`listRadicaleSharedPaths()`, once per
  `discoverCalendars()`, fails open). Match on `PathOrToken` (the mounted
  path), not `PathMapped` (the owner's path — matches nothing).
- Radicale has no "declined" state — a hidden share is byte-identical to
  one never accepted, so an unsubscribed share reappears as "pending" on
  the next load. Handled client-side (see below).
- `TimestampUpdated` is computed from the server's **naive local time**
  minus a naive epoch — it's ~UTC-offset hours off a real Unix timestamp.
  Any comparison against it must use a value sourced from the same clock,
  never `Date.now()`.

### Baikal — CalDAV `cs:share` POST (calendarserver-sharing draft)

Both sharing plugins are unconditionally registered in Baikal 0.11.1
(older GitHub issues saying otherwise are stale). Flow:

- Owner POSTs a `cs:share` body to the calendar collection URL, with
  `<cs:set><d:href>` = **`mailto:` + the recipient's registered email**
  (username alone silently creates an invalid invite), plus
  `<cs:read-write/>` or `<cs:read/>`.
- **No accept step** — the invite auto-accepts and mounts immediately at
  `/dav.php/calendars/<recipient>/<uuid>/` with `resourcetype` including
  `cs:shared` (vs `cs:shared-owner` for owned), which tsdav surfaces as
  `cal.resourcetype` containing `shared` — a free "Shared with me" signal.
- Baikal returns `200 OK` even when the recipient can't be resolved, so
  `tryBaikalShare()` **re-fetches `cs:invite` and checks the entry's
  status** before reporting success.
- XML parser gotcha: `xml-js` (`compact: true`) keys by the literal wire
  tag, and Baikal declares `xmlns:d="DAV:"` *prefixed*, so the href is
  under `'d:href'`, not `'href'`.

### App surface

- `POST /api/calendars/:id/share` (`shareCalendar()` in
  `server/src/dav/sharing.ts`) tries Radicale then Baikal, throws a
  combined `ShareFailedError` → 422 if neither works (never a false
  success). Radicale re-share after an unsubscribe hits a 409 on the
  deterministic `PathOrToken`; handled by looking up and re-enabling the
  existing (hidden) entry.
- `POST /api/calendars/:id/unsubscribe` (recipient) — **CRITICAL bug,
  fixed:** the original "try Radicale `hide`; on any non-success fall back
  to a plain DAV `DELETE`" logic is unsafe. Radicale's map resolver
  forwards `DELETE` to the owner's real collection with no extra
  permission check — a recipient's `DELETE` against their mounted path
  **irreversibly deleted the owner's calendar** (confirmed in testing;
  destroyed the "Personal" fixture's original events). Now: positively
  confirm the calendar is a Radicale map share the current user receives
  (`fetchRadicaleMapList` matching `User` + `PathOrToken`) **first** — if
  so, only `hide` is ever attempted and any failure throws; `DELETE` is
  reached only when the lookup confirms it's *not* a Radicale share.
- `DELETE /api/calendars/:id` (owner) — plain DAV `DELETE`. On Radicale
  this doesn't touch the sharing db, so `deleteRadicaleSharesForPath()`
  runs afterward (best-effort) to `map/delete` any shares pointing at the
  deleted collection, else recipients see a phantom pending invite. Baikal's
  PDO backend already wipes all `calendarinstances` rows on an owner delete.
- `GET /api/sharing/pending` + `POST /api/sharing/pending/accept`
  (`listPendingRadicaleShares()`) — in-app accept flow for the Radicale
  recipient-side enable+unhide step. `fetchShareDisplayName()` PROPFINDs
  the share for a real `displayname` (falls back to the path segment,
  which for app-created calendars is a raw UUID). Baikal returns `[]`
  (auto-accept, no pending concept).
- `GET/PATCH/DELETE /api/sharing/calendars/:id/shares[/:token]`
  (`server/src/routes/sharing.ts`, owner-only) — list / change-permission
  / revoke shares the owner created. Radicale verified end-to-end; Baikal
  branches written to spec but never spike-tested. `OwnedShare.token` is
  base64url-encoded `PathOrToken` / `mailto:` href via `idCodec.ts`.
- Client: `ShareCalendarDialog.vue` (invite form + "Currently shared with"
  panel), `PendingSharesList.vue` (accept/dismiss pending),
  `CalendarList.vue` splits own vs "Shared with me" on `Calendar.isShared`,
  `CalendarListItem.vue` has 🗑 delete (owned) / ✕ unsubscribe (shared)
  behind `confirm()`, and hides the ↗ share button on already-shared
  calendars. Dismissed-pending state is a `pathOrToken → dismissedAt` map
  in localStorage (`calendar.dismissedPendingShares.v2` — the `.v2`
  rename discards entries corrupted by the pre-fix `Date.now()` clock
  bug). SQLite schema has an unused `is_shared` column (no migration
  system yet; safe because `CACHE_ENABLED` has never been on).

**Trust boundary:** unsubscribe is only safe because it's meant to be
called from the "Shared with me" list. There's no server-side check
distinguishing "shared to me" from "my own" beyond what Radicale's `hide`
permission enforces (Baikal has none — an owner's plain `DELETE` on their
own calendar *is* the intended full delete, which is why the two routes
share a code path there).

## Calendar create / rename / delete

`POST /api/calendars` (`MKCALENDAR` via `client.makeCalendar()`, collection
URL is `<calendar-home-set>/<uuid>/`), `PATCH /api/calendars/:id` (raw
PROPPATCH of `d:displayname` / `ca:calendar-color`, tsdav has no wrapper),
`DELETE /api/calendars/:id`. Rename/delete are owner-only (403 if
`isShared`). `SqliteCalendarStore` write-throughs and patches the cached
row for all three. Frontend: inline "+ New calendar" form in
`CalendarList.vue`; rename via `RenameCalendarDialog.vue`.

## Feature batch: rename, read-only, color, reminders, export, recurrence

All verified against real Radicale.

- **Read-only calendars.** `server/src/dav/privileges.ts`
  `isCalendarReadOnly()` — raw `current-user-privilege-set` PROPFIND per
  calendar (tsdav doesn't request it). A `rw` share recipient gets `read`
  + `write-content` but never a bare `write`, so `readOnly` checks for the
  absence of **both** `write` and `write-content`. Enforced server-side by
  `requireWritableCalendar()` (gates all four event-write routes, 403s
  before any DAV call), not just discovered. Client: `Calendar.readOnly`
  drives `EventDetailPopover`'s readOnly UI and FullCalendar `editable`;
  the New/Edit-event and Import dialogs filter their calendar dropdowns to
  writable calendars (keeping the event's current one selectable so it can
  be moved).
- **Per-event color.** RFC 7986 `COLOR`, a plain string property (no
  wrapping trap). `EventFields.color` / `CalendarObject.color`, read/write
  in `mapper.ts`, swatch in `EventEditDialog.vue` (defaults to the
  calendar color). Flows through `editScope.ts` for free.
- **Reminders (VALARM).** `EventFields.alarms` = `{ minutesBefore }[]`.
  v1 scope: `DISPLAY` action, relative before-start `TRIGGER` only
  (absolute or after-start triggers aren't read back). `mapper.ts`
  `buildVeventComponent` / `parseAlarms`; `editScope.ts` needs no changes.
  Stored ICS is standard `BEGIN:VALARM` — portable, not app-only.
  Delivery is **in-tab only** (explicit choice, no service worker/push):
  `stores/notifications.ts` requests `Notification` permission on an
  explicit button click, schedules `setTimeout`s for alarms within 24h,
  re-arming on every load.
- **ICS export.** `GET /api/calendars/:id/export` (whole calendar over a
  wide default range) and `GET /api/calendars/:id/events/:uid/export`
  (single event). `mergeIcsObjects` in `server/src/ical/exportIcs.ts`.
- **Advanced recurrence.**
  - *Ordinal `BYDAY`* ("2nd Tuesday", "last Friday") — server needed zero
    changes (expansion is fully delegated to ical.js; `mapper.ts`
    round-trips the RRULE string). Purely a repeat-picker addition.
  - *RDATE* — ical.js's iterator honors it with no extra wiring.
    `EventFields.rdate` / `CalendarObject.rdate`; `mapper.ts` writes via
    `addPropertyWithValue` with a real `ICAL.Time`.
  - *Override preservation* in `applyAll` / `applyThisAndFuture` — was
    dropping all overrides unconditionally. Now snapshots them, shifts
    each override's `RECURRENCE-ID`/`DTSTART`/`DTEND` by the master's own
    `DTSTART` delta (`shiftOverride()`), leaves all other fields
    untouched; `applyThisAndFuture` also re-keys them onto the new
    series's UID. Falls back to drop-everything only on an all-day toggle.

## Undo toast

Client-only. `client/src/stores/undo.ts` holds a single pending
`{ message, run }` offer with an 8s self-clearing timer (a new offer
replaces any still-pending one); `UndoToast.vue` is mounted once in
`CalendarView.vue` and shows message + Undo + dismiss. The pre-existing
delete `ConfirmDialog` is unchanged — the toast is an *additional* safety
net, not a replacement (deliberate, per the feature plan).

Undo is offered only for **non-recurring** events, on: delete
(`doDelete`), calendar-move / field-edit via the edit dialog (`doUpdate`,
`offerEditUndo`), and drag / resize (`onEventDrop` / `onEventResize`).

- **Delete undo re-creates the event** via `eventsStore.createEvent` from
  the `CalendarObject` still in memory → it comes back with a **fresh
  UID/href** (new CalDAV object). Acceptable for a personal calendar;
  would not restore a recurring series' overrides, hence non-recurring
  only.
- **Edit/move undo** re-applies the pre-edit `CalendarObject`'s original
  fields (`toFields(before, before.start, before.end)`) against the
  server's *current* etag, looked up via `eventsStore.findEvent` after
  `reloadLastRange` has refreshed the cache. `scope: 'all'` always (safe:
  non-recurring).
- Recurring events: no toast — reverting them needs an edit-scope choice.
  Cross-calendar / all-day recurring moves likewise not covered.
- Not yet exercised in a real browser.

## SQLite read-cache (`SqliteCalendarStore`)

Built despite being flagged as premature (no observed perf problem).
Enable with `CACHE_ENABLED=true`
(default off — `DavCalendarStore` used directly otherwise); `SQLITE_PATH`
(default `./data/cache.db`) and `CACHE_SYNC_TTL_MS` (default 30000) also
configurable.

Decorator over any `CalendarStore` — reads are cache-first with TTL-gated
sync, writes are write-through then reflected into the cache. Supporting
code in `server/src/store/sqlite/{db,schema,userKey}.ts`. Cache key is
`sha256(baseUrl + username)` — the password is never persisted. Tables use
`STRICT` (better-sqlite3 pinned `^13.x` per user request for "major
improvements" — the concrete thing used is just `STRICT`; ask what else
they meant if this is revisited).

Verified: cold-cache correctness, warm hit ~74× faster than a cold sync
(9ms vs 669ms against **localhost** Radicale — not the remote case this
actually matters for), write-then-read consistency, TTL-bounded staleness
on out-of-band writes, and the 412 + recurring edit-scope tests re-passing
through the cached path (including the `getRawObject` cache-hit). **Out of
scope for v1**: cross-device invalidation beyond the TTL, background sync
workers, pre-expanded occurrence caching, cache eviction.

## Calendar sort + settings dialog

Client-only sort setting `calendarSortOrder` (`'server' | 'name-asc' |
'name-desc'`) in `client/src/stores/settings.ts`, persisted to
localStorage, applied in `CalendarList.vue` via a local `sorted()` helper
that doesn't touch `store.calendars`' underlying order. CalDAV has no
ordering property, so there's nothing server-side to preserve.
Drag-to-reorder was deferred (needs a new client dep).

This setting plus "Week starts on" and "Default calendar" live in
`SettingsDialog.vue` (⚙️ next to sign-out), moved out of the sidebar to
stop it accumulating loose `<select>`s.

## Agenda / year views + mini-month navigator

Client-only, all in `CalendarView.vue` plus one new component.

- **Agenda** (`listMonth`, button "Agenda") and **Year** (`multiMonthYear`,
  button "Year") are just added FullCalendar plugins —
  `@fullcalendar/list` + `@fullcalendar/multimonth`, both pinned at
  `6.1.21` to match the rest of the `@fullcalendar/*` family (see the pin
  note above). Added to `plugins`, the `headerToolbar` right group, and
  `buttonText`. `noEventsText` set for the empty agenda case. The events
  array already suited both; no data changes.
- **Mini-month** — `client/src/components/MiniMonth.vue`, standalone,
  luxon-only (no second FullCalendar instance). Props: `firstDay`
  (0=Sun..6=Sat, from settings) and `focusDate` (ISO). It follows the main
  calendar via `focusDate` — `onDatesSet` records `arg.view.currentStart`
  (not `arg.start`, which includes a month grid's leading days) into a
  `calendarDate` ref — but the user can page it independently. Clicking a
  day emits `navigate` → `fullCalendarRef.getApi().gotoDate(date)`.
- Not yet exercised in a real browser.

## Duplicate event / copy-paste

Client-only. No new API — a duplicate is just a pre-filled create.

- **`EventEditDialog.vue`** gained an optional `template?: CalendarObject`
  prop. When creating (`event === null`) it seeds the *content* fields
  (title → "Copy of …", notes, location, color, reminders, recurrence,
  rdates, timezone/all-day) from `template`; `initialStart/End/AllDay`
  still supply the times. A new `source = props.event ?? props.template`
  const drives all the content initializers — `props.event` alone still
  drives `isEditing` (so a duplicate shows Save, no Delete). Also emits
  `duplicate` (button shown only while editing).
- **`EventDetailPopover.vue`** has a "Duplicate" button (emits
  `duplicate`), hidden when read-only.
- **`CalendarView.vue`** — `requestDuplicate()` opens the pre-filled
  create dialog directly for non-recurring events; for recurring ones it
  first shows **`DuplicateScopeDialog.vue`** (this occurrence as a one-off
  vs. the whole series). `duplicateTemplateObject` strips
  `rrule/rdate/isRecurring/recurrenceId` for the 'single' choice.
- **Copy-paste** — `stores/clipboard.ts` holds one `CalendarObject`
  in memory (no OS clipboard, no ICS). A window `keydown` handler in
  `CalendarView` does Ctrl/⌘-C (when the detail popover is open, outside
  inputs) and Ctrl/⌘-V (opens the pre-filled create dialog). Paste always
  lands as a one-off even from a recurring source.
- Not yet exercised in a real browser.

## External access

Start the client dev server with `vite --host 0.0.0.0` (not the bare
`vite` in the `dev` script) to reach it from another LAN device
(`http://192.168.10.50:5173`). The API server already binds `0.0.0.0`.
This is plain HTTP, no auth/firewall in front — trusted-LAN only. Plain
HTTP on a non-`localhost` host also disables secure-context browser APIs
(`crypto.randomUUID()` — see the bugs section); check for that before
adding any other such API client-side.

## Docker packaging (unbuilt — no Docker on this host)

Single image (`Dockerfile` at repo root) — `server/src/index.ts` already
serves `client/dist` via `@fastify/static`, so there's no second server to
split out.

- Multi-stage: `build` stage has `python3`/`make`/`g++` (for
  `better-sqlite3`'s native addon), runs `npm run build` (shared → server
  → client) then `npm prune --omit=dev`; `runtime` stage copies only
  `node_modules`, each workspace's `package.json` + `dist`, and
  `client/dist`.
- Depends on the npm-workspaces symlink layout:
  `node_modules/@yourcal/{shared,server,client}` are relative symlinks, so
  copying `node_modules` verbatim + recreating each `package.json`+`dist`
  at the same relative path makes them resolve without carrying `src/`.
  `client/package.json` is deliberately not copied (nothing `require()`s
  `@yourcal/client` — it's served as static files).
- `docker-compose.yml` wires `SESSION_SECRET` (required, no default —
  `openssl rand -hex 32`, decoded as raw 32-byte key material),
  `ALLOWED_CALDAV_HOSTS`, `CACHE_ENABLED`/`CACHE_SYNC_TTL_MS`, and a named
  volume at `/app/data`. `.env.example` mirrors these.
- **Gotcha, not fixed:** the Dockerfile sets `NODE_ENV=production`, which
  makes `session.ts` mark the cookie `Secure` — a browser won't send it
  over plain HTTP, conflicting with the LAN-IP access pattern above. Any
  deployment past `localhost` needs TLS termination in front, or a
  conscious `NODE_ENV` override. Left explicit rather than silently
  downgraded.
- Whoever has Docker should `docker compose up --build` and run at least a
  login + one calendar read/write through it.
