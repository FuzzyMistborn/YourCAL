import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDigestHeader, davFetch, detectAuthMethod, parseDigestChallenge } from './auth.js'
import type { DavContext } from './context.js'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

describe('parseDigestChallenge', () => {
  it('parses a sabre/dav-style challenge with quoted params', () => {
    const c = parseDigestChallenge(
      'Digest realm="SabreDAV", qop="auth", nonce="abc123", opaque="zzz", algorithm=MD5',
    )
    expect(c).toEqual({ realm: 'SabreDAV', nonce: 'abc123', qop: 'auth', opaque: 'zzz', algorithm: 'MD5' })
  })

  it('takes the first qop when several are offered', () => {
    expect(parseDigestChallenge('Digest realm="r", nonce="n", qop="auth,auth-int"')?.qop).toBe('auth')
  })

  it('returns null when it is not a Digest challenge', () => {
    expect(parseDigestChallenge('Basic realm="r"')).toBeNull()
  })
})

describe('buildDigestHeader', () => {
  // RFC 2617 section 3.5 worked example.
  it('matches the RFC 2617 reference vector', () => {
    const ctx: DavContext = {
      baseUrl: 'http://host.com/',
      username: 'Mufasa',
      password: 'Circle Of Life',
      authMethod: 'Digest',
    }
    const header = buildDigestHeader(ctx, {
      method: 'GET',
      uri: '/dir/index.html',
      nc: 1,
      cnonce: '0a4f113b',
      challenge: {
        realm: 'testrealm@host.com',
        nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093',
        qop: 'auth',
        opaque: '5ccc069c403ebaf9f0171e9517f40e41',
      },
    })
    expect(header).toContain('response="6629fae49393a05397450978507c4ef1"')
    expect(header).toContain('nc=00000001')
    expect(header).toContain('uri="/dir/index.html"')
    expect(header).toContain('opaque="5ccc069c403ebaf9f0171e9517f40e41"')
  })
})

describe('detectAuthMethod', () => {
  it('returns Digest when the server challenges with Digest only', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('', { status: 401, headers: { 'www-authenticate': 'Digest realm="x", nonce="y"' } }),
    )
    expect(await detectAuthMethod('https://baikal.example.com/dav.php/')).toBe('Digest')
  })

  it('prefers Basic when the server offers it', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('', { status: 401, headers: { 'www-authenticate': 'Basic realm="x"' } }),
    )
    expect(await detectAuthMethod('https://caldav.example.com/dav/')).toBe('Basic')
  })

  it('defaults to Basic when the server does not challenge', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 207 }))
    expect(await detectAuthMethod('https://caldav.example.com/dav/')).toBe('Basic')
  })
})

describe('davFetch', () => {
  it('attaches a Basic header and makes a single request for a Basic context', async () => {
    const ctx: DavContext = { baseUrl: 'https://b.example.com/', username: 'alice', password: 'secret' }
    vi.mocked(fetch).mockResolvedValue(new Response('ok', { status: 200 }))

    await davFetch(ctx, 'https://b.example.com/dav/cal/', { method: 'PROPFIND' })

    expect(fetch).toHaveBeenCalledTimes(1)
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Basic ' + Buffer.from('alice:secret').toString('base64'),
    )
  })

  it('performs the 401 -> challenge -> retry handshake for a Digest context', async () => {
    const ctx: DavContext = {
      baseUrl: 'https://d1.example.com/',
      username: 'alice',
      password: 'secret',
      authMethod: 'Digest',
    }
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response('nope', {
          status: 401,
          headers: { 'www-authenticate': 'Digest realm="R", nonce="N1", qop="auth"' },
        }),
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const res = await davFetch(ctx, 'https://d1.example.com/dav/cal/', {
      method: 'PROPFIND',
      body: '<propfind/>',
    })

    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(2)
    // The challenge probe must not carry the request body.
    const [, probeInit] = vi.mocked(fetch).mock.calls[0]
    expect(probeInit?.body).toBeUndefined()
    const [, retryInit] = vi.mocked(fetch).mock.calls[1]
    expect((retryInit as { body?: unknown })?.body).toBe('<propfind/>')
    const auth = new Headers(retryInit?.headers).get('Authorization') ?? ''
    expect(auth).toMatch(/^Digest /)
    expect(auth).toContain('nc=00000001')
    expect(auth).toContain('uri="/dav/cal/"')
  })

  it('reuses a cached challenge on the next call and bumps nc, re-negotiating only on a stale 401', async () => {
    const ctx: DavContext = {
      baseUrl: 'https://d2.example.com/',
      username: 'alice',
      password: 'secret',
      authMethod: 'Digest',
    }
    // First call: negotiate.
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response('', { status: 401, headers: { 'www-authenticate': 'Digest realm="R", nonce="N1", qop="auth"' } }),
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    await davFetch(ctx, 'https://d2.example.com/a/', { method: 'PROPFIND' })

    // Second call: cached challenge used directly (one request), nc advances.
    vi.mocked(fetch).mockResolvedValueOnce(new Response('ok', { status: 200 }))
    await davFetch(ctx, 'https://d2.example.com/b/', { method: 'PROPFIND' })
    const [, secondInit] = vi.mocked(fetch).mock.calls[2]
    expect(new Headers(secondInit?.headers).get('Authorization')).toContain('nc=00000002')

    // Third call: server says the nonce is stale -> one retry with the new challenge.
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response('', {
          status: 401,
          headers: { 'www-authenticate': 'Digest realm="R", nonce="N2", qop="auth", stale=true' },
        }),
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    const res = await davFetch(ctx, 'https://d2.example.com/c/', { method: 'PROPFIND' })
    expect(res.status).toBe(200)
    const lastCall = vi.mocked(fetch).mock.calls.at(-1)!
    expect(new Headers(lastCall[1]?.headers).get('Authorization')).toContain('nonce="N2"')
  })
})
