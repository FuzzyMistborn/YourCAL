import { config } from '../config.js'

export class DisallowedHostError extends Error {}

export function assertHostAllowed(serverUrl: string): void {
  if (!config.allowedCalDavHosts) return

  const host = new URL(serverUrl).hostname
  if (!config.allowedCalDavHosts.includes(host)) {
    throw new DisallowedHostError(`CalDAV host "${host}" is not on the allowlist`)
  }
}

/**
 * Guards against a client-supplied href (from a write/delete request body)
 * pointing at a different host than the one the session authenticated
 * against -- without this, an authenticated user could pass an arbitrary
 * URL as `href` and have the server issue a WebDAV request to it carrying
 * their CalDAV credentials (SSRF + credential exfiltration).
 */
export function assertHrefSameHost(baseUrl: string, href: string): void {
  const base = new URL(baseUrl)
  const target = new URL(href, baseUrl)
  // Origin, not just hostname: a same-host URL on a different port or
  // protocol (e.g. http:// instead of https://, or an internal port
  // exposed on the same box) would otherwise pass this check and still
  // receive the session's Basic-auth credentials.
  if (target.protocol !== base.protocol || target.hostname !== base.hostname || target.port !== base.port) {
    throw new DisallowedHostError(`href "${href}" does not belong to the authenticated CalDAV host`)
  }
}
