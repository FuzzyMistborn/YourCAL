import type { Calendar } from '@yourcal/shared'
import Fastify, { type FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DavContext } from '../dav/context.js'

process.env.SESSION_SECRET ??= 'a'.repeat(64)

const storeMock = { discoverCalendars: vi.fn() }
vi.mock('../store/index.js', () => ({ store: storeMock }))

class ShareFailedError extends Error {}
const davSharingMock = {
  acceptRadicaleShare: vi.fn(),
  listPendingRadicaleShares: vi.fn(),
  listSharesForCalendar: vi.fn(),
  revokeShare: vi.fn(),
  updateSharePermission: vi.fn(),
  ShareFailedError,
}
vi.mock('../dav/sharing.js', () => davSharingMock)

const { sharingRoutes } = await import('./sharing.js')

const dav: DavContext = { baseUrl: 'https://caldav.example.com/dav/', username: 'alice', password: 'secret' }
const CAL_ID = Buffer.from('https://caldav.example.com/dav/cal1/', 'utf8').toString('base64url')

function calendar(overrides: Partial<Calendar> = {}): Calendar {
  return {
    id: CAL_ID,
    displayName: 'Personal',
    color: '#ff0000',
    readOnly: false,
    supportsEvents: true,
    supportsTasks: false,
    isShared: false,
    ctag: 'ctag-1',
    ...overrides,
  }
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify()
  app.decorateRequest('session', null as unknown as { get: () => unknown })
  app.addHook('onRequest', async (req) => {
    req.session = { get: (key: string) => (key === 'dav' ? dav : undefined) } as never
  })
  await app.register(sharingRoutes, { prefix: '/api/sharing' })
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/sharing/pending', () => {
  it('returns the pending shares list', async () => {
    davSharingMock.listPendingRadicaleShares.mockResolvedValue([{ path: 'p1' }])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/sharing/pending' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([{ path: 'p1' }])
  })
})

describe('POST /api/sharing/pending/accept', () => {
  it('400s on a missing pathOrToken', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/sharing/pending/accept', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('204s on success', async () => {
    davSharingMock.acceptRadicaleShare.mockResolvedValue(undefined)
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/sharing/pending/accept', payload: { pathOrToken: 'tok' } })
    expect(res.statusCode).toBe(204)
  })

  it('422s on ShareFailedError', async () => {
    davSharingMock.acceptRadicaleShare.mockRejectedValue(new ShareFailedError('nope'))
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/sharing/pending/accept', payload: { pathOrToken: 'tok' } })
    expect(res.statusCode).toBe(422)
  })
})

describe('GET /api/sharing/calendars/:id/shares', () => {
  it('404s for an unknown calendar', async () => {
    storeMock.discoverCalendars.mockResolvedValue([])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/api/sharing/calendars/${CAL_ID}/shares` })
    expect(res.statusCode).toBe(404)
  })

  it('403s for a calendar shared to (not owned by) the caller', async () => {
    storeMock.discoverCalendars.mockResolvedValue([calendar({ isShared: true })])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/api/sharing/calendars/${CAL_ID}/shares` })
    expect(res.statusCode).toBe(403)
  })

  it('returns the shares list for an owned calendar', async () => {
    storeMock.discoverCalendars.mockResolvedValue([calendar()])
    davSharingMock.listSharesForCalendar.mockResolvedValue([{ token: 't1', recipient: 'bob' }])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/api/sharing/calendars/${CAL_ID}/shares` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([{ token: 't1', recipient: 'bob' }])
  })
})

describe('PATCH /api/sharing/calendars/:id/shares/:token', () => {
  it('400s on an invalid permission', async () => {
    storeMock.discoverCalendars.mockResolvedValue([calendar()])
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/sharing/calendars/${CAL_ID}/shares/tok1`,
      payload: { permission: 'admin' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('403s for a non-owned calendar', async () => {
    storeMock.discoverCalendars.mockResolvedValue([calendar({ isShared: true })])
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/sharing/calendars/${CAL_ID}/shares/tok1`,
      payload: { permission: 'read' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('204s on success', async () => {
    storeMock.discoverCalendars.mockResolvedValue([calendar()])
    davSharingMock.updateSharePermission.mockResolvedValue(undefined)
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/sharing/calendars/${CAL_ID}/shares/tok1`,
      payload: { permission: 'readwrite' },
    })
    expect(res.statusCode).toBe(204)
  })

  it('422s on ShareFailedError', async () => {
    storeMock.discoverCalendars.mockResolvedValue([calendar()])
    davSharingMock.updateSharePermission.mockRejectedValue(new ShareFailedError('nope'))
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/sharing/calendars/${CAL_ID}/shares/tok1`,
      payload: { permission: 'read' },
    })
    expect(res.statusCode).toBe(422)
  })
})

describe('DELETE /api/sharing/calendars/:id/shares/:token', () => {
  it('403s for a non-owned calendar', async () => {
    storeMock.discoverCalendars.mockResolvedValue([calendar({ isShared: true })])
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: `/api/sharing/calendars/${CAL_ID}/shares/tok1` })
    expect(res.statusCode).toBe(403)
  })

  it('204s on success', async () => {
    storeMock.discoverCalendars.mockResolvedValue([calendar()])
    davSharingMock.revokeShare.mockResolvedValue(undefined)
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: `/api/sharing/calendars/${CAL_ID}/shares/tok1` })
    expect(res.statusCode).toBe(204)
  })

  it('422s on ShareFailedError', async () => {
    storeMock.discoverCalendars.mockResolvedValue([calendar()])
    davSharingMock.revokeShare.mockRejectedValue(new ShareFailedError('nope'))
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: `/api/sharing/calendars/${CAL_ID}/shares/tok1` })
    expect(res.statusCode).toBe(422)
  })
})
