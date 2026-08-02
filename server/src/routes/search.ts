import type { CalendarObject } from '@yourcal/shared'
import type { FastifyInstance } from 'fastify'
import { store } from '../store/index.js'
import { requireSession } from './requireSession.js'

const DEFAULT_WINDOW_PAST_DAYS = 365
const DEFAULT_WINDOW_FUTURE_DAYS = 730
const MAX_RESULTS = 100

function matches(event: CalendarObject, needle: string): boolean {
  return (
    event.summary.toLowerCase().includes(needle) ||
    (event.description?.toLowerCase().includes(needle) ?? false) ||
    (event.location?.toLowerCase().includes(needle) ?? false)
  )
}

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q?: string; start?: string; end?: string } }>('/', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return

    const q = (req.query.q ?? '').trim()
    if (!q) {
      return reply.code(400).send({ error: 'bad_request', message: 'q query param is required' })
    }

    const now = new Date()
    const start = req.query.start ?? new Date(now.getTime() - DEFAULT_WINDOW_PAST_DAYS * 86400000).toISOString()
    const end = req.query.end ?? new Date(now.getTime() + DEFAULT_WINDOW_FUTURE_DAYS * 86400000).toISOString()

    const needle = q.toLowerCase()
    const calendars = await store.discoverCalendars(dav)

    const perCalendar = await Promise.all(
      calendars.map((cal) => store.getEvents(dav, cal.id, { start, end })),
    )

    const results = perCalendar
      .flat()
      .filter((event) => matches(event, needle))
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, MAX_RESULTS)

    return reply.send(results)
  })
}
