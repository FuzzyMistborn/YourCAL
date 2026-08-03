import type { LoginRequest, SessionInfo } from '@yourcal/shared'
import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { evictClient } from '../dav/client.js'
import { verifyCredentials } from '../dav/discovery.js'
import { DisallowedHostError } from '../dav/hostAllowlist.js'

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: LoginRequest }>('/', async (req, reply) => {
    const { serverUrl, username, password } = req.body ?? {}
    if (!serverUrl || !username || !password) {
      return reply
        .code(400)
        .send({ error: 'bad_request', message: 'serverUrl, username and password are required' })
    }

    try {
      await verifyCredentials({ baseUrl: serverUrl, username, password })
    } catch (err) {
      if (err instanceof DisallowedHostError) {
        return reply.code(403).send({ error: 'host_not_allowed', message: err.message })
      }
      req.log.info({ err }, 'CalDAV login failed')
      return reply
        .code(401)
        .send({ error: 'invalid_credentials', message: 'Could not authenticate with the CalDAV server' })
    }

    req.session.set('dav', { baseUrl: serverUrl, username, password })

    const info: SessionInfo = { serverUrl, username, defaultTimezone: config.defaultTimezone }
    return reply.code(201).send(info)
  })

  app.get('/', async (req, reply) => {
    const dav = req.session.get('dav')
    if (!dav) {
      return reply.code(401).send({ error: 'not_authenticated', message: 'No active session' })
    }
    const info: SessionInfo = { serverUrl: dav.baseUrl, username: dav.username, defaultTimezone: config.defaultTimezone }
    return reply.send(info)
  })

  app.delete('/', async (req, reply) => {
    const dav = req.session.get('dav')
    if (dav) evictClient(dav)
    req.session.delete()
    return reply.code(204).send()
  })
}
