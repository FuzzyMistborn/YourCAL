import type { FastifyInstance } from 'fastify'
import { fetchSubscriptionEvents } from '../ical/subscription.js'
import { requireSession } from './requireSession.js'

export async function subscriptionRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { url?: string; start?: string; end?: string } }>('/events', async (req, reply) => {
    // Authenticated-only (like every other route here), but worth noting:
    // this fetches an arbitrary user-supplied URL server-side, which is a
    // limited SSRF surface for whoever is already logged into this
    // instance. Same trust level as the CalDAV login itself (also a
    // user-supplied URL fetched server-side) -- acceptable for a personal
    // self-hosted app, not something to expose more broadly without
    // reconsidering.
    const dav = requireSession(req, reply)
    if (!dav) return

    const { url, start, end } = req.query
    if (!url || !start || !end) {
      return reply
        .code(400)
        .send({ error: 'bad_request', message: 'url, start and end query params are required' })
    }

    let parsed: URL
    try {
      parsed = new URL(url.replace(/^webcal:\/\//, 'https://'))
    } catch {
      return reply.code(400).send({ error: 'bad_request', message: 'Invalid subscription URL' })
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return reply.code(400).send({ error: 'bad_request', message: 'Only http(s)/webcal URLs are supported' })
    }

    try {
      const events = await fetchSubscriptionEvents(url, { start, end })
      return reply.send(events)
    } catch (err) {
      req.log.warn({ err }, 'Failed to fetch subscription feed')
      return reply.code(502).send({ error: 'bad_gateway', message: 'Could not fetch or parse the subscription feed' })
    }
  })
}
