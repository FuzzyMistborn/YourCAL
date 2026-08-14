import type { CalendarObject } from '@yourcal/shared'
import Fastify, { type FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DavContext } from '../dav/context.js'

process.env.SESSION_SECRET ??= 'a'.repeat(64)

const fetchSubscriptionEvents = vi.fn()
vi.mock('../ical/subscription.js', () => ({
  fetchSubscriptionEvents: (...args: unknown[]) => fetchSubscriptionEvents(...args),
}))

const { subscriptionRoutes } = await import('./subscriptions.js')

const dav: DavContext = { baseUrl: 'https://caldav.example.com/dav/', username: 'alice', password: 'secret' }

async function buildApp(opts: { authenticated?: boolean } = {}): Promise<FastifyInstance> {
  const { authenticated = true } = opts
  const app = Fastify()
  app.decorateRequest('session', null as unknown as { get: () => unknown })
  app.addHook('onRequest', async (req) => {
    req.session = { get: (key: string) => (key === 'dav' && authenticated ? dav : undefined) } as never
  })
  await app.register(subscriptionRoutes, { prefix: '/api/subscriptions' })
  return app
}

const validQuery = 'url=https%3A%2F%2Fexample.com%2Ffeed.ics&start=2026-01-01T00:00:00.000Z&end=2026-02-01T00:00:00.000Z'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/subscriptions/events', () => {
  it('401s when unauthenticated', async () => {
    const app = await buildApp({ authenticated: false })
    const res = await app.inject({ method: 'GET', url: `/api/subscriptions/events?${validQuery}` })
    expect(res.statusCode).toBe(401)
  })

  it('400s when url/start/end are missing', async () => {
    const app = await buildApp()
    expect((await app.inject({ method: 'GET', url: '/api/subscriptions/events' })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/api/subscriptions/events?url=https://example.com/feed.ics' })).statusCode).toBe(400)
  })

  it('400s on an unparseable URL', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/subscriptions/events?url=not-a-url&start=2026-01-01T00:00:00.000Z&end=2026-02-01T00:00:00.000Z',
    })
    expect(res.statusCode).toBe(400)
  })

  it('400s on a non-http(s)/webcal protocol', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/subscriptions/events?url=ftp%3A%2F%2Fexample.com%2Ffeed.ics&start=2026-01-01T00:00:00.000Z&end=2026-02-01T00:00:00.000Z',
    })
    expect(res.statusCode).toBe(400)
    expect(fetchSubscriptionEvents).not.toHaveBeenCalled()
  })

  it('accepts a webcal:// URL', async () => {
    fetchSubscriptionEvents.mockResolvedValue([])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url:
        '/api/subscriptions/events?url=webcal%3A%2F%2Fexample.com%2Ffeed.ics&start=2026-01-01T00:00:00.000Z&end=2026-02-01T00:00:00.000Z',
    })
    expect(res.statusCode).toBe(200)
  })

  it('returns fetched events on success', async () => {
    const events = [{ uid: 'e1', summary: 'Feed Event' } as CalendarObject]
    fetchSubscriptionEvents.mockResolvedValue(events)
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/api/subscriptions/events?${validQuery}` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(events)
    expect(fetchSubscriptionEvents).toHaveBeenCalledWith('https://example.com/feed.ics', {
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-02-01T00:00:00.000Z',
    })
  })

  it('502s when fetching/parsing the feed fails', async () => {
    fetchSubscriptionEvents.mockRejectedValue(new Error('feed unreachable'))
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/api/subscriptions/events?${validQuery}` })
    expect(res.statusCode).toBe(502)
  })
})
