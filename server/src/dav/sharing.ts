import type { PendingShare, ShareCalendarInput, ShareCalendarResult, UnsubscribeResult } from '@yourcal/shared'
import { xml2js } from 'xml-js'
import type { DavContext } from './context.js'

export class ShareFailedError extends Error {}

export function basicAuthHeader(ctx: DavContext): Record<string, string> {
  return { Authorization: 'Basic ' + Buffer.from(`${ctx.username}:${ctx.password}`).toString('base64') }
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
}

/**
 * Tries Radicale's proprietary `/.sharing/v1/map` API (Radicale 3.7+).
 * Confirmed by spike-testing (see AGENTS.md "Calendar sharing"): creating
 * a map share and enabling+unhiding the owner's side is enough for the
 * calendar to become writable and auto-discoverable for the recipient --
 * but only once the recipient *also* enables+unhides their own side,
 * which this app has no UI for yet (`pending: true`).
 */
async function tryRadicaleShare(
  ctx: DavContext,
  calendarUrl: string,
  input: ShareCalendarInput,
): Promise<ShareCalendarResult> {
  const calPath = new URL(calendarUrl).pathname
  const slug = calPath.split('/').filter(Boolean).pop() ?? 'calendar'
  const pathOrToken = `/${input.recipient}/${ctx.username}-${slug}/`
  const permissions = input.permission === 'readwrite' ? 'rw' : 'r'
  const headers = {
    ...basicAuthHeader(ctx),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  const create = await fetch(`${ctx.baseUrl}/.sharing/v1/map/create`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      PathOrToken: pathOrToken,
      PathMapped: calPath,
      User: input.recipient,
      Permissions: permissions,
    }),
  })

  // 409 means a map share already exists for this owner/recipient/collection
  // combo -- e.g. the recipient previously unsubscribed (which only hides
  // their own side, see unsubscribeFromCalendar's doc comment) and the
  // owner is now re-sharing to the same person. Radicale has no
  // create-or-reuse semantics here, so re-share by finding that existing
  // entry and resetting it (permissions + owner's own enable/unhide) rather
  // than failing outright. Confirmed by testing: re-sharing a calendar to
  // a recipient who'd previously unsubscribed 409'd before this existed.
  let existingPathOrToken: string | null = null
  if (create.status === 409) {
    const entries = await fetchRadicaleMapList(ctx)
    const existing = entries.find(
      (e) => e.Owner === ctx.username && e.PathMapped === calPath && e.User === input.recipient,
    )
    if (!existing?.PathOrToken) {
      throw new ShareFailedError('Radicale map/create failed: 409 (conflicting share, but could not find it to reuse)')
    }
    existingPathOrToken = existing.PathOrToken
  } else if (!create.ok) {
    throw new ShareFailedError(`Radicale map/create failed: ${create.status}`)
  } else {
    const createBody = (await create.json().catch(() => null)) as { Status?: string } | null
    if (!createBody || createBody.Status !== 'success') {
      throw new ShareFailedError('Radicale map/create did not report success')
    }
  }

  const targetPathOrToken = existingPathOrToken ?? pathOrToken

  if (existingPathOrToken) {
    const update = await fetch(`${ctx.baseUrl}/.sharing/v1/map/update`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ PathOrToken: existingPathOrToken, Permissions: permissions }),
    })
    if (!update.ok) {
      throw new ShareFailedError(`Radicale map/update failed: ${update.status}`)
    }
  }

  for (const action of ['enable', 'unhide']) {
    const res = await fetch(`${ctx.baseUrl}/.sharing/v1/map/${action}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ PathOrToken: targetPathOrToken }),
    })
    if (!res.ok) {
      throw new ShareFailedError(`Radicale map/${action} failed: ${res.status}`)
    }
  }

  return { mechanism: 'radicale-map', pending: true }
}

interface CsUserEntry {
  // xml-js's compact mode keys elements by their literal tag name as sent
  // on the wire -- Baikal declares DAV: under the `d:` prefix (not as a
  // default namespace), so this is genuinely `d:href`, not `href`.
  'd:href'?: { _text?: string }
  'cs:invite-accepted'?: unknown
  'cs:invite-invalid'?: unknown
}

/**
 * Tries the Apple calendarserver-sharing draft (`cs:share` POST), which
 * Baikal 0.11.1 has wired in unconditionally (see AGENTS.md "Calendar
 * sharing" for how this differs from older Baikal releases). Unlike
 * Radicale, a share here auto-accepts immediately with no separate
 * recipient action (`pending: false`) -- but Baikal returns `200 OK` even
 * when the recipient can't be resolved at all (confirmed by spike-testing:
 * an unmatched `mailto:` address silently produces an
 * `INVITE_INVALID`-status entry with no error response), so this always
 * re-fetches `cs:invite` afterward and checks the entry's actual status
 * rather than trusting the POST's status code.
 */
async function tryBaikalShare(
  ctx: DavContext,
  calendarUrl: string,
  input: ShareCalendarInput,
): Promise<ShareCalendarResult> {
  const href = input.recipient.startsWith('mailto:') ? input.recipient : `mailto:${input.recipient}`
  const accessTag = input.permission === 'readwrite' ? '<cs:read-write/>' : '<cs:read/>'
  const auth = basicAuthHeader(ctx)

  const shareRes = await fetch(calendarUrl, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/xml' },
    body: `<?xml version="1.0" encoding="utf-8"?>
<cs:share xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">
  <cs:set>
    <d:href>${escapeXml(href)}</d:href>
    <cs:common-name>${escapeXml(input.recipient)}</cs:common-name>
    ${accessTag}
  </cs:set>
</cs:share>`,
  })
  if (!shareRes.ok) {
    throw new ShareFailedError(`Baikal cs:share POST failed: ${shareRes.status}`)
  }

  const verifyRes = await fetch(calendarUrl, {
    method: 'PROPFIND',
    headers: { ...auth, 'Content-Type': 'application/xml', Depth: '0' },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/"><d:prop><cs:invite/></d:prop></d:propfind>',
  })
  if (!verifyRes.ok) {
    throw new ShareFailedError(`Could not verify share: PROPFIND failed with ${verifyRes.status}`)
  }
  const xml = await verifyRes.text()
  const parsed = xml2js(xml, { compact: true, ignoreDeclaration: true }) as Record<string, unknown>

  const invite = findCsInvite(parsed)
  const users: CsUserEntry[] = invite ? ([] as CsUserEntry[]).concat((invite as { 'cs:user'?: CsUserEntry | CsUserEntry[] })['cs:user'] ?? []) : []
  const entry = users.find((u) => u['d:href']?._text === href)

  if (!entry || 'cs:invite-invalid' in entry) {
    throw new ShareFailedError(
      `Could not resolve recipient "${input.recipient}" -- make sure this matches their registered email address exactly.`,
    )
  }

  return { mechanism: 'baikal-caldav-sharing', pending: false }
}

function findCsInvite(node: unknown): unknown {
  if (!node || typeof node !== 'object') return undefined
  const obj = node as Record<string, unknown>
  if ('cs:invite' in obj) return obj['cs:invite']
  for (const value of Object.values(obj)) {
    const found = findCsInvite(value)
    if (found) return found
  }
  return undefined
}

export async function shareCalendar(
  ctx: DavContext,
  calendarUrl: string,
  input: ShareCalendarInput,
): Promise<ShareCalendarResult> {
  try {
    return await tryRadicaleShare(ctx, calendarUrl, input)
  } catch (radicaleErr) {
    try {
      return await tryBaikalShare(ctx, calendarUrl, input)
    } catch (baikalErr) {
      const radicaleMsg = radicaleErr instanceof Error ? radicaleErr.message : String(radicaleErr)
      const baikalMsg = baikalErr instanceof Error ? baikalErr.message : String(baikalErr)
      throw new ShareFailedError(
        `Sharing failed. This server may not support sharing, or the recipient could not be resolved. ` +
          `(Radicale attempt: ${radicaleMsg}; Baikal attempt: ${baikalMsg})`,
      )
    }
  }
}

/**
 * Radicale map-shared calendars are otherwise indistinguishable from
 * normally-owned ones -- confirmed by spike-testing: a mapped calendar's
 * `resourcetype` is identical to an owned one (`<C:calendar/><collection/>`,
 * no `cs:shared` equivalent Baikal has). The only way to know a discovered
 * calendar is actually a share-to-me is to cross-reference it against
 * Radicale's own sharing API, so this fetches every map where the current
 * user is the recipient (`User`) and returns the set of *mounted*
 * (`PathOrToken`) pathnames those shares appear at -- fetchCalendars()
 * returns each calendar's URL as it's mounted under the current user's own
 * principal, not the owner's real underlying (`PathMapped`) collection
 * path, so `PathOrToken` is the one that actually matches (confirmed by
 * testing: comparing against `PathMapped` matched nothing at all).
 *
 * Best-effort: a server with no sharing support at all (or sharing
 * disabled) will fail this call in some server-specific way -- treated as
 * "no Radicale shares" rather than failing calendar discovery outright.
 */
interface RadicaleMapEntry {
  User?: string
  Owner?: string
  PathOrToken?: string
  PathMapped?: string
  EnabledByUser?: boolean
  HiddenByUser?: boolean
  TimestampUpdated?: number
}

async function fetchRadicaleMapList(ctx: DavContext): Promise<RadicaleMapEntry[]> {
  try {
    const res = await fetch(`${ctx.baseUrl}/.sharing/v1/map/list`, {
      method: 'POST',
      headers: { ...basicAuthHeader(ctx), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({}),
    })
    if (!res.ok) return []
    const body = (await res.json().catch(() => null)) as { Content?: RadicaleMapEntry[] } | null
    return body?.Content ?? []
  } catch {
    return []
  }
}

/**
 * Cleans up any Radicale map shares the current user owns that point at
 * `pathMapped` -- meant to be called right after the underlying collection
 * itself is deleted (`DavCalendarStore.deleteCalendar`). Without this, the
 * share row survives the collection it points to: `sharing_collection_by_map_resolver`
 * never checks that `PathMapped` still exists, so the recipient's
 * `/.sharing/v1/map/list` keeps returning it, and since it's still
 * `EnabledByUser` from before, `listPendingRadicaleShares` shows it as a
 * legitimate-looking pending invite for a calendar that no longer exists
 * (confirmed by hitting exactly this after deleting a calendar that had
 * been shared out during testing). Best-effort/fails-open, same spirit as
 * `listRadicaleSharedPaths` -- the calendar is already gone by the time
 * this runs, so a failure here is a hygiene issue, not a correctness one.
 */
export async function deleteRadicaleSharesForPath(ctx: DavContext, pathMapped: string): Promise<void> {
  const entries = await fetchRadicaleMapList(ctx)
  const owned = entries.filter((e) => e.Owner === ctx.username && e.PathMapped === pathMapped && e.PathOrToken)
  const headers = { ...basicAuthHeader(ctx), 'Content-Type': 'application/json', Accept: 'application/json' }
  for (const entry of owned) {
    try {
      await fetch(`${ctx.baseUrl}/.sharing/v1/map/delete`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ PathOrToken: entry.PathOrToken }),
      })
    } catch {
      // best-effort, see doc comment above
    }
  }
}

export async function listRadicaleSharedPaths(ctx: DavContext): Promise<Set<string>> {
  const entries = await fetchRadicaleMapList(ctx)
  return new Set(
    entries.filter((entry) => entry.User === ctx.username && entry.PathOrToken).map((entry) => entry.PathOrToken!),
  )
}

function findDisplayName(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null
  const obj = node as Record<string, unknown>
  // Radicale's own PROPFIND responses use an unprefixed default `xmlns="DAV:"`
  // (unlike Baikal, which prefixes it `d:`) -- this function is Radicale-only,
  // but checks both forms defensively.
  for (const key of ['displayname', 'd:displayname']) {
    const value = obj[key]
    if (value && typeof value === 'object' && '_text' in (value as Record<string, unknown>)) {
      const text = (value as { _text?: unknown })._text
      if (typeof text === 'string' && text) return text
    }
  }
  for (const value of Object.values(obj)) {
    const found = findDisplayName(value)
    if (found) return found
  }
  return null
}

/**
 * A pending share's `PathMapped` is a raw collection path, not the owner's
 * calendar's actual display name -- for calendars this app created itself
 * (`CreateCalendar`'s collection slug is a random UUID, not a readable
 * name), the fallback label derived from that path would show a UID
 * instead of something meaningful. Confirmed by testing that a direct
 * `PROPFIND` on the share's own `PathOrToken` returns the real
 * `displayname` even *before* the recipient has accepted the share (i.e.
 * while still hidden) -- so this fetches it proactively instead of
 * settling for the path-derived guess. Best-effort per share: any
 * failure just falls back to the path guess, same fails-open spirit as
 * the rest of this file.
 */
async function fetchShareDisplayName(ctx: DavContext, pathOrToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${ctx.baseUrl}${pathOrToken}`, {
      method: 'PROPFIND',
      headers: { ...basicAuthHeader(ctx), 'Content-Type': 'application/xml', Depth: '0' },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>',
    })
    if (!res.ok) return null
    const xml = await res.text()
    const parsed = xml2js(xml, { compact: true, ignoreDeclaration: true }) as Record<string, unknown>
    return findDisplayName(parsed)
  } catch {
    return null
  }
}

