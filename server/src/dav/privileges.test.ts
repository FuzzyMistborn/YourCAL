import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DavContext } from './context.js'
import { isCalendarReadOnly } from './privileges.js'

const dav: DavContext = { baseUrl: 'https://caldav.example.com/dav/', username: 'alice', password: 'secret' }
const calendarUrl = 'https://caldav.example.com/dav/cal1/'

function privilegeSetXml(...privileges: string[]): string {
  const privXml = privileges.map((p) => `<d:privilege><d:${p}/></d:privilege>`).join('')
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop><d:current-user-privilege-set>${privXml}</d:current-user-privilege-set></d:prop></d:propstat></d:response></d:multistatus>`
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

describe('isCalendarReadOnly', () => {
  it('is false for an owner-shaped response (has bare "write")', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(privilegeSetXml('read', 'write'), { status: 207 }))
    expect(await isCalendarReadOnly(dav, calendarUrl)).toBe(false)
  })

  it('is false for a readwrite-share-recipient shape (read + write-content, no bare write)', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(privilegeSetXml('read', 'write-content'), { status: 207 }))
    expect(await isCalendarReadOnly(dav, calendarUrl)).toBe(false)
  })

  it('is true for a read-only-share-recipient shape (read only)', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(privilegeSetXml('read'), { status: 207 }))
    expect(await isCalendarReadOnly(dav, calendarUrl)).toBe(true)
  })

  it('fails open (false) on a non-OK HTTP response', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('forbidden', { status: 403 }))
    expect(await isCalendarReadOnly(dav, calendarUrl)).toBe(false)
  })

  it('fails open (false) when the privilege-set property is absent/unsupported', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response/></d:multistatus>', { status: 207 }),
    )
    expect(await isCalendarReadOnly(dav, calendarUrl)).toBe(false)
  })

  it('fails open (false) on a network error', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network down'))
    expect(await isCalendarReadOnly(dav, calendarUrl)).toBe(false)
  })
})
