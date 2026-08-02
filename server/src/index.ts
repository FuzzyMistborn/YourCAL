import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { config } from './config.js'
import { DisallowedHostError } from './dav/hostAllowlist.js'
import { registerSession } from './session.js'
import { sessionRoutes } from './routes/session.js'
import { calendarRoutes } from './routes/calendars.js'
import { searchRoutes } from './routes/search.js'
import { sharingRoutes } from './routes/sharing.js'
import { subscriptionRoutes } from './routes/subscriptions.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main(): Promise<void> {
  // Fastify's default max route-param length (100 chars) is too short for
  // this app's base64url-encoded calendar ids -- Radicale's shorter URLs
  // stayed under it by luck, but Baikal's longer `/dav.php/calendars/...`
  // paths exceed it, producing a 414 on every route with a real calendar id.
  const app = Fastify({ logger: true, maxParamLength: 500 })

  // A calendarId/href resolving to a different host than the authenticated
  // CalDAV server is a rejected SSRF attempt, not a server bug -- surface it
  // as 403, not the default 500 an uncaught throw would otherwise produce.
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof DisallowedHostError) {
      reply.code(403).send({ error: 'host_not_allowed', message: err.message })
      return
    }
    reply.send(err)
  })

  await registerSession(app)
  await app.register(sessionRoutes, { prefix: '/api/session' })
  await app.register(calendarRoutes, { prefix: '/api/calendars' })
  await app.register(searchRoutes, { prefix: '/api/search' })
  await app.register(sharingRoutes, { prefix: '/api/sharing' })
  await app.register(subscriptionRoutes, { prefix: '/api/subscriptions' })

  const clientDist = path.join(__dirname, '../../client/dist')
  await app.register(fastifyStatic, { root: clientDist })
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api')) {
      reply.code(404).send({ error: 'not_found', message: 'Unknown API route' })
      return
    }
    reply.sendFile('index.html')
  })

  await app.listen({ port: config.port, host: '0.0.0.0' })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
