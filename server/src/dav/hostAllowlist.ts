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
  const baseHost = new URL(baseUrl).hostname
  const hrefHost = new URL(href, baseUrl).hostname
  if (hrefHost !== baseHost) {
    throw new DisallowedHostError(`href "${href}" does not belong to the authenticated CalDAV host`)
  }
}
