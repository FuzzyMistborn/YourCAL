import { createHash, randomBytes } from 'node:crypto'
import type { DavContext } from './context.js'

export type AuthMethod = 'Basic' | 'Digest'

export function basicAuthHeader(ctx: DavContext): Record<string, string> {
  return { Authorization: 'Basic ' + Buffer.from(`${ctx.username}:${ctx.password}`).toString('base64') }
}

// --- Digest (RFC 2617 / RFC 7616) -------------------------------------------

interface DigestChallenge {
  realm: string
  nonce: string
  qop?: string
  opaque?: string
  algorithm?: string
}

interface CachedChallenge {
  challenge: DigestChallenge
  cnonce: string
  nc: number
}

// Keyed by `${origin}\n${username}` -- a Digest nonce is scoped to the
// server, so every request to the same host (calendar CRUD, the sharing
// API, PROPPATCH) can reuse one negotiated challenge and just bump `nc`.
const challengeCache = new Map<string, CachedChallenge>()

export function parseDigestChallenge(headerValue: string): DigestChallenge | null {
  const match = /^\s*Digest\s+(.*)$/is.exec(headerValue)
  if (!match) return null
  const params: Record<string, string> = {}
  const re = /([a-z0-9_-]+)\s*=\s*(?:"([^"]*)"|([^,]*))/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(match[1])) !== null) {
    params[m[1].toLowerCase()] = m[2] ?? m[3]?.trim() ?? ''
  }
  if (!params.realm || !params.nonce) return null
  return {
    realm: params.realm,
    nonce: params.nonce,
    qop: params.qop ? params.qop.split(',')[0].trim() : undefined,
    opaque: params.opaque,
    algorithm: params.algorithm,
  }
}

function hashFor(algorithm: string | undefined): (input: string) => string {
  const algo = (algorithm ?? 'MD5').toUpperCase()
  const name = algo.startsWith('SHA-256') ? 'sha256' : 'md5'
  return (input: string) => createHash(name).update(input).digest('hex')
}

function formatNc(nc: number): string {
  return nc.toString(16).padStart(8, '0')
}

