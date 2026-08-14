import type { Calendar, CalendarObject } from '@yourcal/shared'
import Fastify, { type FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DavContext } from '../dav/context.js'

process.env.SESSION_SECRET ??= 'a'.repeat(64)

const storeMock = { discoverCalendars: vi.fn(), getEvents: vi.fn() }
vi.mock('../store/index.js', () => ({ store: storeMock }))

const { searchRoutes } = await import('./search.js')

const dav: DavContext = { baseUrl: 'https://caldav.example.com/dav/', username: 'alice', password: 'secret' }

function calendar(id: string): Calendar {
  return {
    id,
    displayName: id,
    color: '#ff0000',
    readOnly: false,
    supportsEvents: true,
    supportsTasks: false,
    isShared: false,
    ctag: 'ctag-1',
  }
}

function event(overrides: Partial<CalendarObject> = {}): CalendarObject {
  return {
    uid: 'uid',
    etag: '"e"',
    href: 'events/uid.ics',
    calendarId: 'cal1',
    summary: 'Standup',
    description: null,
    location: null,
    start: '2026-03-10T15:00:00.000Z',
    end: '2026-03-10T15:30:00.000Z',
    allDay: false,
    timezone: null,
    recurrenceId: null,
    isRecurring: false,
    rrule: null,
    color: null,
    alarms: [],
    rdate: [],
    ...overrides,
  }
}

async function buildApp(opts: { authenticated?: boolean } = {}): Promise<FastifyInstance> {
  const { authenticated = true } = opts
  const app = Fastify()
  app.decorateRequest('session', null as never)
  app.addHook('onRequest', async (req) => {
    req.session = { get: (key: string) => (key === 'dav' && authenticated ? dav : undefined) } as never
  })
  await app.register(searchRoutes, { prefix: '/api/search' })
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/search', () => {
  it('401s when unauthenticated', async () => {
    const app = await buildApp({ authenticated: false })
    const res = await app.inject({ method: 'GET', url: '/api/search?q=standup' })
    expect(res.statusCode).toBe(401)
  })

  it('400s on a missing or blank q', async () => {
    const app = await buildApp()
    expect((await app.inject({ method: 'GET', url: '/api/search' })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/api/search?q=%20%20' })).statusCode).toBe(400)
  })

  it('matches case-insensitively across summary/description/location and merges across calendars', async () => {
    storeMock.discoverCalendars.mockResolvedValue([calendar('cal1'), calendar('cal2')])
    storeMock.getEvents.mockImplementation(async (_ctx: DavContext, calendarId: string) => {
      if (calendarId === 'cal1') return [event({ summary: 'Team STANDUP', start: '2026-03-10T15:00:00.000Z' })]
      return [
        event({ summary: 'Lunch', description: 'standup notes review', start: '2026-03-05T12:00:00.000Z' }),
        event({ summary: 'Unrelated', location: 'Standup Room', start: '2026-03-20T09:00:00.000Z' }),
        event({ summary: 'Nothing matches here' }),
      ]
    })
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/search?q=standup' })
    expect(res.statusCode).toBe(200)
    const results = res.json() as CalendarObject[]
    expect(results).toHaveLength(3)
    // sorted by start ascending
    expect(results.map((r) => r.start)).toEqual(['2026-03-05T12:00:00.000Z', '2026-03-10T15:00:00.000Z', '2026-03-20T09:00:00.000Z'])
  })

  it('applies a default ~365-day-past/~730-day-future window when start/end are omitted', async () => {
    storeMock.discoverCalendars.mockResolvedValue([calendar('cal1')])
    storeMock.getEvents.mockResolvedValue([])
    const app = await buildApp()
    const before = Date.now()
    await app.inject({ method: 'GET', url: '/api/search?q=standup' })
    const [, , range] = storeMock.getEvents.mock.calls[0] as [DavContext, string, { start: string; end: string }]

    const pastDays = (before - new Date(range.start).getTime()) / 86400000
    const futureDays = (new Date(range.end).getTime() - before) / 86400000
    expect(pastDays).toBeGreaterThan(364)
    expect(pastDays).toBeLessThan(366)
    expect(futureDays).toBeGreaterThan(729)
    expect(futureDays).toBeLessThan(731)
  })

  it('passes explicit start/end through untouched', async () => {
    storeMock.discoverCalendars.mockResolvedValue([calendar('cal1')])
    storeMock.getEvents.mockResolvedValue([])
    const app = await buildApp()
    await app.inject({
      method: 'GET',
      url: '/api/search?q=standup&start=2026-01-01T00:00:00.000Z&end=2026-02-01T00:00:00.000Z',
    })
    expect(storeMock.getEvents).toHaveBeenCalledWith(dav, 'cal1', {
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-02-01T00:00:00.000Z',
    })
  })

  it('caps results at MAX_RESULTS (100)', async () => {
    storeMock.discoverCalendars.mockResolvedValue([calendar('cal1')])
    const many = Array.from({ length: 150 }, (_, i) =>
      event({ uid: `uid-${i}`, summary: 'Standup', start: new Date(2026, 0, 1 + i).toISOString() }),
    )
    storeMock.getEvents.mockResolvedValue(many)
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/search?q=standup' })
    expect((res.json() as CalendarObject[])).toHaveLength(100)
  })
})
