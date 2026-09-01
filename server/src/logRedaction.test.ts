import { describe, expect, it } from 'vitest'
import { redactLogUrl } from './logRedaction.js'

describe('redactLogUrl', () => {
  it('leaves a URL with no query string untouched', () => {
    expect(redactLogUrl('/api/calendars/abc/events')).toBe('/api/calendars/abc/events')
  })

  it('redacts a subscription feed URL (secret token in `url`)', () => {
    const input =
      '/api/subscriptions/events?url=https%3A%2F%2Fcalendar.google.com%2Fcalendar%2Fical%2Fx%2Fprivate-deadbeef%2Fbasic.ics&start=2026-01-01'
    const out = redactLogUrl(input)
    expect(out).toContain('url=REDACTED')
    expect(out).not.toContain('private-deadbeef')
    expect(out).toContain('start=2026-01-01')
    expect(out.startsWith('/api/subscriptions/events?')).toBe(true)
  })

  it('redacts `q` and `href` too, keeping other params', () => {
    expect(redactLogUrl('/api/search?q=secret+project&start=2026-01-01')).toBe(
      '/api/search?q=REDACTED&start=2026-01-01',
    )
    expect(redactLogUrl('/api/calendars/abc/events/uid/export?href=/dav/geoff/x.ics')).toBe(
      '/api/calendars/abc/events/uid/export?href=REDACTED',
    )
  })

  it('returns the input unchanged when no sensitive param is present', () => {
    expect(redactLogUrl('/api/calendars/abc/events?start=2026-01-01&end=2026-02-01')).toBe(
      '/api/calendars/abc/events?start=2026-01-01&end=2026-02-01',
    )
  })
})
