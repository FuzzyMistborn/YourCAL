import { beforeEach, describe, expect, it, vi } from 'vitest'

const lookup = vi.fn()
vi.mock('node:dns/promises', () => ({ lookup: (...args: unknown[]) => lookup(...args) }))

const { safeFetchExternal, BlockedUrlError } = await import('./ssrf.js')

function textResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, ...init })
}

beforeEach(() => {
  lookup.mockReset()
  vi.stubGlobal('fetch', vi.fn())
})

describe('safeFetchExternal', () => {
  it('fetches a public URL successfully', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34' }])
    vi.mocked(fetch).mockResolvedValue(textResponse('hello'))
    const result = await safeFetchExternal('https://example.com/feed.ics')
    expect(result.text).toBe('hello')
  })

  it('rejects an unsupported protocol', async () => {
    await expect(safeFetchExternal('ftp://example.com/feed.ics')).rejects.toThrow(BlockedUrlError)
  })

  it('rejects "localhost" outright', async () => {
    await expect(safeFetchExternal('http://localhost/feed.ics')).rejects.toThrow(BlockedUrlError)
  })

  it('rejects a literal loopback IP', async () => {
    await expect(safeFetchExternal('http://127.0.0.1/feed.ics')).rejects.toThrow(BlockedUrlError)
  })

  it('rejects a literal private IP', async () => {
    await expect(safeFetchExternal('http://192.168.1.1/feed.ics')).rejects.toThrow(BlockedUrlError)
  })

  it('rejects the cloud metadata link-local address', async () => {
    await expect(safeFetchExternal('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(BlockedUrlError)
  })

  it('rejects a hostname that resolves to a private address', async () => {
    lookup.mockResolvedValue([{ address: '10.0.0.5' }])
    await expect(safeFetchExternal('https://internal.example.com/feed.ics')).rejects.toThrow(BlockedUrlError)
  })

  it('rejects a hostname that fails to resolve', async () => {
    lookup.mockRejectedValue(new Error('ENOTFOUND'))
    await expect(safeFetchExternal('https://nonexistent.invalid/feed.ics')).rejects.toThrow(BlockedUrlError)
  })

  it('re-validates the destination of a redirect rather than trusting it', async () => {
    lookup.mockResolvedValueOnce([{ address: '93.184.216.34' }])
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }),
    )
    await expect(safeFetchExternal('https://example.com/feed.ics')).rejects.toThrow(BlockedUrlError)
  })

  it('follows a redirect to a public host and returns its body', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34' }])
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://example.com/final.ics' } }))
      .mockResolvedValueOnce(textResponse('final content'))
    const result = await safeFetchExternal('https://example.com/feed.ics')
    expect(result.text).toBe('final content')
  })

  it('rejects a response over the size cap via Content-Length', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34' }])
    vi.mocked(fetch).mockResolvedValue(textResponse('x', { headers: { 'content-length': String(10 * 1024 * 1024) } }))
    await expect(safeFetchExternal('https://example.com/feed.ics')).rejects.toThrow(BlockedUrlError)
  })

  it('rejects a non-ok response', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34' }])
    vi.mocked(fetch).mockResolvedValue(new Response('nope', { status: 500 }))
    await expect(safeFetchExternal('https://example.com/feed.ics')).rejects.toThrow(/500/)
  })
})
