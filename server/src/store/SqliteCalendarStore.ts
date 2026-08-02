import type {
  Calendar,
  CalendarObject,
  CreateCalendarInput,
  SyncResult,
  TimeRange,
  UnsubscribeResult,
} from '@yourcal/shared'
import type Database from 'better-sqlite3'
import type { DavContext } from '../dav/context.js'
import { expandCalendarObject } from '../ical/recurrence.js'
import type { CalendarStore, ObjectRef, RawObject, RawObjectWithHref } from './CalendarStore.js'
import { deriveUserKey } from './sqlite/userKey.js'

interface CalendarRow {
  user_key: string
  calendar_id: string
  display_name: string
  color: string
  read_only: number
  supports_events: number
  supports_tasks: number
  is_shared: number
  ctag: string | null
  sync_token: string | null
  last_synced_at: number | null
}

interface ObjectRow {
  uid: string
  href: string
  etag: string
  ics: string
}

/**
 * Read-cache decorator over another CalendarStore (in practice always
 * DavCalendarStore). Reads are served from SQLite, refreshed via a
 * TTL-gated sync against the wrapped store; writes are always write-through
 * to the wrapped store first, then reflected into the cache -- this is a
 * read cache only, never a pending-write queue. See AGENTS.md for the
 * design rationale (the SQLite scoping plan this implements).
 */
export class SqliteCalendarStore implements CalendarStore {
  constructor(
    private readonly db: Database.Database,
    private readonly dav: CalendarStore,
    private readonly ttlMs: number,
  ) {}

  private ensureUser(userKey: string, ctx: DavContext): void {
    this.db
      .prepare(
        `INSERT INTO users (user_key, base_url, username, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_key) DO NOTHING`,
      )
      .run(userKey, ctx.baseUrl, ctx.username, Date.now())
  }

  async discoverCalendars(ctx: DavContext): Promise<Calendar[]> {
    const userKey = deriveUserKey(ctx)
    this.ensureUser(userKey, ctx)

    // The calendar *list* is always fetched live -- it's one cheap PROPFIND,
    // unlike event data, and caching it risks silently hiding a
    // newly-added or removed calendar. Only the (expensive) event data
    // below is actually TTL-cached. sync_token/last_synced_at are
    // preserved across re-discovery so an existing calendar's cached
    // objects aren't invalidated just because its metadata was re-fetched.
    const calendars = await this.dav.discoverCalendars(ctx)

    const upsert = this.db.prepare(`
      INSERT INTO calendars (user_key, calendar_id, display_name, color, read_only, supports_events, supports_tasks, is_shared, ctag)
      VALUES (@userKey, @calendarId, @displayName, @color, @readOnly, @supportsEvents, @supportsTasks, @isShared, @ctag)
      ON CONFLICT(user_key, calendar_id) DO UPDATE SET
        display_name = excluded.display_name,
        color = excluded.color,
        read_only = excluded.read_only,
        supports_events = excluded.supports_events,
        supports_tasks = excluded.supports_tasks,
        is_shared = excluded.is_shared,
        ctag = excluded.ctag
    `)
    const upsertAll = this.db.transaction((cals: Calendar[]) => {
      for (const cal of cals) {
        upsert.run({
          userKey,
          calendarId: cal.id,
          displayName: cal.displayName,
          color: cal.color,
          readOnly: cal.readOnly ? 1 : 0,
          supportsEvents: cal.supportsEvents ? 1 : 0,
          supportsTasks: cal.supportsTasks ? 1 : 0,
          isShared: cal.isShared ? 1 : 0,
          ctag: cal.ctag,
        })
      }
    })
    upsertAll(calendars)

    return calendars
  }

