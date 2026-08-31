import Fastify, { type FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DavContext } from '../dav/context.js'

// config.ts throws at import time if SESSION_SECRET is unset -- set it
// before any (even transitive) import pulls config.js in. Static imports
// are hoisted above this line, so anything reaching config.js must be
// imported dynamically, after this assignment runs.
process.env.SESSION_SECRET ??= 'a'.repeat(64)

const verifyCredentials = vi.fn()
vi.mock('../dav/discovery.js', () => ({ verifyCredentials: (...args: unknown[]) => verifyCredentials(...args) }))

const detectAuthMethod = vi.fn()
vi.mock('../dav/auth.js', () => ({ detectAuthMethod: (...args: unknown[]) => detectAuthMethod(...args) }))

const evictClient = vi.fn()
vi.mock('../dav/client.js', () => ({ evictClient: (...args: unknown[]) => evictClient(...args) }))

const { sessionRoutes } = await import('./session.js')
const { DisallowedHostError } = await import('../dav/hostAllowlist.js')

const dav: DavContext = { baseUrl: 'https://caldav.example.com/dav/', username: 'alice', password: 'secret' }

/** Builds a Fastify app with sessionRoutes mounted and a fake session store. */
async function buildApp(
  opts: { authenticated?: boolean } = {},
): Promise<{ app: FastifyInstance; sets: unknown[]; deletes: { count: number } }> {
  const { authenticated = true } = opts
  const sets: unknown[] = []
  const deletes = { count: 0 } // object, not a primitive -- mutated by the hook below, read by the test after inject()
  const app = Fastify()
  app.decorateRequest('session', null as never)
  app.addHook('onRequest', async (req) => {
    req.session = {
      get: (key: string) => (key === 'dav' && authenticated ? dav : undefined),
      set: (key: string, value: unknown) => sets.push([key, value]),
      delete: () => {
        deletes.count++
      },
    } as never
  })
  await app.register(sessionRoutes, { prefix: '/api/session' })
  return { app, sets, deletes }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/session', () => {
  it('400s when serverUrl/username/password are missing', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/session', payload: { serverUrl: 'https://x' } })
    expect(res.statusCode).toBe(400)
    expect(verifyCredentials).not.toHaveBeenCalled()
  })

  it('sets the session and returns 201 on valid credentials', async () => {
    verifyCredentials.mockResolvedValue(undefined)
    detectAuthMethod.mockResolvedValue('Basic')
    const { app, sets } = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { serverUrl: 'https://caldav.example.com/dav/', username: 'alice', password: 'secret' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ serverUrl: 'https://caldav.example.com/dav/', username: 'alice' })
    expect(sets).toEqual([
      ['dav', { baseUrl: 'https://caldav.example.com/dav/', username: 'alice', password: 'secret', authMethod: 'Basic' }],
    ])
  })

  it('stores the detected auth method (Digest) on the session', async () => {
    verifyCredentials.mockResolvedValue(undefined)
    detectAuthMethod.mockResolvedValue('Digest')
    const { app, sets } = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { serverUrl: 'https://baikal.example.com/dav.php/', username: 'alice', password: 'secret' },
    })
    expect(res.statusCode).toBe(201)
    expect(sets).toEqual([
      [
        'dav',
        { baseUrl: 'https://baikal.example.com/dav.php/', username: 'alice', password: 'secret', authMethod: 'Digest' },
      ],
    ])
  })

  it('403s on a DisallowedHostError', async () => {
    detectAuthMethod.mockResolvedValue('Basic')
    verifyCredentials.mockRejectedValue(new DisallowedHostError('nope'))
    const { app } = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { serverUrl: 'https://blocked.example.com/dav/', username: 'alice', password: 'secret' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('401s on any other verification failure', async () => {
    detectAuthMethod.mockResolvedValue('Basic')
    verifyCredentials.mockRejectedValue(new Error('bad creds'))
    const { app } = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { serverUrl: 'https://caldav.example.com/dav/', username: 'alice', password: 'wrong' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toMatchObject({ error: 'invalid_credentials' })
  })
})

describe('GET /api/session', () => {
  it('401s when unauthenticated', async () => {
    const { app } = await buildApp({ authenticated: false })
    const res = await app.inject({ method: 'GET', url: '/api/session' })
    expect(res.statusCode).toBe(401)
  })

  it('returns session info when authenticated', async () => {
    const { app } = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/session' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ serverUrl: dav.baseUrl, username: dav.username })
  })
})

describe('DELETE /api/session', () => {
  it('evicts the cached DAV client and clears the session when authenticated', async () => {
    const { app, deletes } = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/api/session' })
    expect(res.statusCode).toBe(204)
    expect(evictClient).toHaveBeenCalledWith(dav)
    expect(deletes.count).toBe(1)
  })

  it('still 204s and clears the session, without evicting, when there was no active session', async () => {
    const { app, deletes } = await buildApp({ authenticated: false })
    const res = await app.inject({ method: 'DELETE', url: '/api/session' })
    expect(res.statusCode).toBe(204)
    expect(evictClient).not.toHaveBeenCalled()
    expect(deletes.count).toBe(1)
  })
})
