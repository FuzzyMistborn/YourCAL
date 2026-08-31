import type {
  Calendar,
  CalendarObject,
  CreateCalendarInput,
  SyncResult,
  TimeRange,
  UnsubscribeResult,
  UpdateCalendarInput,
} from '@yourcal/shared'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DavContext } from '../dav/context.js'
import { calendarObjectToIcs } from '../ical/mapper.js'
import type { CalendarStore, ObjectRef, RawObject, RawObjectWithHref } from './CalendarStore.js'
import { applySchema } from './sqlite/schema.js'
import { SqliteCalendarStore } from './SqliteCalendarStore.js'

const ctx: DavContext = { baseUrl: 'https://caldav.example.com/dav/', username: 'alice', password: 'secret' }

function calendar(overrides: Partial<Calendar> = {}): Calendar {
  return {
    id: 'cal1',
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

function eventFields(overrides: Record<string, unknown> = {}) {
  return {
    summary: 'Standup',
    description: null,
    location: null,
    start: '2026-03-10T15:00:00.000Z',
    end: '2026-03-10T15:30:00.000Z',
    allDay: false,
    timezone: null,
    rrule: null,
    color: null,
    alarms: [],
    rdate: [],
    ...overrides,
  } as Parameters<typeof calendarObjectToIcs>[1]
}

/** Minimal in-memory fake of the wrapped DavCalendarStore, driven entirely by test setup. */
class FakeDavStore implements CalendarStore {
  calendars: Calendar[] = []
  rawObjects = new Map<string, RawObject>() // href -> raw
  syncResult: SyncResult = { syncToken: 'token-1', changed: [], deletedHrefs: [] }
  createObjectCalls: { calendarId: string; ics: string }[] = []

  async discoverCalendars(): Promise<Calendar[]> {
    return this.calendars
  }
  async createCalendar(_ctx: DavContext, input: CreateCalendarInput): Promise<Calendar> {
    const created = calendar({ id: 'new-cal', displayName: input.displayName, color: input.color ?? '#000000' })
    this.calendars.push(created)
    return created
  }
  async updateCalendar(_ctx: DavContext, calendarId: string, input: UpdateCalendarInput): Promise<Calendar> {
    const existing = this.calendars.find((c) => c.id === calendarId)!
    Object.assign(existing, input)
    return existing
  }
  async getEvents(): Promise<CalendarObject[]> {
    throw new Error('not used by SqliteCalendarStore.getEvents')
  }
  async getRawObject(_ctx: DavContext, href: string): Promise<RawObject> {
    const raw = this.rawObjects.get(href)
    if (!raw) throw new Error(`no raw object for ${href}`)
    return raw
  }
  async getRawObjects(_ctx: DavContext, hrefs: string[]): Promise<RawObjectWithHref[]> {
    return hrefs.map((href) => ({ href, ...this.rawObjects.get(href)! }))
  }
  async syncCalendar(): Promise<SyncResult> {
    return this.syncResult
  }
  async createObject(_ctx: DavContext, calendarId: string, ics: string): Promise<CalendarObject> {
    this.createObjectCalls.push({ calendarId, ics })
    const href = `events/${Math.random().toString(36).slice(2)}.ics`
    const etag = '"etag-created"'
    this.rawObjects.set(href, { ics, etag })
    return { uid: 'created-uid', etag, href } as CalendarObject
  }
  async updateObject(_ctx: DavContext, obj: ObjectRef, ics: string): Promise<CalendarObject> {
    const etag = '"etag-updated"'
    this.rawObjects.set(obj.href, { ics, etag })
    return { uid: obj.uid, etag, href: obj.href } as CalendarObject
  }
  async deleteObject(_ctx: DavContext, obj: ObjectRef): Promise<void> {
    this.rawObjects.delete(obj.href)
  }
  async deleteCalendar(_ctx: DavContext, calendarId: string): Promise<void> {
    this.calendars = this.calendars.filter((c) => c.id !== calendarId)
  }
  async unsubscribeCalendar(_ctx: DavContext, calendarId: string): Promise<UnsubscribeResult> {
    this.calendars = this.calendars.filter((c) => c.id !== calendarId)
    return { dismissedPending: null }
  }
}

function makeStore(ttlMs = 30000) {
  const db = new Database(':memory:')
  applySchema(db)
  const dav = new FakeDavStore()
  const store = new SqliteCalendarStore(db, dav, ttlMs)
  return { db, dav, store }
}

describe('SqliteCalendarStore', () => {
  let db: Database.Database
  let dav: FakeDavStore
  let store: SqliteCalendarStore

  beforeEach(() => {
    ;({ db, dav, store } = makeStore())
  })

  it('discoverCalendars caches calendar rows and returns the live list', async () => {
    dav.calendars = [calendar()]
    const result = await store.discoverCalendars(ctx)
    expect(result).toEqual([calendar()])
    const row = db.prepare('SELECT * FROM calendars WHERE calendar_id = ?').get('cal1') as { display_name: string }
    expect(row.display_name).toBe('Personal')
  })

  it('discoverCalendars removes stale rows for calendars no longer returned', async () => {
    dav.calendars = [calendar(), calendar({ id: 'cal2', displayName: 'Work' })]
    await store.discoverCalendars(ctx)
    dav.calendars = [calendar()] // cal2 no longer visible (deleted/unsubscribed)
    await store.discoverCalendars(ctx)
    const rows = db.prepare('SELECT calendar_id FROM calendars').all() as { calendar_id: string }[]
    expect(rows.map((r) => r.calendar_id)).toEqual(['cal1'])
  })

  it('getEvents triggers a first sync, caches objects, and expands them from the cache', async () => {
    dav.calendars = [calendar()]
    await store.discoverCalendars(ctx)

    const ics = calendarObjectToIcs('uid1', eventFields())
    dav.rawObjects.set('events/uid1.ics', { ics, etag: '"etag1"' })
    dav.syncResult = {
      syncToken: 'token-1',
      changed: [{ uid: 'uid1', href: 'events/uid1.ics' } as CalendarObject],
      deletedHrefs: [],
    }

    const range: TimeRange = { start: '2020-01-01T00:00:00.000Z', end: '2030-01-01T00:00:00.000Z' }
    const events = await store.getEvents(ctx, 'cal1', range)
    expect(events).toHaveLength(1)
    expect(events[0].summary).toBe('Standup')

    const objRow = db.prepare('SELECT uid FROM objects WHERE calendar_id = ?').get('cal1') as { uid: string }
    expect(objRow.uid).toBe('uid1')
  })

  it('getEvents does not re-sync within the TTL window', async () => {
    dav.calendars = [calendar()]
    await store.discoverCalendars(ctx)
    dav.rawObjects.set('events/uid1.ics', { ics: calendarObjectToIcs('uid1', eventFields()), etag: '"etag1"' })
    dav.syncResult = { syncToken: 'token-1', changed: [{ uid: 'uid1', href: 'events/uid1.ics' } as CalendarObject], deletedHrefs: [] }

    const range: TimeRange = { start: '2020-01-01T00:00:00.000Z', end: '2030-01-01T00:00:00.000Z' }
    await store.getEvents(ctx, 'cal1', range)

    let syncCallCount = 0
    const originalSync = dav.syncCalendar.bind(dav)
    dav.syncCalendar = async (...args) => {
      syncCallCount++
      return originalSync(...args)
    }
    await store.getEvents(ctx, 'cal1', range)
    expect(syncCallCount).toBe(0)
  })

  it('getEvents removes objects reported deleted by sync', async () => {
    dav.calendars = [calendar()]
    await store.discoverCalendars(ctx)
    dav.rawObjects.set('events/uid1.ics', { ics: calendarObjectToIcs('uid1', eventFields()), etag: '"etag1"' })
    dav.syncResult = { syncToken: 'token-1', changed: [{ uid: 'uid1', href: 'events/uid1.ics' } as CalendarObject], deletedHrefs: [] }
    const range: TimeRange = { start: '2020-01-01T00:00:00.000Z', end: '2030-01-01T00:00:00.000Z' }
    await store.getEvents(ctx, 'cal1', range) // first sync, caches uid1

    // Force staleness and report uid1's href as deleted this time.
    db.prepare('UPDATE calendars SET last_synced_at = 0').run()
    dav.syncResult = { syncToken: 'token-2', changed: [], deletedHrefs: ['events/uid1.ics'] }
    const events = await store.getEvents(ctx, 'cal1', range)
    expect(events).toHaveLength(0)
    const row = db.prepare('SELECT * FROM objects WHERE calendar_id = ?').get('cal1')
    expect(row).toBeUndefined()
  })

  it('createObject/updateObject/deleteObject write through to the wrapped store and reflect into the cache', async () => {
    dav.calendars = [calendar()]
    await store.discoverCalendars(ctx)

    const created = await store.createObject(ctx, 'cal1', calendarObjectToIcs('uid2', eventFields()))
    expect(dav.createObjectCalls).toHaveLength(1)
    let row = db.prepare('SELECT * FROM objects WHERE href = ?').get(created.href)
    expect(row).toBeDefined()

    await store.updateObject(ctx, { calendarId: 'cal1', uid: created.uid, href: created.href, etag: created.etag }, calendarObjectToIcs('uid2', eventFields({ summary: 'Updated' })))
    row = db.prepare('SELECT ics FROM objects WHERE href = ?').get(created.href) as { ics: string }
    expect((row as { ics: string }).ics).toContain('Updated')

    await store.deleteObject(ctx, { calendarId: 'cal1', uid: created.uid, href: created.href, etag: created.etag })
    row = db.prepare('SELECT * FROM objects WHERE href = ?').get(created.href)
    expect(row).toBeUndefined()
  })

  it('deleteCalendar purges cached calendar and object rows', async () => {
    dav.calendars = [calendar()]
    await store.discoverCalendars(ctx)
    await store.createObject(ctx, 'cal1', calendarObjectToIcs('uid3', eventFields()))

    await store.deleteCalendar(ctx, 'cal1')
    expect(db.prepare('SELECT * FROM calendars WHERE calendar_id = ?').get('cal1')).toBeUndefined()
    expect(db.prepare('SELECT * FROM objects WHERE calendar_id = ?').get('cal1')).toBeUndefined()
  })

  it('getRawObject falls back to the live store when not cached', async () => {
    dav.rawObjects.set('events/uncached.ics', { ics: 'ICS-CONTENT', etag: '"e"' })
    const raw = await store.getRawObject(ctx, 'events/uncached.ics')
    expect(raw.ics).toBe('ICS-CONTENT')
  })

  describe('searchEvents', () => {
    // Seed the cache by pushing objects through a first sync (populates
    // search_text via the same path a real sync uses). The range passed to
    // getEvents only filters the read, not the sync, so a non-overlapping
    // one is fine here.
    async function seed(objs: { uid: string; fields?: Record<string, unknown> }[]): Promise<void> {
      dav.calendars = [calendar()]
      await store.discoverCalendars(ctx)
      const changed: CalendarObject[] = []
      for (const o of objs) {
        const href = `events/${o.uid}.ics`
        dav.rawObjects.set(href, { ics: calendarObjectToIcs(o.uid, eventFields(o.fields)), etag: `"${o.uid}"` })
        changed.push({ uid: o.uid, href } as CalendarObject)
      }
      dav.syncResult = { syncToken: 'token-1', changed, deletedHrefs: [] }
      await store.getEvents(ctx, 'cal1', { start: '1970-01-01T00:00:00.000Z', end: '1971-01-01T00:00:00.000Z' })
    }

    it('substring-matches summary case-insensitively', async () => {
      await seed([{ uid: 'a', fields: { summary: 'Team STANDUP' } }, { uid: 'b', fields: { summary: 'Lunch' } }])
      const results = await store.searchEvents!(ctx, 'standup')
      expect(results.map((r) => r.summary)).toEqual(['Team STANDUP'])
    })

    it('matches description and location too', async () => {
      await seed([
        { uid: 'c', fields: { summary: 'X', description: 'quarterly Budget review' } },
        { uid: 'd', fields: { summary: 'Y', location: 'Budget Room' } },
        { uid: 'e', fields: { summary: 'Z' } },
      ])
      const results = await store.searchEvents!(ctx, 'budget')
      expect(results.map((r) => r.uid).sort()).toEqual(['c', 'd'])
    })

    it('searches the full history, not a bounded window', async () => {
      await seed([
        { uid: 'old', fields: { summary: 'Standup', start: '2005-06-01T10:00:00.000Z', end: '2005-06-01T10:30:00.000Z' } },
      ])
      const results = await store.searchEvents!(ctx, 'standup')
      expect(results).toHaveLength(1)
      expect(results[0].start).toBe('2005-06-01T10:00:00.000Z')
    })

    it('returns one result (the series master) for a recurring match', async () => {
      await seed([{ uid: 'r', fields: { summary: 'Weekly Standup', rrule: 'FREQ=WEEKLY;COUNT=100' } }])
      const results = await store.searchEvents!(ctx, 'standup')
      expect(results).toHaveLength(1)
      expect(results[0].isRecurring).toBe(true)
    })

    it('returns nothing for a blank query', async () => {
      await seed([{ uid: 'a', fields: { summary: 'Standup' } }])
      expect(await store.searchEvents!(ctx, '   ')).toEqual([])
    })
  })
})
