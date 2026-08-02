import type {
  Calendar,
  CalendarObject,
  CreateCalendarInput,
  SyncResult,
  TimeRange,
  UnsubscribeResult,
} from '@yourcal/shared'
import type { DavContext } from '../dav/context.js'

export interface ObjectRef {
  calendarId: string
  uid: string
  href: string
  etag: string
}

export interface RawObject {
  ics: string
  etag: string
}

export interface RawObjectWithHref extends RawObject {
  href: string
}

export interface CalendarStore {
  discoverCalendars(ctx: DavContext): Promise<Calendar[]>
  createCalendar(ctx: DavContext, input: CreateCalendarInput): Promise<Calendar>
  getEvents(ctx: DavContext, calendarId: string, range: TimeRange): Promise<CalendarObject[]>
  getRawObject(ctx: DavContext, href: string): Promise<RawObject>
  /**
   * Batched form of getRawObject -- one CalDAV round trip for many hrefs,
   * instead of one per href. Exists for SqliteCalendarStore's sync path,
   * which needs raw ICS for every object syncCalendar() reports as
   * changed (SyncResult.changed only carries already-parsed
   * CalendarObjects, not raw ICS) without doing N logins for N objects.
   */
  getRawObjects(ctx: DavContext, hrefs: string[]): Promise<RawObjectWithHref[]>
  syncCalendar(ctx: DavContext, calendarId: string, syncToken?: string): Promise<SyncResult>
  createObject(ctx: DavContext, calendarId: string, ics: string): Promise<CalendarObject>
  updateObject(ctx: DavContext, obj: ObjectRef, ics: string): Promise<CalendarObject>
  deleteObject(ctx: DavContext, obj: ObjectRef): Promise<void>
  /** Owner-only: deletes the whole calendar collection, which also revokes it for every recipient it was shared with. */
  deleteCalendar(ctx: DavContext, calendarId: string): Promise<void>
  /** Recipient-only: removes a shared calendar from just the current user's own view, leaving the owner's calendar and any other recipients untouched. */
  unsubscribeCalendar(ctx: DavContext, calendarId: string): Promise<UnsubscribeResult>
}
