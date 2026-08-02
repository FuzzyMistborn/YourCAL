import secureSession from '@fastify/secure-session'
import type { FastifyInstance } from 'fastify'
import { config } from './config.js'
import type { DavContext } from './dav/context.js'

declare module '@fastify/secure-session' {
  interface SessionData {
    dav: DavContext
  }
}

export async function registerSession(app: FastifyInstance): Promise<void> {
  await app.register(secureSession, {
    key: Buffer.from(config.sessionSecret, 'hex'),
    expiry: config.sessionTtlSeconds,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.nodeEnv === 'production',
      path: '/',
      maxAge: config.sessionTtlSeconds,
    },
  })
}