export function buildDigestHeader(
  ctx: DavContext,
  opts: { method: string; uri: string; challenge: DigestChallenge; nc: number; cnonce: string },
): string {
  const { method, uri, challenge, nc, cnonce } = opts
  const H = hashFor(challenge.algorithm)
  const sess = (challenge.algorithm ?? '').toUpperCase().endsWith('-SESS')

  let ha1 = H(`${ctx.username}:${challenge.realm}:${ctx.password}`)
  if (sess) ha1 = H(`${ha1}:${challenge.nonce}:${cnonce}`)
  const ha2 = H(`${method.toUpperCase()}:${uri}`)

  const ncHex = formatNc(nc)
  const response = challenge.qop
    ? H(`${ha1}:${challenge.nonce}:${ncHex}:${cnonce}:${challenge.qop}:${ha2}`)
    : H(`${ha1}:${challenge.nonce}:${ha2}`)

  const parts = [
    `username="${ctx.username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ]
  if (challenge.algorithm) parts.push(`algorithm=${challenge.algorithm}`)
  if (challenge.qop) parts.push(`qop=${challenge.qop}`, `nc=${ncHex}`, `cnonce="${cnonce}"`)
  if (challenge.opaque !== undefined) parts.push(`opaque="${challenge.opaque}"`)
  return `Digest ${parts.join(', ')}`
}

// --- Scheme detection & the shared request wrapper -------------------------

/**
 * Sends one unauthenticated PROPFIND at the CalDAV root and reads the
 * `WWW-Authenticate` challenge to decide how the app should authenticate.
 * Baikal (and other sabre/dav deployments) commonly offer only Digest;
 * when a server advertises Basic at all we prefer it (simpler, stateless).
 *
 * The caller is responsible for host-allowlisting `baseUrl` first (the
 * login route does, via `assertHostAllowed`, before calling this).
 */
export async function detectAuthMethod(baseUrl: string): Promise<AuthMethod> {
  let res: Response
  try {
    res = await fetch(baseUrl, {
      method: 'PROPFIND',
      headers: { 'Content-Type': 'application/xml', Depth: '0' },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
    })
  } catch {
    return 'Basic'
  }
  if (res.status !== 401) return 'Basic'
  const wa = res.headers.get('www-authenticate') ?? ''
  if (/\bDigest\b/i.test(wa) && !/\bBasic\b/i.test(wa)) return 'Digest'
  return 'Basic'
}

function targetUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function withAuthHeader(init: RequestInit | undefined, authorization: string): RequestInit {
  const headers = new Headers(init?.headers as HeadersInit | undefined)
  headers.set('Authorization', authorization)
  return { ...init, headers }
}

// A bodyless copy of the request init, used to probe for the Digest
// challenge. Sending the real request body on a call we expect to be 401'd
// leaves undici's keep-alive connection in a state some proxies (nginx in
// front of Baikal) mishandle, so the authenticated retry then reads a
// truncated/empty response -- which surfaces in tsdav as
// "cannot find principalUrl". The probe throws the body away; the real
// (authenticated) request that follows carries it.
function withoutBody(init: RequestInit | undefined, method: string): RequestInit {
  return { method, headers: init?.headers, redirect: 'manual' }
}

/**
 * Drop-in replacement for `fetch()` on every authenticated CalDAV request
 * (used directly by the raw sharing/PROPPATCH calls and wired in as
 * tsdav's `fetch` override). Basic just attaches the header; Digest does
 * the 401 challenge/response handshake, caching the negotiated challenge
 * per host and re-negotiating transparently when the nonce goes stale.
 */
export async function davFetch(
  ctx: DavContext,
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  if (ctx.authMethod !== 'Digest') {
    return fetch(input, withAuthHeader(init, basicAuthHeader(ctx).Authorization))
  }

  const url = targetUrl(input)
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  const parsed = new URL(url)
  const uri = parsed.pathname + parsed.search
  const key = `${parsed.origin}\n${ctx.username}`

  const send = (challenge: DigestChallenge, nc: number, cnonce: string): Promise<Response> =>
    fetch(input, withAuthHeader(init, buildDigestHeader(ctx, { method, uri, challenge, nc, cnonce })))

  // Fast path: reuse a previously negotiated challenge (sabre/dav validates
  // the response purely by hash, so the same nonce works for many requests
  // with an increasing `nc`). Only re-negotiate if it's gone stale.
  const cached = challengeCache.get(key)
  if (cached) {
    cached.nc += 1
    const res = await send(cached.challenge, cached.nc, cached.cnonce)
    if (res.status !== 401) return res
    // Nonce went stale: the 401 carries a fresh challenge -- use it directly.
    const stale = parseDigestChallenge(res.headers.get('www-authenticate') ?? '')
    await res.body?.cancel().catch(() => {})
    challengeCache.delete(key)
    if (stale) {
      const entry: CachedChallenge = { challenge: stale, cnonce: randomBytes(16).toString('hex'), nc: 1 }
      challengeCache.set(key, entry)
      return send(stale, 1, entry.cnonce)
    }
  }

  // Probe for a fresh challenge with a bodyless request (see withoutBody).
  let challenge: DigestChallenge | null = null
  const probe = await fetch(input, withoutBody(init, method))
  if (probe.status === 401) {
    challenge = parseDigestChallenge(probe.headers.get('www-authenticate') ?? '')
  }
  await probe.body?.cancel().catch(() => {})

  if (!challenge) {
    // The probe wasn't challenged (no auth needed, a redirect, or an error).
    // Fall back to the plain request; if that turns out to be challenged,
    // negotiate from its response.
    const res = await fetch(input, init)
    if (res.status !== 401) return res
    challenge = parseDigestChallenge(res.headers.get('www-authenticate') ?? '')
    if (!challenge) return res
    await res.body?.cancel().catch(() => {})
  }

  const entry: CachedChallenge = { challenge, cnonce: randomBytes(16).toString('hex'), nc: 1 }
  challengeCache.set(key, entry)
  return send(challenge, 1, entry.cnonce)
}
