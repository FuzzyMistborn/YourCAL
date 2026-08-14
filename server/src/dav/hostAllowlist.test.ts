import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// config.ts throws at import time if SESSION_SECRET is unset -- set required
// env before importing anything that pulls it in transitively.
process.env.SESSION_SECRET ??= 'a'.repeat(64)

describe('assertHostAllowed', () => {
  afterEach(() => {
    vi.resetModules()
    delete process.env.ALLOWED_CALDAV_HOSTS
  })

  it('allows any host when no allowlist is configured', async () => {
    delete process.env.ALLOWED_CALDAV_HOSTS
    vi.resetModules()
    const { assertHostAllowed } = await import('./hostAllowlist.js')
    expect(() => assertHostAllowed('https://anything.example.com/dav/')).not.toThrow()
  })

  it('allows a host present in the allowlist', async () => {
    process.env.ALLOWED_CALDAV_HOSTS = 'caldav.example.com, other.example.com'
    vi.resetModules()
    const { assertHostAllowed } = await import('./hostAllowlist.js')
    expect(() => assertHostAllowed('https://caldav.example.com/dav/')).not.toThrow()
  })

  it('rejects a host not present in the allowlist', async () => {
    process.env.ALLOWED_CALDAV_HOSTS = 'caldav.example.com'
    vi.resetModules()
    const { assertHostAllowed, DisallowedHostError } = await import('./hostAllowlist.js')
    expect(() => assertHostAllowed('https://evil.example.com/dav/')).toThrow(DisallowedHostError)
  })
})

describe('assertHrefSameHost', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('allows a same-origin relative href', async () => {
    const { assertHrefSameHost } = await import('./hostAllowlist.js')
    expect(() => assertHrefSameHost('https://caldav.example.com/dav/cal/', 'events/abc.ics')).not.toThrow()
  })

  it('allows a same-origin absolute href', async () => {
    const { assertHrefSameHost } = await import('./hostAllowlist.js')
    expect(() =>
      assertHrefSameHost('https://caldav.example.com/dav/cal/', 'https://caldav.example.com/dav/cal/abc.ics'),
    ).not.toThrow()
  })

  it('rejects a different hostname', async () => {
    const { assertHrefSameHost, DisallowedHostError } = await import('./hostAllowlist.js')
    expect(() =>
      assertHrefSameHost('https://caldav.example.com/dav/cal/', 'https://attacker.example.com/steal'),
    ).toThrow(DisallowedHostError)
  })

  it('rejects a same-hostname but different protocol', async () => {
    const { assertHrefSameHost, DisallowedHostError } = await import('./hostAllowlist.js')
    expect(() =>
      assertHrefSameHost('https://caldav.example.com/dav/cal/', 'http://caldav.example.com/dav/cal/abc.ics'),
    ).toThrow(DisallowedHostError)
  })

  it('rejects a same-hostname but different port', async () => {
    const { assertHrefSameHost, DisallowedHostError } = await import('./hostAllowlist.js')
    expect(() =>
      assertHrefSameHost('https://caldav.example.com/dav/cal/', 'https://caldav.example.com:8443/dav/cal/abc.ics'),
    ).toThrow(DisallowedHostError)
  })
})
