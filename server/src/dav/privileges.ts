import { xml2js } from 'xml-js'
import { davFetch } from './auth.js'
import type { DavContext } from './context.js'

/**
 * Reads real per-calendar write access via the standard WebDAV ACL
 * `current-user-privilege-set` property (RFC 3744) -- tsdav has no
 * built-in support for this (its `fetchCalendars()` requests a fixed prop
 * list that doesn't include it), so this is a raw PROPFIND per calendar,
 * following the same raw-fetch + xml-js pattern already used throughout
 * `sharing.ts` for other properties tsdav doesn't cover.
 *
 * Confirmed by spike-testing against real Radicale: the *owner* of a
 * calendar gets a `write` privilege among others, but a `rw`-permission
 * share **recipient** only ever gets `read` + `write-content` -- never a
 * bare `write` -- and a `r`-permission recipient gets only `read`. So
 * "can this user actually edit events here" has to check for either
 * `write` or `write-content`, not `write` alone.
 */
function stripPrefix(key: string): string {
  return key.includes(':') ? (key.split(':').pop() as string) : key
}

function collectPrivileges(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  for (const [key, value] of Object.entries(obj)) {
    if (stripPrefix(key) === 'privilege') {
      for (const entry of Array.isArray(value) ? value : [value]) {
        if (entry && typeof entry === 'object') {
          for (const childKey of Object.keys(entry as Record<string, unknown>)) {
            out.add(stripPrefix(childKey))
          }
        }
      }
    } else {
      collectPrivileges(value, out)
    }
  }
}

/**
 * Fails open (returns `false`, i.e. "not read-only") on any error --
 * PROPFIND failure, unparseable response, or a server with no ACL support
 * at all -- same fails-open spirit as `listRadicaleSharedPaths` elsewhere
 * in this codebase, so a server without this feature doesn't break
 * discovery or turn every calendar read-only by accident.
 */
export async function isCalendarReadOnly(ctx: DavContext, calendarUrl: string): Promise<boolean> {
  try {
    const res = await davFetch(ctx, calendarUrl, {
      method: 'PROPFIND',
      headers: { 'Content-Type': 'application/xml', Depth: '0' },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-privilege-set/></d:prop></d:propfind>',
    })
    if (!res.ok) return false
    const xml = await res.text()
    const parsed = xml2js(xml, { compact: true, ignoreDeclaration: true }) as Record<string, unknown>
    const privileges = new Set<string>()
    collectPrivileges(parsed, privileges)
    if (privileges.size === 0) return false // property absent/unsupported -- fail open
    return !privileges.has('write') && !privileges.has('write-content')
  } catch {
    return false
  }
}
