import { lookup } from 'node:dns/promises'
import { isIPv4, isIPv6 } from 'node:net'

export class BlockedUrlError extends Error {}

const MAX_REDIRECTS = 5
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024 // 5MB, generous for an ICS feed

/**
 * Blocks loopback, private, link-local (incl. cloud metadata endpoints at
 * 169.254.169.254), and other non-public IPv4/IPv6 ranges.
 */
function isPrivateOrReservedIp(ip: string): boolean {
  if (isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 127) return true // loopback
    if (a === 10) return true // private
    if (a === 172 && b >= 16 && b <= 31) return true // private
    if (a === 192 && b === 168) return true // private
    if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
    if (a === 0) return true // "this network"
    return false
  }
  if (isIPv6(ip)) {
    const lower = ip.toLowerCase()
    if (lower === '::1') return true // loopback
    if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true // unique local
    if (lower.startsWith('::ffff:')) return isPrivateOrReservedIp(lower.slice('::ffff:'.length))
    return false
  }
  return true // unrecognized -- fail closed
}

/**
 * Resolves `hostname` and throws if it (or any resolved address) points at
 * a private/internal network. Re-resolving right before each request
 * (rather than trusting a cached result) narrows, though doesn't
 * eliminate, DNS-rebinding: the check and the actual TCP connect still
 * aren't atomic, since `fetch()` re-resolves internally.
 */
async function assertPublicHostname(hostname: string): Promise<void> {
  if (isIPv4(hostname) || isIPv6(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new BlockedUrlError(`Refusing to fetch from private/reserved address "${hostname}"`)
    }
    return
  }
  if (hostname === 'localhost') {
    throw new BlockedUrlError('Refusing to fetch from "localhost"')
  }
  let addresses: { address: string }[]
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new BlockedUrlError(`Could not resolve host "${hostname}"`)
  }
  for (const { address } of addresses) {
    if (isPrivateOrReservedIp(address)) {
      throw new BlockedUrlError(`Refusing to fetch from "${hostname}" (resolves to private address ${address})`)
    }
  }
}

/**
 * SSRF-hardened fetch for arbitrary user-supplied URLs (subscription
 * feeds): validates the target isn't a private/internal address before
 * every hop, follows redirects manually (re-validating each destination
 * rather than trusting `fetch`'s built-in follow, which doesn't re-check
 * this), and caps the response body size.
 */
export async function safeFetchExternal(url: string, init?: RequestInit): Promise<{ text: string }> {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(current)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BlockedUrlError(`Unsupported protocol "${parsed.protocol}"`)
    }
    await assertPublicHostname(parsed.hostname)

    const response = await fetch(current, { ...init, redirect: 'manual' })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new BlockedUrlError('Redirect response had no Location header')
      current = new URL(location, current).toString()
      continue
    }

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
      throw new BlockedUrlError('Response exceeds maximum allowed size')
    }

    const reader = response.body?.getReader()
    if (!reader) return { text: await response.text() }

    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new BlockedUrlError('Response exceeds maximum allowed size')
      }
      chunks.push(value)
    }
    return { text: Buffer.concat(chunks).toString('utf-8') }
  }
  throw new BlockedUrlError('Too many redirects')
}