/**
 * Radicale shares where the current user is the recipient but hasn't yet
 * called `enable`+`unhide` on their own side -- "accepted" is defined as
 * both being true, matching the same dual-confirmation model documented
 * for `tryRadicaleShare`. A share the recipient explicitly re-hid after
 * accepting is treated as pending again, same as one never accepted --
 * there's no separate "declined" state in Radicale's model, only hidden
 * vs. not.
 */
export async function listPendingRadicaleShares(ctx: DavContext): Promise<PendingShare[]> {
  const entries = await fetchRadicaleMapList(ctx)
  const pending = entries
    .filter((entry) => entry.User === ctx.username && entry.PathOrToken)
    .filter((entry) => !(entry.EnabledByUser && !entry.HiddenByUser))

  return Promise.all(
    pending.map(async (entry) => ({
      pathOrToken: entry.PathOrToken!,
      owner: entry.Owner ?? 'unknown',
      label:
        (await fetchShareDisplayName(ctx, entry.PathOrToken!)) ??
        entry.PathMapped?.split('/').filter(Boolean).pop() ??
        'calendar',
      // Radicale reports this in unix seconds; the client compares it
      // against JS `Date.now()`-based dismissal timestamps, so convert to ms.
      updatedAt: (entry.TimestampUpdated ?? 0) * 1000,
    })),
  )
}

