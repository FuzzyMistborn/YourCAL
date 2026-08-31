import type { FastifyInstance } from 'fastify'
import { fetchSubscriptionEvents } from '../ical/subscription.js'
import { requireSession } from './requireSession.js'

export async function subscriptionRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { url?: string; start?: string; end?: string } }>('/events', async (req, reply) => {
    // Fetches an arbitrary user-supplied URL server-side; safeFetchExternal
    // (server/src/dav/ssrf.ts) blocks private/loopback/link-local
    // addresses (incl. cloud metadata endpoints), re-validates every
    // redirect hop, and caps the response size.
    const dav = requireSession(req, reply)
    if (!dav) return

    const { url, start, end } = req.query
    if (!url || !start || !end) {
      return reply
        .code(400)
        .send({ error: 'bad_request', message: 'url, start and end query params are required' })
    }
    if (Number.isNaN(new Date(start).getTime()) || Number.isNaN(new Date(end).getTime())) {
      return reply.code(400).send({ error: 'bad_request', message: 'start and end must be valid ISO dates' })
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
