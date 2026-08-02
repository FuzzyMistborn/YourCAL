export interface TimeRange {
  start: string // ISO 8601
  end: string // ISO 8601
}

export interface CreateCalendarInput {
  displayName: string
  color?: string
}

export interface Calendar {
  id: string
  displayName: string
  color: string
  readOnly: boolean
  supportsEvents: boolean
  supportsTasks: boolean
  ctag: string | null
  // True if this calendar was shared to the current user by someone else,
  // as opposed to one they own. Detected differently per server -- see
  // DavCalendarStore.discoverCalendars.
  isShared: boolean
}

export interface CalendarObject {
  uid: string
  etag: string
  href: string // opaque resource locator; echoed back verbatim on writes, never parsed by the client
  calendarId: string
  summary: string
  description: string | null
  location: string | null
  start: string // ISO 8601
  end: string // ISO 8601
  allDay: boolean
  timezone: string | null
  recurrenceId: string | null // ISO 8601 if this is an override occurrence
  isRecurring: boolean
  rrule: string | null
}

export type EditScope = 'this' | 'thisAndFuture' | 'all'

export interface EventFields {
  summary: string
  description: string | null
  location: string | null
  start: string // ISO 8601
  end: string // ISO 8601
  allDay: boolean
  timezone: string | null
  rrule: string | null
}

export type CreateEventInput = EventFields

export interface UpdateEventInput {
  href: string
  etag: string
  fields: EventFields
  scope: EditScope
  recurrenceId: string | null // required when scope is 'this' or 'thisAndFuture'
}

export interface DeleteEventInput {
  href: string
  etag: string
  scope: EditScope
  recurrenceId: string | null
}

export interface SyncResult {
  syncToken: string
  changed: CalendarObject[]
  deletedUids: string[]
}

export interface SessionInfo {
  serverUrl: string
  username: string
}

export interface LoginRequest {
  serverUrl: string
  username: string
  password: string
}

export interface ApiError {
  error: string
  message: string
}

export type SharePermission = 'read' | 'readwrite'

export interface ShareCalendarInput {
  // Radicale shares match this against the recipient's exact username;
  // Baikal shares match it as a `mailto:` calendar-user-address, which
  // must equal the recipient's actual registered email. The two servers
  // use unrelated identifiers -- the app tries this value against
  // whichever mechanism the server supports.
  recipient: string
  permission: SharePermission
}

export interface ShareCalendarResult {
  mechanism: 'radicale-map' | 'baikal-caldav-sharing'
  // Radicale requires the recipient to separately enable+unhide their own
  // side before the share is usable -- see PendingShare below for how the
  // recipient does that in-app. Baikal auto-accepts immediately.
  // `pending: true` means the owner's half is done but the recipient
  // still needs to accept.
  pending: boolean
}

// A Radicale map share the current user is the recipient of but hasn't yet
// enabled+unhidden their own side of -- see AGENTS.md "Calendar sharing"
// for why this step can't be skipped or automated on the owner's behalf.
// Baikal has no equivalent concept (its shares auto-accept), so this is
// always empty on Baikal.
export interface PendingShare {
  // Opaque; echoed back verbatim to accept this share. Never parsed by the client.
  pathOrToken: string
  owner: string
  // Best-effort label (derived from the shared collection's path) since
  // Radicale's sharing API doesn't expose the owner's display name for it.
  label: string
  // Radicale's TimestampUpdated (unix ms) for this share entry. Lets the
  // client tell "the owner changed something since I last dismissed this"
  // apart from an unsubscribe/hide simply resurfacing unchanged -- see
  // UnsubscribeResult.dismissedPending and PendingSharesList.vue.
  updatedAt: number
}

export interface UnsubscribeResult {
  // Set only when the recipient's own "hide" action was used to leave a
  // Radicale map share (rather than a real DAV delete, which Baikal uses
  // and which needs no client-side bookkeeping). Radicale's sharing model
  // has no separate "declined" state -- a hidden-but-still-owner-enabled
  // share is otherwise indistinguishable from one never accepted, so
  // without this the same share would immediately resurface in the
  // pending list on the next load. The client stores this to suppress
  // that specific share until its `updatedAt` moves past `dismissedAt`
  // (i.e. the owner actually does something new with it).
  dismissedPending: { pathOrToken: string; dismissedAt: number } | null
}