/**
 * Recipient-side "leave this shared calendar" -- removes it from the
 * current user's own view without touching the owner's calendar or any
 * other recipient's share. Uses Radicale's map `hide` action for a
 * Radicale share (the recipient-permitted half of the toggle set --
 * confirmed by reading `radicale/sharing/__init__.py`'s POST handler:
 * when the caller is the share's `User` rather than its `Owner`,
 * `hide`/`unhide` only ever touch `HiddenByUser`, never the owner's
 * side), or a plain DAV `DELETE` on the calendar URL for Baikal --
 * confirmed by reading `CalDAV/Backend/PDO.php`'s `deleteCalendar()`: it
 * looks up the *instance's* `access` level and only wipes the real
 * collection when that's `ACCESS_SHAREDOWNER`; for a recipient's instance
 * (`ACCESS_READ`/`ACCESS_READWRITE`) it deletes just that
 * `calendarinstances` row.
 *
 * **CRITICAL, learned the hard way**: which of the two paths to use is
 * decided by *positively confirming* this is a Radicale map share the
 * current user is the recipient of (via `fetchRadicaleMapList`) -- never
 * by "try hide, and if it doesn't report success, assume it must not be
 * Radicale and fall back to DELETE." An earlier version of this function
 * did exactly that fallback, and it is **not safe**: a raw DAV `DELETE`
 * issued by the recipient against their own *mounted* Radicale map path
 * does not merely remove their own instance the way Baikal's does --
 * Radicale's map resolver transparently forwards `DELETE` to the owner's
 * real underlying collection with no additional permission check.
 * Confirmed by directly testing this exact call: `shareduser` issuing a
 * plain `DELETE` against their own mounted `/shareduser/testuser-personal/`
 * returned `200`, and the owner's real `/testuser/personal/` collection
 * was immediately, irreversibly gone (404 on a direct PROPFIND
 * afterward, no trash/undo mechanism in Radicale's filesystem storage).
 * So: if this calendar IS a Radicale map share for this user, `hide` is
 * the only path ever attempted, and any failure there throws rather than
 * falling through to `DELETE`. `DELETE` is only reached when this lookup
 * confirms the calendar is *not* a Radicale share the caller receives --
 * i.e. Baikal, or any other server with no Radicale sharing concept at
 * all (where `fetchRadicaleMapList` fails open to `[]`).
 */
