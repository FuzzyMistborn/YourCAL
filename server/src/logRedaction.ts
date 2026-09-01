// Query-string values that must never reach the logs:
//  - `url`  : subscription feed URLs, which for Google/Nextcloud/etc. embed a
//             secret token (`.../private-<hash>/basic.ics`) that grants read
//             access to the whole calendar.
//  - `href` : internal CalDAV object paths.
//  - `q`    : the user's raw search text.
const SENSITIVE_QUERY_KEYS = ['url', 'href', 'q']

/**
 * Rewrites a request URL for logging, replacing the value of any sensitive
 * query parameter with `REDACTED` while leaving the path and other params
 * intact. Returns the input unchanged when there's nothing to redact.
 */
export function redactLogUrl(url: string): string {
  const queryStart = url.indexOf('?')
  if (queryStart === -1) return url

  const params = new URLSearchParams(url.slice(queryStart + 1))
  let changed = false
  for (const key of SENSITIVE_QUERY_KEYS) {
    if (params.has(key)) {
      params.set(key, 'REDACTED')
      changed = true
    }
  }
  return changed ? `${url.slice(0, queryStart)}?${params.toString()}` : url
}
