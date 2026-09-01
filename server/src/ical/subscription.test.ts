import { beforeEach, describe, expect, it, vi } from 'vitest'

const safeFetchExternal = vi.fn()
vi.mock('../dav/ssrf.js', () => ({ safeFetchExternal: (...args: unknown[]) => safeFetchExternal(...args) }))

const { fetchSubscriptionEvents, subscriptionCalendarId, normalizeUrl } = await import('./subscription.js')

const wideRange = { start: '2020-01-01T00:00:00.000Z', end: '2030-01-01T00:00:00.000Z' }

function feedIcs(...vevents: string[]): string {
  return ['BEGIN:VCALENDAR', 'PRODID:-//test//EN', 'VERSION:2.0', ...vevents, 'END:VCALENDAR'].join('\r\n')
}

function vevent(uid: string, summary: string): string {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20260101T000000Z',
    'DTSTART:20260310T150000Z',
    'DTEND:20260310T153000Z',
    `SUMMARY:${summary}`,
    'END:VEVENT',
  ].join('\r\n')
}

beforeEach(() => {
  safeFetchExternal.mockReset()
})

describe('subscriptionCalendarId', () => {
  it('is stable for the same URL and normalizes webcal:// to https://', () => {
    const a = subscriptionCalendarId('https://example.com/feed.ics')
    const b = subscriptionCalendarId('https://example.com/feed.ics')
    const webcal = subscriptionCalendarId('webcal://example.com/feed.ics')
    expect(a).toBe(b)
    expect(a).toBe(webcal)
    expect(a).toMatch(/^sub:[0-9a-f]{16}$/)
  })

  it('differs for different URLs', () => {
    expect(subscriptionCalendarId('https://example.com/a.ics')).not.toBe(subscriptionCalendarId('https://example.com/b.ics'))
  })
})

describe('normalizeUrl', () => {
  it('rewrites webcal:// to https://', () => {
    expect(normalizeUrl('webcal://example.com/feed.ics')).toBe('https://example.com/feed.ics')
  })

  it('rewrites a Google Calendar embed URL to its iCal export URL', () => {
    const src = 'abc123@group.calendar.google.com'
    expect(
      normalizeUrl(`https://calendar.google.com/calendar/embed?src=${encodeURIComponent(src)}&ctz=America%2FNew_York`),
    ).toBe(`https://calendar.google.com/calendar/ical/${encodeURIComponent(src)}/public/basic.ics`)
  })

  it('leaves an already-correct Google iCal URL unchanged', () => {
    const ical = 'https://calendar.google.com/calendar/ical/abc123%40group.calendar.google.com/public/basic.ics'
    expect(normalizeUrl(ical)).toBe(ical)
  })

  it('leaves unrelated URLs unchanged', () => {
    expect(normalizeUrl('https://example.com/feed.ics')).toBe('https://example.com/feed.ics')
  })

  it('returns the input unchanged when it is not a valid URL', () => {
    expect(normalizeUrl('not a url')).toBe('not a url')
  })
})

describe('fetchSubscriptionEvents', () => {
  it('fetches, parses, and expands events from the feed', async () => {
    safeFetchExternal.mockResolvedValue({ text: feedIcs(vevent('e1', 'Feed Event')) })
    const results = await fetchSubscriptionEvents('https://example.com/feed.ics', wideRange)
    expect(results).toHaveLength(1)
    expect(results[0].summary).toBe('Feed Event')
    expect(results[0].etag).toBe('subscription')
    expect(safeFetchExternal).toHaveBeenCalledWith(
      'https://example.com/feed.ics',
      expect.objectContaining({ headers: { Accept: 'text/calendar' } }),
    )
  })

  it('normalizes webcal:// before fetching', async () => {
    safeFetchExternal.mockResolvedValue({ text: feedIcs() })
    await fetchSubscriptionEvents('webcal://example.com/feed.ics', wideRange)
    expect(safeFetchExternal).toHaveBeenCalledWith('https://example.com/feed.ics', expect.anything())
  })

  it('skips a malformed per-UID group instead of failing the whole feed', async () => {
    // A VEVENT missing DTSTART will throw during expansion; the rest of the
    // feed should still be returned.
    const broken = ['BEGIN:VEVENT', 'UID:broken', 'DTSTAMP:20260101T000000Z', 'SUMMARY:No dates', 'END:VEVENT'].join(
      '\r\n',
    )
    safeFetchExternal.mockResolvedValue({ text: feedIcs(broken, vevent('ok', 'Good Event')) })
    const results = await fetchSubscriptionEvents('https://example.com/feed.ics', wideRange)
    expect(results.map((r) => r.summary)).toEqual(['Good Event'])
  })

  it('returns no events for an empty feed', async () => {
    safeFetchExternal.mockResolvedValue({ text: feedIcs() })
    const results = await fetchSubscriptionEvents('https://example.com/feed.ics', wideRange)
    expect(results).toEqual([])
  })
})