export async function unsubscribeFromCalendar(ctx: DavContext, calendarUrl: string): Promise<UnsubscribeResult> {
  const path = new URL(calendarUrl).pathname
  const headers = {
    ...basicAuthHeader(ctx),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  const radicaleShares = await fetchRadicaleMapList(ctx)
  const isRadicaleShare = radicaleShares.some((e) => e.User === ctx.username && e.PathOrToken === path)

  if (isRadicaleShare) {
    const hideRes = await fetch(`${ctx.baseUrl}/.sharing/v1/map/hide`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ PathOrToken: path }),
    })
    if (!hideRes.ok) {
      throw new ShareFailedError(`Radicale map/hide failed: ${hideRes.status}`)
    }
    const body = (await hideRes.json().catch(() => null)) as { Status?: string } | null
    if (body?.Status !== 'success') {
      throw new ShareFailedError('Radicale map/hide did not report success')
    }

    // Use Radicale's own TimestampUpdated for this share (re-fetched
    // post-hide), not the server process's Date.now() -- Radicale
    // computes TimestampUpdated from its host's naive local time treated
    // as UTC, which drifts from real UTC by that host's own offset.
    // Comparing it against a Date.now()-based value elsewhere (the
    // dismissal check in PendingSharesList.vue) only works if both sides
    // are on the same clock, so this fetches the fresh value from the
    // same source instead of stamping the moment with a different clock.
    const entries = await fetchRadicaleMapList(ctx)
    const updated = entries.find((e) => e.PathOrToken === path)
    const dismissedAt = updated?.TimestampUpdated ? updated.TimestampUpdated * 1000 : Date.now()
    return { dismissedPending: { pathOrToken: path, dismissedAt } }
  }

  const deleteRes = await fetch(calendarUrl, { method: 'DELETE', headers: basicAuthHeader(ctx) })
  if (!deleteRes.ok) {
    throw new ShareFailedError(`Could not unsubscribe: DELETE failed with ${deleteRes.status}`)
  }
  return { dismissedPending: null }
}

/** Accepts a pending Radicale share by enabling+unhiding the recipient's own side. */
export async function acceptRadicaleShare(ctx: DavContext, pathOrToken: string): Promise<void> {
  const headers = {
    ...basicAuthHeader(ctx),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  for (const action of ['enable', 'unhide']) {
    const res = await fetch(`${ctx.baseUrl}/.sharing/v1/map/${action}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ PathOrToken: pathOrToken }),
    })
    if (!res.ok) {
      throw new ShareFailedError(`Radicale map/${action} failed: ${res.status}`)
    }
  }
}