  async createCalendar(ctx: DavContext, input: CreateCalendarInput): Promise<Calendar> {
    const created = await this.dav.createCalendar(ctx, input)
    const userKey = deriveUserKey(ctx)
    this.ensureUser(userKey, ctx)
    this.db
      .prepare(
        `INSERT INTO calendars (user_key, calendar_id, display_name, color, read_only, supports_events, supports_tasks, is_shared, ctag)
         VALUES (@userKey, @calendarId, @displayName, @color, @readOnly, @supportsEvents, @supportsTasks, @isShared, @ctag)
         ON CONFLICT(user_key, calendar_id) DO UPDATE SET
           display_name = excluded.display_name,
           color = excluded.color,
           read_only = excluded.read_only,
           supports_events = excluded.supports_events,
           supports_tasks = excluded.supports_tasks,
           is_shared = excluded.is_shared,
           ctag = excluded.ctag`,
      )
      .run({
        userKey,
        calendarId: created.id,
        displayName: created.displayName,
        color: created.color,
        readOnly: created.readOnly ? 1 : 0,
        supportsEvents: created.supportsEvents ? 1 : 0,
        supportsTasks: created.supportsTasks ? 1 : 0,
        isShared: created.isShared ? 1 : 0,
        ctag: created.ctag,
      })
    return created
  }

  /** TTL-gated sync-if-stale. Bounds cache staleness to at most `ttlMs`. */
  private async ensureFresh(ctx: DavContext, calendarId: string): Promise<void> {
    const userKey = deriveUserKey(ctx)
    const row = this.db
      .prepare<[string, string], CalendarRow>(
        'SELECT * FROM calendars WHERE user_key = ? AND calendar_id = ?',
      )
      .get(userKey, calendarId)

    if (!row) {
      throw new Error(`Unknown calendar ${calendarId} -- discoverCalendars must run first`)
    }

    const isFirstSync = row.sync_token === null
    const isStale = !isFirstSync && Date.now() - (row.last_synced_at ?? 0) > this.ttlMs
    if (!isFirstSync && !isStale) return

    const result: SyncResult = await this.dav.syncCalendar(ctx, calendarId, row.sync_token ?? undefined)

    // SyncResult.changed carries already-parsed CalendarObjects, not raw
    // ICS -- fetch it for exactly the changed hrefs in one batched
    // multiget (getRawObjects), not one getRawObject call per object
    // (which would mean one full CalDAV login per object during a sync).
    const rawByHref = new Map(
      (await this.dav.getRawObjects(ctx, result.changed.map((obj) => obj.href))).map((raw) => [raw.href, raw]),
    )

    const upsertObject = this.db.prepare(`
      INSERT INTO objects (user_key, calendar_id, uid, href, etag, ics, updated_at)
      VALUES (@userKey, @calendarId, @uid, @href, @etag, @ics, @updatedAt)
      ON CONFLICT(user_key, calendar_id, uid) DO UPDATE SET
        href = excluded.href,
        etag = excluded.etag,
        ics = excluded.ics,
        updated_at = excluded.updated_at
    `)
    const deleteObject = this.db.prepare(
      'DELETE FROM objects WHERE user_key = ? AND calendar_id = ? AND uid = ?',
    )
    const setSyncState = this.db.prepare(
      'UPDATE calendars SET sync_token = ?, last_synced_at = ? WHERE user_key = ? AND calendar_id = ?',
    )

    const applyAll = this.db.transaction(() => {
      const now = Date.now()
      for (const obj of result.changed) {
        const raw = rawByHref.get(obj.href)
        if (!raw) continue // object vanished between sync-report and multiget; next sync will reconcile
        upsertObject.run({
          userKey,
          calendarId,
          uid: obj.uid,
          href: obj.href,
          etag: raw.etag,
          ics: raw.ics,
          updatedAt: now,
        })
      }
      for (const uid of result.deletedUids) {
        deleteObject.run(userKey, calendarId, uid)
      }
      setSyncState.run(result.syncToken, now, userKey, calendarId)
    })
    applyAll()
  }

