import type { FastifyReply, FastifyRequest } from 'fastify'
import type { DavContext } from '../dav/context.js'

export function requireSession(req: FastifyRequest, reply: FastifyReply): DavContext | null {
  const dav = req.session.get('dav')
  if (!dav) {
    reply.code(401).send({ error: 'not_authenticated', message: 'No active session' })
    return null
  }
  return dav
}
