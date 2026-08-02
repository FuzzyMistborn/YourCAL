import type { FastifyInstance } from 'fastify'
import { acceptRadicaleShare, listPendingRadicaleShares, ShareFailedError } from '../dav/sharing.js'
import { requireSession } from './requireSession.js'

export async function sharingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/pending', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return

    const pending = await listPendingRadicaleShares(dav)
    return reply.send(pending)
  })

  app.post<{ Body: { pathOrToken: string } }>('/pending/accept', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return

    if (!req.body?.pathOrToken) {
      return reply.code(400).send({ error: 'bad_request', message: 'pathOrToken is required' })
    }

    try {
      await acceptRadicaleShare(dav, req.body.pathOrToken)
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof ShareFailedError) {
        return reply.code(422).send({ error: 'accept_failed', message: err.message })
      }
      throw err
    }
  })
}