  async getEvents(ctx: DavContext, calendarId: string, range: TimeRange): Promise<CalendarObject[]> {
    await this.ensureFresh(ctx, calendarId)

    const userKey = deriveUserKey(ctx)
    const rows = this.db
      .prepare<[string, string], ObjectRow>(
        'SELECT uid, href, etag, ics FROM objects WHERE user_key = ? AND calendar_id = ?',
      )
      .all(userKey, calendarId)

    const results: CalendarObject[] = []
    for (const row of rows) {
      try {
        results.push(...expandCalendarObject(row.ics, calendarId, row.href, row.etag, range))
      } catch {
        continue
      }
    }
    return results
  }

  async getRawObject(ctx: DavContext, href: string): Promise<RawObject> {
    const userKey = deriveUserKey(ctx)
    const row = this.db
      .prepare<[string, string], { ics: string; etag: string }>(
        'SELECT ics, etag FROM objects WHERE user_key = ? AND href = ?',
      )
      .get(userKey, href)
    if (row) return row
    // Not cached yet (e.g. TTL window hasn't synced this calendar) -- fall
    // back to the live store rather than erroring.
    return this.dav.getRawObject(ctx, href)
  }

  getRawObjects(ctx: DavContext, hrefs: string[]): Promise<RawObjectWithHref[]> {
    // Not itself cached -- only ever called internally (by ensureFresh, via
    // this.dav directly) or as a pass-through if something external calls
    // it on the composed store.
    return this.dav.getRawObjects(ctx, hrefs)
  }

  syncCalendar(ctx: DavContext, calendarId: string, syncToken?: string): Promise<SyncResult> {
    // No route calls this today; pass through untouched rather than adding
    // cache-write logic with no caller to exercise it.
    return this.dav.syncCalendar(ctx, calendarId, syncToken)
  }

  async createObject(ctx: DavContext, calendarId: string, ics: string): Promise<CalendarObject> {
    const created = await this.dav.createObject(ctx, calendarId, ics)
    this.upsertObjectRow(deriveUserKey(ctx), calendarId, created.uid, created.href, created.etag, ics)
    return created
  }

  async updateObject(ctx: DavContext, obj: ObjectRef, ics: string): Promise<CalendarObject> {
    const updated = await this.dav.updateObject(ctx, obj, ics)
    this.upsertObjectRow(deriveUserKey(ctx), obj.calendarId, obj.uid, obj.href, updated.etag, ics)
    return updated
  }

  async deleteObject(ctx: DavContext, obj: ObjectRef): Promise<void> {
    await this.dav.deleteObject(ctx, obj)
    this.db
      .prepare('DELETE FROM objects WHERE user_key = ? AND calendar_id = ? AND uid = ?')
      .run(deriveUserKey(ctx), obj.calendarId, obj.uid)
  }

  async deleteCalendar(ctx: DavContext, calendarId: string): Promise<void> {
    await this.dav.deleteCalendar(ctx, calendarId)
    this.purgeCalendarRows(deriveUserKey(ctx), calendarId)
  }

  async unsubscribeCalendar(ctx: DavContext, calendarId: string): Promise<UnsubscribeResult> {
    const result = await this.dav.unsubscribeCalendar(ctx, calendarId)
    this.purgeCalendarRows(deriveUserKey(ctx), calendarId)
    return result
  }

  private purgeCalendarRows(userKey: string, calendarId: string): void {
    this.db.prepare('DELETE FROM objects WHERE user_key = ? AND calendar_id = ?').run(userKey, calendarId)
    this.db.prepare('DELETE FROM calendars WHERE user_key = ? AND calendar_id = ?').run(userKey, calendarId)
  }

  private upsertObjectRow(
    userKey: string,
    calendarId: string,
    uid: string,
    href: string,
    etag: string,
    ics: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO objects (user_key, calendar_id, uid, href, etag, ics, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_key, calendar_id, uid) DO UPDATE SET
           href = excluded.href, etag = excluded.etag, ics = excluded.ics, updated_at = excluded.updated_at`,
      )
      .run(userKey, calendarId, uid, href, etag, ics, Date.now())
  }
}
