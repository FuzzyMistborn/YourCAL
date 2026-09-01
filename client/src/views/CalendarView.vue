<script setup lang="ts">
import type { CalendarOptions, DatesSetArg, DateSelectArg, EventClickArg, EventDropArg } from '@fullcalendar/core'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import multiMonthPlugin from '@fullcalendar/multimonth'
import FullCalendar from '@fullcalendar/vue3'
import timeGridPlugin from '@fullcalendar/timegrid'
import type { CalendarObject, EditScope, EventFields } from '@yourcal/shared'
import { DateTime } from 'luxon'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CalendarList from '../components/CalendarList.vue'
import ConflictDialog from '../components/ConflictDialog.vue'
import EventDetailPopover from '../components/EventDetailPopover.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import DuplicateScopeDialog from '../components/DuplicateScopeDialog.vue'
import type { DuplicateScope } from '../components/DuplicateScopeDialog.vue'
import EventEditDialog from '../components/EventEditDialog.vue'
import ImportDialog from '../components/ImportDialog.vue'
import MiniMonth from '../components/MiniMonth.vue'
import RecurrenceScopeDialog from '../components/RecurrenceScopeDialog.vue'
import SearchBox from '../components/SearchBox.vue'
import SettingsDialog from '../components/SettingsDialog.vue'
import SubscriptionList from '../components/SubscriptionList.vue'
import UndoToast from '../components/UndoToast.vue'
import { ApiRequestError } from '../api.js'
import { useCalendarsStore } from '../stores/calendars.js'
import { useEventsStore } from '../stores/events.js'
import { useNotificationsStore } from '../stores/notifications.js'
import { useSessionStore } from '../stores/session.js'
import { useSettingsStore } from '../stores/settings.js'
import { useSubscriptionsStore } from '../stores/subscriptions.js'
import { useUndoStore } from '../stores/undo.js'
import { useClipboardStore } from '../stores/clipboard.js'

const session = useSessionStore()
const calendarsStore = useCalendarsStore()
const eventsStore = useEventsStore()
const notificationsStore = useNotificationsStore()
const settingsStore = useSettingsStore()
const subscriptionsStore = useSubscriptionsStore()
const undoStore = useUndoStore()
const clipboardStore = useClipboardStore()

const visibleRange = ref<{ start: string; end: string } | null>(null)
const errorBanner = ref<string | null>(null)

// True while a print is in progress -- reshapes calendarOptions (no
// toolbar, natural height, no event-row clipping) and drives the
// `.layout--printing` / @media print styles.
const printing = ref(false)

// Triggered by the sidebar "Print" button. Flip into print layout, wait
// for FullCalendar to re-render at its natural height, then open the
// dialog; afterprint (below) flips back.
async function printCalendar(): Promise<void> {
  printing.value = true
  await nextTick()
  // A rAF after nextTick gives FullCalendar's own post-option-change
  // reflow a frame to settle before the (synchronous, blocking) print.
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
  measurePrintCellHeight()
  window.print()
}

// Per-week-row cell height for print, sized so the grid fills one landscape
// page without spilling onto a second. A fixed min-height can't do this: a
// 6-row month needs shorter rows than a 4-row one. Recomputed from the real
// row count FullCalendar rendered, just before the print dialog opens.
const printCellHeight = ref('2.6cm')

function measurePrintCellHeight(): void {
  const rows = document.querySelectorAll('.fc .fc-daygrid-body tr').length
  if (!rows) {
    printCellHeight.value = '2.6cm'
    return
  }
  // Usable height of a landscape page after margins, less the month title
  // and weekday-header strip. Conservative so Letter and A4 both fit.
  const perRow = 16.8 / rows
  printCellHeight.value = `${Math.max(1.6, Math.min(3.4, perRow)).toFixed(2)}cm`
}

// Also catch the browser's own Ctrl/Cmd-P: set the flag so the chrome is
// hidden even though there's no chance to reflow first.
function onBeforePrint(): void {
  printing.value = true
  measurePrintCellHeight()
}
function onAfterPrint(): void {
  printing.value = false
}
// Transient positive feedback (e.g. "Event copied"), auto-clears.
const noticeBanner = ref<string | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | undefined
function flashNotice(message: string): void {
  noticeBanner.value = message
  if (noticeTimer !== undefined) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (noticeBanner.value = null), 2000)
}

const enabledCalendarIds = computed(() =>
  calendarsStore.calendars.filter((c) => calendarsStore.enabled[c.id]).map((c) => c.id),
)
// New events can only ever go into a writable, currently-visible calendar --
// used to gate the "New event" button and to seed the create dialog's
// default calendar, so it can't open with an empty or read-only id that
// would only fail once the user actually submits.
const writableEnabledCalendarIds = computed(() =>
  calendarsStore.calendars.filter((c) => calendarsStore.enabled[c.id] && !c.readOnly).map((c) => c.id),
)
// Prefer the user's saved default calendar, but fall back to the first
// writable/enabled one if it's unset, disabled, hidden, or no longer exists.
const preferredDefaultCalendarId = computed(() =>
  writableEnabledCalendarIds.value.includes(settingsStore.defaultCalendarId)
    ? settingsStore.defaultCalendarId
    : (writableEnabledCalendarIds.value[0] ?? ''),
)
const calendarColors = computed(() => {
  const fromCalendars = Object.fromEntries(calendarsStore.calendars.map((c) => [c.id, calendarsStore.colorFor(c.id)]))
  const fromSubscriptions = Object.fromEntries(subscriptionsStore.subscriptions.map((s) => [s.id, s.color]))
  return { ...fromCalendars, ...fromSubscriptions }
})
const subscriptionIds = computed(() => new Set(subscriptionsStore.subscriptions.map((s) => s.id)))

function isSubscriptionEvent(event: CalendarObject): boolean {
  return subscriptionIds.value.has(event.calendarId)
}

const calendarReadOnlyMap = computed(() =>
  Object.fromEntries(calendarsStore.calendars.map((c) => [c.id, c.readOnly])),
)

// Subscriptions are always read-only (they're not real CalDAV collections);
// a real calendar can also be read-only if the server's own ACLs say so
// (Calendar.readOnly, populated via current-user-privilege-set discovery).
function isReadOnlyEvent(event: CalendarObject): boolean {
  return isSubscriptionEvent(event) || (calendarReadOnlyMap.value[event.calendarId] ?? false)
}

const rawVisibleEvents = computed(() => {
  if (!visibleRange.value) return []
  const calendarEvents = eventsStore.eventsFor(enabledCalendarIds.value, visibleRange.value.start, visibleRange.value.end)
  const subscriptionEvents = subscriptionsStore.eventsFor(visibleRange.value.start, visibleRange.value.end)
  return [...calendarEvents, ...subscriptionEvents]
})

watch(rawVisibleEvents, (events) => notificationsStore.scheduleForEvents(events))
// Permission is granted via an explicit user gesture (the "Enable
// notifications" button), typically well after events have already loaded
// -- without this, reminders for whatever's currently visible only start
// working after the next unrelated reload/navigation happens to re-fire
// the watcher above.
watch(
  () => notificationsStore.permission,
  (permission) => {
    if (permission === 'granted') notificationsStore.scheduleForEvents(rawVisibleEvents.value)
  },
)

const fullCalendarEvents = computed(() => {
  return rawVisibleEvents.value.map((e) => ({
    id: `${e.calendarId}:${e.uid}:${e.recurrenceId ?? ''}`,
    title: e.summary,
    // All-day instants are UTC-midnight-anchored calendar dates (see
    // mapper.ts), not real instants in any timezone -- handing FullCalendar
    // the full ISO datetime lets it apply its own (local-zone-by-default)
    // conversion, landing on the previous day in any negative-offset zone.
    // A bare date string sidesteps that entirely.
    start: e.allDay ? e.start.slice(0, 10) : e.start,
    end: e.allDay ? e.end.slice(0, 10) : e.end,
    allDay: e.allDay,
    backgroundColor: e.color ?? calendarColors.value[e.calendarId],
    borderColor: e.color ?? calendarColors.value[e.calendarId],
    editable: !isReadOnlyEvent(e),
    extendedProps: { source: e },
  }))
})

async function loadVisibleRange(): Promise<void> {
  if (!visibleRange.value) return
  try {
    await Promise.all([
      enabledCalendarIds.value.length > 0
        ? eventsStore.loadRange(enabledCalendarIds.value, visibleRange.value.start, visibleRange.value.end)
        : Promise.resolve(),
      subscriptionsStore.loadRange(visibleRange.value.start, visibleRange.value.end),
    ])
  } catch {
    // eventsStore.loadRange already commits whatever calendars *did* load
    // successfully (see its own allSettled handling) -- this is purely to
    // surface that some calendar failed, not to discard the rest.
    errorBanner.value = 'Some calendars failed to load. Showing what loaded successfully.'
  }
}

// The first day of the period the main view is showing (not arg.start,
// which includes leading days from the previous month in a month grid) --
// drives the sidebar mini-month so it follows the main calendar.
const calendarDate = ref<string | null>(null)

function onDatesSet(arg: DatesSetArg): void {
  visibleRange.value = { start: arg.start.toISOString(), end: arg.end.toISOString() }
  calendarDate.value = arg.view.currentStart.toISOString()
  void loadVisibleRange()
}

function onMiniMonthNavigate(date: Date): void {
  fullCalendarRef.value?.getApi().gotoDate(date)
}

// --- create / edit dialog state ---

const editingEvent = ref<CalendarObject | null>(null)
const isCreating = ref(false)
const createSlot = ref<{ start: string; end: string; allDay: boolean } | null>(null)
const detailEvent = ref<CalendarObject | null>(null)
const detailPosition = ref<{ x: number; y: number } | null>(null)
const confirmingDelete = ref<CalendarObject | null>(null)

// --- duplicate / copy-paste ---

// A recurring event awaiting the "this occurrence vs whole series" choice.
const duplicateScopeEvent = ref<CalendarObject | null>(null)
// Seeds the create dialog with a pre-filled copy. `event` is the source
// occurrence; `scope` decides whether the repeat rule is carried over.
const duplicateTemplate = ref<{ event: CalendarObject; scope: DuplicateScope } | null>(null)

// The CalendarObject handed to EventEditDialog as its content template --
// a 'single' duplicate/paste strips all recurrence so it lands as a plain
// one-off event.
const duplicateTemplateObject = computed<CalendarObject | null>(() => {
  const t = duplicateTemplate.value
  if (!t) return null
  return t.scope === 'series'
    ? t.event
    : { ...t.event, rrule: null, rdate: [], isRecurring: false, recurrenceId: null }
})

function requestDuplicate(event: CalendarObject): void {
  if (isReadOnlyEvent(event)) return
  if (event.isRecurring) {
    duplicateScopeEvent.value = event
  } else {
    startDuplicate(event, 'single')
  }
}

function startDuplicate(event: CalendarObject, scope: DuplicateScope): void {
  closeDialogs()
  duplicateTemplate.value = { event, scope }
}

function onDuplicateScopeChosen(scope: DuplicateScope): void {
  const event = duplicateScopeEvent.value
  duplicateScopeEvent.value = null
  if (event) startDuplicate(event, scope)
}

function onDetailDuplicate(): void {
  const event = detailEvent.value
  onDetailClose()
  if (event) requestDuplicate(event)
}

function onEditDuplicate(): void {
  const event = editingEvent.value
  closeDialogs()
  if (event) requestDuplicate(event)
}

function onGlobalKeydown(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey)) return
  const target = e.target as HTMLElement | null
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
  const key = e.key.toLowerCase()
  if (key === 'c' && detailEvent.value) {
    // Mirror the Duplicate action's guard -- a read-only source (shared
    // calendar or subscription) can't be pasted back anywhere, so don't
    // let it into the clipboard in the first place.
    if (isReadOnlyEvent(detailEvent.value)) return
    clipboardStore.copy(detailEvent.value)
    flashNotice('Event copied — press Ctrl/⌘-V to paste a copy')
  } else if (key === 'v' && clipboardStore.copied) {
    e.preventDefault()
    // Paste always lands as a one-off, even from a recurring source (the
    // "whole series" path is only offered via the explicit Duplicate action).
    if (isReadOnlyEvent(clipboardStore.copied)) return
    startDuplicate(clipboardStore.copied, 'single')
  }
}

function calendarNameFor(calendarId: string): string {
  const calendar = calendarsStore.calendars.find((c) => c.id === calendarId)
  if (calendar) return calendar.displayName
  return subscriptionsStore.subscriptions.find((s) => s.id === calendarId)?.name ?? ''
}

// A save/delete on a recurring event is deferred behind this until a scope is chosen.
const pendingScopeAction = ref<
  | { kind: 'save'; event: CalendarObject; calendarId: string; fields: EventFields }
  | { kind: 'delete'; event: CalendarObject }
  | null
>(null)

function onEventClick(arg: EventClickArg): void {
  const rect = arg.el.getBoundingClientRect()
  detailEvent.value = arg.event.extendedProps.source as CalendarObject
  detailPosition.value = arg.jsEvent
    ? { x: arg.jsEvent.clientX, y: arg.jsEvent.clientY }
    : { x: rect.left, y: rect.bottom }
}

function onDetailClose(): void {
  detailEvent.value = null
  detailPosition.value = null
}

function onDetailEdit(): void {
  if (detailEvent.value && !isReadOnlyEvent(detailEvent.value)) {
    editingEvent.value = detailEvent.value
  }
  onDetailClose()
}

function onDetailDelete(): void {
  const event = detailEvent.value
  if (!event || isReadOnlyEvent(event)) return
  onDetailClose()
  confirmingDelete.value = event
}

function onSelect(arg: DateSelectArg): void {
  if (writableEnabledCalendarIds.value.length === 0) {
    errorBanner.value = 'No writable calendar is available -- enable or create one first.'
    return
  }
  createSlot.value = { start: arg.start.toISOString(), end: arg.end.toISOString(), allDay: arg.allDay }
  isCreating.value = true
}

function closeDialogs(): void {
  // The detail popover sits above every dialog overlay; if it's left open
  // (e.g. the Ctrl-V paste path, which doesn't go through onDetailClose)
  // its Edit button can stack a second dialog on top of the new one.
  detailEvent.value = null
  detailPosition.value = null
  editingEvent.value = null
  isCreating.value = false
  createSlot.value = null
  pendingScopeAction.value = null
  confirmingDelete.value = null
  duplicateScopeEvent.value = null
  duplicateTemplate.value = null
}

async function onCreateSave(calendarId: string, fields: EventFields): Promise<void> {
  closeDialogs()
  try {
    await eventsStore.createEvent(calendarId, fields)
    // The reactive `events` option update alone doesn't always make
    // FullCalendar's Vue wrapper repaint the month grid in the same tick --
    // force it explicitly so the new event shows up immediately.
    fullCalendarRef.value?.getApi().refetchEvents()
  } catch (err) {
    errorBanner.value = err instanceof ApiRequestError ? err.message : 'Failed to create event.'
  }
}

function onEditSave(calendarId: string, fields: EventFields): void {
  const event = editingEvent.value
  if (!event) return
  closeDialogs()

  if (event.isRecurring) {
    pendingScopeAction.value = { kind: 'save', event, calendarId, fields }
  } else {
    void doUpdate(event, fields, 'all', calendarId)
  }
}

function onEditDelete(): void {
  const event = editingEvent.value
  if (!event) return
  closeDialogs()
  confirmingDelete.value = event
}

function onConfirmDelete(): void {
  const event = confirmingDelete.value
  confirmingDelete.value = null
  if (!event) return

  if (event.isRecurring) {
    pendingScopeAction.value = { kind: 'delete', event }
  } else {
    void doDelete(event, 'all')
  }
}

// --- 412 conflict resolution: a dialog-driven edit/delete that loses the
// etag race gets a chance to see what changed and either discard or
// reapply against the fresh etag, rather than the edit just vanishing. ---

type PendingConflict =
  | { kind: 'update'; event: CalendarObject; fields: EventFields; scope: EditScope; calendarId: string }
  | { kind: 'delete'; event: CalendarObject; scope: EditScope }
const pendingConflict = ref<PendingConflict | null>(null)
const conflictServerEvent = ref<CalendarObject | null>(null)

async function doUpdate(
  event: CalendarObject,
  fields: EventFields,
  scope: EditScope,
  calendarId: string = event.calendarId,
): Promise<void> {
  try {
    await eventsStore.updateEvent(event.calendarId, event.uid, {
      href: event.href,
      etag: event.etag,
      fields,
      scope,
      recurrenceId: event.recurrenceId,
      calendarId,
    })
    offerEditUndo(event, calendarId, calendarId !== event.calendarId ? 'Moved' : 'Edited')
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 412) {
      await eventsStore.reloadLastRange()
      conflictServerEvent.value = eventsStore.findEvent(event.calendarId, event.uid, event.recurrenceId) ?? null
      pendingConflict.value = { kind: 'update', event, fields, scope, calendarId }
      return
    }
    errorBanner.value = err instanceof ApiRequestError ? err.message : 'Failed to save event.'
  }
}

async function doDelete(event: CalendarObject, scope: EditScope): Promise<void> {
  try {
    await eventsStore.deleteEvent(event.calendarId, event.uid, {
      href: event.href,
      etag: event.etag,
      scope,
      recurrenceId: event.recurrenceId,
    })
    // Undo re-creates the event from the copy still in memory. It comes
    // back with a fresh UID/href (a new CalDAV object) -- fine for a
    // personal calendar, but it won't restore a recurring series'
    // overrides, so only offer it for plain non-recurring events.
    if (!event.isRecurring) {
      undoStore.offer(`Deleted “${event.summary || '(No title)'}”`, async () => {
        await eventsStore.createEvent(event.calendarId, toFields(event, event.start, event.end))
        fullCalendarRef.value?.getApi().refetchEvents()
      })
    }
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 412) {
      await eventsStore.reloadLastRange()
      conflictServerEvent.value = eventsStore.findEvent(event.calendarId, event.uid, event.recurrenceId) ?? null
      pendingConflict.value = { kind: 'delete', event, scope }
      return
    }
    errorBanner.value = err instanceof ApiRequestError ? err.message : 'Failed to delete event.'
  }
}

function onConflictDiscard(): void {
  pendingConflict.value = null
  conflictServerEvent.value = null
}

function onConflictReapply(): void {
  const conflict = pendingConflict.value
  const fresh = conflictServerEvent.value
  pendingConflict.value = null
  conflictServerEvent.value = null
  if (!conflict || !fresh) return

  // Retry against the server's current etag/href -- last-write-wins, not a
  // field-level merge, which is a reasonable v1 scope for a personal
  // calendar app (see the approved plan).
  if (conflict.kind === 'update') {
    void doUpdate(
      { ...conflict.event, etag: fresh.etag, href: fresh.href },
      conflict.fields,
      conflict.scope,
      conflict.calendarId,
    )
  } else {
    void doDelete({ ...conflict.event, etag: fresh.etag, href: fresh.href }, conflict.scope)
  }
}

function onScopeChosen(scope: EditScope): void {
  const action = pendingScopeAction.value
  pendingScopeAction.value = null
  if (!action) return

  if (action.kind === 'save') {
    void doUpdate(action.event, action.fields, scope, action.calendarId)
  } else {
    void doDelete(action.event, scope)
  }
}

// --- drag / resize: FullCalendar renders the move immediately and calls
// revert() if we report failure, giving true optimistic UX for free. ---

// FullCalendar hands back a Date at local midnight for an all-day event.
// Serialising that with toISOString() in a positive-offset timezone rolls
// it back to the previous day (the server takes the UTC date), so emit a
// bare local YYYY-MM-DD instead -- matching how all-day starts are stored.
function dropDateString(d: Date | null, allDay: boolean, fallback: string): string {
  if (!d) return fallback
  return allDay ? (DateTime.fromJSDate(d).toISODate() ?? fallback) : d.toISOString()
}

// A drop moves an event by `delta` (a FullCalendar Duration). Applying that
// delta to the event's *original* start/end keeps its duration intact. This
// matters for all-day events: FullCalendar reports no `end` for a single-day
// all-day event and an exclusive `end` otherwise, so deriving the new end
// from `arg.event` alone collapses multi-day spans (and turns single-day
// ones into a zero-length / previous-day event).
function shiftAllDay(iso: string, delta: EventDropArg['delta']): string {
  const moved = DateTime.fromISO(iso).plus({
    years: delta.years ?? 0,
    months: delta.months ?? 0,
    days: delta.days ?? 0,
    milliseconds: delta.milliseconds ?? 0,
  })
  return moved.toISODate() ?? iso.slice(0, 10)
}

function toFields(event: CalendarObject, start: string, end: string): EventFields {
  return {
    summary: event.summary,
    description: event.description,
    location: event.location,
    start,
    end,
    allDay: event.allDay,
    timezone: event.timezone,
    rrule: event.rrule,
    color: event.color,
    alarms: event.alarms,
    rdate: event.rdate,
  }
}

// Offer a short-lived "Undo" for a just-completed edit/move of a
// non-recurring event. `before` is the pre-edit CalendarObject; undo
// re-applies its original fields against the server's *current* etag
// (looked up from the cache, which reloadLastRange has already refreshed
// by the time this runs). Recurring events are skipped -- reverting them
// correctly needs an edit-scope choice, out of scope for this toast.
function offerEditUndo(before: CalendarObject, newCalendarId: string, verb: string): void {
  if (before.isRecurring) return
  const fresh = eventsStore.findEvent(newCalendarId, before.uid, null)
  if (!fresh) return
  const movedCalendars = newCalendarId !== before.calendarId
  undoStore.offer(`${verb} “${before.summary || '(No title)'}”`, async () => {
    await eventsStore.updateEvent(fresh.calendarId, fresh.uid, {
      href: fresh.href,
      etag: fresh.etag,
      fields: toFields(before, before.start, before.end),
      scope: 'all',
      recurrenceId: null,
      calendarId: movedCalendars ? before.calendarId : undefined,
    })
    fullCalendarRef.value?.getApi().refetchEvents()
  })
}

async function onEventDrop(arg: EventDropArg): Promise<void> {
  const event = arg.event.extendedProps.source as CalendarObject
  if (event.isRecurring) {
    // Dragging a recurring occurrence needs a scope choice; keep it simple
    // for v1 and require using the edit dialog instead.
    arg.revert()
    errorBanner.value = 'Drag-and-drop is not yet supported for recurring events -- use the edit dialog.'
    return
  }
  let start: string
  let end: string
  if (event.allDay) {
    start = shiftAllDay(event.start, arg.delta)
    end = shiftAllDay(event.end, arg.delta)
  } else {
    start = dropDateString(arg.event.start, false, event.start)
    end = dropDateString(arg.event.end ?? arg.event.start, false, event.end)
  }
  try {
    await eventsStore.updateEvent(event.calendarId, event.uid, {
      href: event.href,
      etag: event.etag,
      fields: toFields(event, start, end),
      scope: 'all',
      recurrenceId: null,
    })
    offerEditUndo(event, event.calendarId, 'Moved')
  } catch (err) {
    arg.revert()
    errorBanner.value = err instanceof ApiRequestError ? err.message : 'Failed to move event.'
    await eventsStore.reloadLastRange()
  }
}

async function onEventResize(arg: EventResizeDoneArg): Promise<void> {
  const event = arg.event.extendedProps.source as CalendarObject
  if (event.isRecurring) {
    arg.revert()
    errorBanner.value = 'Resizing is not yet supported for recurring events -- use the edit dialog.'
    return
  }
  const start = dropDateString(arg.event.start, event.allDay, event.start)
  // For an all-day event with no reported end (single-day), the exclusive
  // DTEND is the day after the start, not the start itself.
  const endDate =
    arg.event.end ??
    (event.allDay && arg.event.start
      ? DateTime.fromJSDate(arg.event.start).plus({ days: 1 }).toJSDate()
      : arg.event.start)
  const end = dropDateString(endDate, event.allDay, event.end)
  try {
    await eventsStore.updateEvent(event.calendarId, event.uid, {
      href: event.href,
      etag: event.etag,
      fields: toFields(event, start, end),
      scope: 'all',
      recurrenceId: null,
    })
    offerEditUndo(event, event.calendarId, 'Resized')
  } catch (err) {
    arg.revert()
    errorBanner.value = err instanceof ApiRequestError ? err.message : 'Failed to resize event.'
    await eventsStore.reloadLastRange()
  }
}

const calendarOptions = computed<CalendarOptions>(() => ({
  plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin, multiMonthPlugin],
  initialView: 'dayGridMonth',
  // While printing, drop the toolbar and let the grid grow to its natural
  // height with every event shown (no "+N more" clipping) -- see onBeforePrint.
  headerToolbar: printing.value
    ? false
    : {
        left: 'prev,next today',
        center: 'title',
        right: 'multiMonthYear,dayGridMonth,timeGridWeek,timeGridDay,listMonth',
      },
  buttonText: {
    listMonth: 'Agenda',
    multiMonthYear: 'Year',
  },
  // The agenda view has nothing to show for an empty range -- spell that
  // out rather than leaving a bare gap.
  noEventsText: 'No events in this range',
  height: printing.value ? 'auto' : '100%',
  expandRows: !printing.value,
  dayMaxEventRows: !printing.value,
  firstDay: settingsStore.firstDay,
  editable: true,
  selectable: true,
  events: fullCalendarEvents.value,
  datesSet: onDatesSet,
  eventClick: onEventClick,
  select: onSelect,
  eventDrop: onEventDrop,
  eventResize: onEventResize,
}))

async function onLogout(): Promise<void> {
  await session.logout()
  window.location.href = '/login'
}

function onNewEventClick(): void {
  if (writableEnabledCalendarIds.value.length === 0) {
    errorBanner.value = 'No writable calendar is available -- enable or create one first.'
    return
  }
  const start = new Date()
  start.setMinutes(0, 0, 0)
  start.setHours(start.getHours() + 1)
  const end = new Date(start.getTime() + 60 * 60 * 1000)
  createSlot.value = { start: start.toISOString(), end: end.toISOString(), allDay: false }
  isCreating.value = true
}

const fullCalendarRef = ref<InstanceType<typeof FullCalendar> | null>(null)
const calendarCardRef = ref<HTMLElement | null>(null)

function findDayCellRect(dateIso: string): DOMRect | null {
  const dateStr = DateTime.fromISO(dateIso).toFormat('yyyy-LL-dd')
  // FullCalendar tags each day/column with data-date="yyyy-LL-dd" in every
  // view (dayGrid, timeGrid) -- this exists as soon as the grid itself
  // renders, well before that date's events have necessarily finished
  // loading, so it's a reliable anchor right after gotoDate().
  const cell = calendarCardRef.value?.querySelector<HTMLElement>(`[data-date="${dateStr}"]`)
  return cell?.getBoundingClientRect() ?? null
}

function onSearchSelect(event: CalendarObject): void {
  fullCalendarRef.value?.getApi().gotoDate(event.start)
  // gotoDate() triggers FullCalendar's own internal reflow/scroll, and the
  // popover closes itself on any scroll (so a stale-positioned popover
  // can't linger after the page scrolls elsewhere) -- opening it in the
  // same tick means it would see that reflow and immediately close again.
  // Wait a beat for the navigation to settle first.
  window.setTimeout(() => {
    detailEvent.value = event
    const rect = findDayCellRect(event.start)
    detailPosition.value = rect
      ? { x: rect.left, y: rect.top }
      : { x: Math.max(320, window.innerWidth / 2 - 150), y: 140 }
  }, 50)
}

const showImportDialog = ref(false)
const showSettingsDialog = ref(false)

function onImported(): void {
  // Don't close the dialog here -- ImportDialog just set its own
  // "Imported N of M events" result text in the same tick, and closing
  // immediately hid it before the user could ever see it. The dialog's own
  // Close button (@close) is how the user dismisses it now.
  void eventsStore.reloadLastRange()
}

onMounted(async () => {
  window.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('beforeprint', onBeforePrint)
  window.addEventListener('afterprint', onAfterPrint)
  await calendarsStore.load()
  await loadVisibleRange()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('beforeprint', onBeforePrint)
  window.removeEventListener('afterprint', onAfterPrint)
  if (noticeTimer !== undefined) clearTimeout(noticeTimer)
})

// A calendar created (or toggled on) after the initial load has never had
// its event range fetched -- loadVisibleRange is otherwise only triggered
// by FullCalendar's onDatesSet, and reloadLastRange() (used after
// create/update/delete) replays the stale calendar-id list captured before
// this calendar existed, so it would silently never appear.
watch(enabledCalendarIds, (ids, oldIds) => {
  if (ids.length !== oldIds.length || ids.some((id, i) => id !== oldIds[i])) {
    void loadVisibleRange()
  }
})

// Same problem for subscriptions: SubscriptionList.vue's "Add" just pushes
// into subscriptionsStore's local list -- nothing calls loadRange for the
// new subscription's events until the next date navigation, so a newly
// added (or re-enabled) subscription silently shows no events.
const enabledSubscriptionIds = computed(() =>
  subscriptionsStore.subscriptions.filter((s) => subscriptionsStore.enabled[s.id]).map((s) => s.id),
)
watch(enabledSubscriptionIds, (ids, oldIds) => {
  if (ids.length !== oldIds.length || ids.some((id, i) => id !== oldIds[i])) {
    void loadVisibleRange()
  }
})
</script>

<template>
  <div class="layout" :class="{ 'layout--printing': printing }" :style="{ '--print-cell-h': printCellHeight }">
    <aside class="sidebar">
      <div class="sidebar__brand">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="4.5" width="18" height="16" rx="3" stroke="currentColor" stroke-width="1.6" />
          <path d="M3 9.5h18" stroke="currentColor" stroke-width="1.6" />
          <path d="M8 2.5v4M16 2.5v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
        <span>Calendar</span>
      </div>

      <SearchBox @select="onSearchSelect" />

      <div class="sidebar__actions">
        <button
          class="btn btn-primary sidebar__new"
          :disabled="writableEnabledCalendarIds.length === 0"
          :title="writableEnabledCalendarIds.length === 0 ? 'No writable calendar is available' : undefined"
          @click="onNewEventClick"
        >
          <span aria-hidden="true">+</span> New
        </button>
        <button class="btn btn-secondary sidebar__import" title="Import .ics file" @click="showImportDialog = true">
          Import
        </button>
        <button
          class="btn btn-secondary sidebar__print"
          title="Print the current view"
          @click="printCalendar"
        >
          Print
        </button>
      </div>

      <MiniMonth
        :first-day="settingsStore.firstDay"
        :focus-date="calendarDate"
        @navigate="onMiniMonthNavigate"
      />

      <CalendarList />

      <SubscriptionList />

      <button
        v-if="notificationsStore.permission === 'default'"
        type="button"
        class="btn btn-ghost sidebar__reminders-btn"
        @click="notificationsStore.requestPermission()"
      >
        🔔 Enable reminder notifications
      </button>
      <p v-else-if="notificationsStore.permission === 'granted'" class="sidebar__reminders-note">
        🔔 Reminders on — only while this tab is open
      </p>
      <p v-else-if="notificationsStore.permission === 'denied'" class="sidebar__reminders-note">
        🔕 Reminder notifications blocked (check browser settings)
      </p>

      <div class="sidebar__user">
        <div class="sidebar__username-row">
          <span class="sidebar__avatar">{{ (session.info?.username ?? '?').slice(0, 1).toUpperCase() }}</span>
          <span class="sidebar__username">{{ session.info?.username }}</span>
        </div>
        <div class="sidebar__user-actions">
          <button
            type="button"
            class="btn btn-ghost sidebar__settings-btn"
            title="Settings"
            @click="showSettingsDialog = true"
          >
            <span aria-hidden="true">⚙️</span> Settings
          </button>
          <button class="btn btn-ghost sidebar__signout" @click="onLogout">Sign out</button>
        </div>
      </div>
    </aside>
    <main class="main">
      <Transition name="banner">
        <p v-if="errorBanner" class="error-banner" @click="errorBanner = null">{{ errorBanner }}</p>
      </Transition>
      <Transition name="banner">
        <p v-if="noticeBanner" class="notice-banner">{{ noticeBanner }}</p>
      </Transition>
      <div ref="calendarCardRef" class="calendar-card">
        <FullCalendar ref="fullCalendarRef" :options="calendarOptions" />
      </div>
    </main>

    <EventDetailPopover
      v-if="detailEvent && detailPosition"
      :event="detailEvent"
      :color="calendarColors[detailEvent.calendarId]"
      :calendar-name="calendarNameFor(detailEvent.calendarId)"
      :x="detailPosition.x"
      :y="detailPosition.y"
      :read-only="isReadOnlyEvent(detailEvent)"
      @edit="onDetailEdit"
      @delete="onDetailDelete"
      @duplicate="onDetailDuplicate"
      @close="onDetailClose"
    />

    <ImportDialog
      v-if="showImportDialog"
      :calendars="calendarsStore.calendars"
      :default-calendar-id="preferredDefaultCalendarId"
      @imported="onImported"
      @close="showImportDialog = false"
    />

    <SettingsDialog v-if="showSettingsDialog" @close="showSettingsDialog = false" />

    <EventEditDialog
      v-if="editingEvent"
      :event="editingEvent"
      :calendars="calendarsStore.calendars"
      :default-calendar-id="editingEvent.calendarId"
      @save="onEditSave"
      @remove="onEditDelete"
      @duplicate="onEditDuplicate"
      @close="closeDialogs"
    />

    <EventEditDialog
      v-if="isCreating && createSlot"
      :event="null"
      :calendars="calendarsStore.calendars"
      :default-calendar-id="preferredDefaultCalendarId"
      :initial-start="createSlot.start"
      :initial-end="createSlot.end"
      :initial-all-day="createSlot.allDay"
      @save="onCreateSave"
      @close="closeDialogs"
    />

    <EventEditDialog
      v-if="duplicateTemplate && duplicateTemplateObject"
      :event="null"
      :calendars="calendarsStore.calendars"
      :default-calendar-id="duplicateTemplate.event.calendarId"
      :initial-start="duplicateTemplate.event.start"
      :initial-end="duplicateTemplate.event.end"
      :initial-all-day="duplicateTemplate.event.allDay"
      :template="duplicateTemplateObject"
      @save="onCreateSave"
      @close="closeDialogs"
    />

    <DuplicateScopeDialog
      v-if="duplicateScopeEvent"
      :summary="duplicateScopeEvent.summary"
      @choose="onDuplicateScopeChosen"
      @cancel="duplicateScopeEvent = null"
    />

    <ConfirmDialog
      v-if="confirmingDelete"
      title="Delete event?"
      :message="`Delete “${confirmingDelete.summary || '(No title)'}”? This can't be undone.`"
      @confirm="onConfirmDelete"
      @cancel="confirmingDelete = null"
    />

    <RecurrenceScopeDialog
      v-if="pendingScopeAction"
      :verb="pendingScopeAction.kind === 'save' ? 'Save' : 'Delete'"
      @choose="onScopeChosen"
      @cancel="pendingScopeAction = null"
    />

    <ConflictDialog
      v-if="pendingConflict"
      :kind="pendingConflict.kind"
      :server-event="conflictServerEvent"
      :attempted-summary="pendingConflict.kind === 'update' ? pendingConflict.fields.summary : ''"
      @discard="onConflictDiscard"
      @reapply="onConflictReapply"
    />

    <UndoToast @error="errorBanner = $event" />
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  height: 100vh;
  background: var(--color-bg);
}
.sidebar {
  width: 256px;
  flex-shrink: 0;
  padding: 1.25rem 1rem;
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  overflow-y: auto;
}
.sidebar__actions {
  display: flex;
  gap: 0.5rem;
}
.sidebar__new {
  flex: 1;
  font-size: 0.88rem;
}
.sidebar__import,
.sidebar__print {
  flex-shrink: 0;
  font-size: 0.85rem;
  padding: 0.5rem 0.7rem;
}
.sidebar__brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-primary);
  font-weight: 600;
  font-size: 0.95rem;
  padding: 0 0.25rem;
}
.sidebar__new span {
  font-size: 1.05rem;
  line-height: 1;
}
.sidebar__reminders-btn {
  font-size: 0.78rem;
  color: var(--color-text-faint);
  justify-content: flex-start;
  padding: 0.3rem 0.25rem;
}
.sidebar__reminders-note {
  margin: 0;
  padding: 0 0.25rem;
  font-size: 0.75rem;
  color: var(--color-text-faint);
}
.sidebar__user {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.6rem 0.25rem 0;
  border-top: 1px solid var(--color-border);
  font-size: 0.85rem;
}
.sidebar__username-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  justify-content: flex-start;
  padding: 0.3rem 0.35rem;
}
.sidebar__avatar {
  width: 1.6rem;
  height: 1.6rem;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-weight: 600;
  font-size: 0.75rem;
}
.sidebar__username {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
.sidebar__user-actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.sidebar__settings-btn {
  padding: 0.3rem 0.5rem;
  font-size: 0.78rem;
  flex-shrink: 0;
}
.sidebar__signout {
  padding: 0.3rem 0.5rem;
  font-size: 0.8rem;
  flex-shrink: 0;
  margin-left: auto;
}
.main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
}
.calendar-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  padding: 1rem;
}
.calendar-card :deep(.fc) {
  flex: 1;
  min-height: 0;
}
.error-banner {
  background: var(--color-danger-soft);
  color: var(--color-danger);
  padding: 0.6rem 0.9rem;
  border-radius: var(--radius-sm);
  margin: 0 0 0.85rem;
  cursor: pointer;
  font-size: 0.85rem;
}
.notice-banner {
  background: var(--color-primary-soft);
  color: var(--color-primary);
  padding: 0.6rem 0.9rem;
  border-radius: var(--radius-sm);
  margin: 0 0 0.85rem;
  font-size: 0.85rem;
}
.banner-enter-active,
.banner-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}
.banner-enter-from,
.banner-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>

<style>
/* FullCalendar theme overrides -- unscoped since FullCalendar renders its
   own markup outside Vue's scoping attribute reach. */
.fc {
  --fc-border-color: var(--color-border);
  --fc-today-bg-color: var(--color-primary-soft);
  --fc-neutral-bg-color: var(--color-surface-hover);
  --fc-page-bg-color: var(--color-surface);
  font-family: var(--font-sans);
}
.fc .fc-toolbar-title {
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.fc .fc-button {
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  color: var(--color-text);
  box-shadow: none;
  text-transform: capitalize;
  font-weight: 500;
  padding: 0.35rem 0.7rem;
}
.fc .fc-button:hover {
  background: var(--color-surface-hover);
  color: var(--color-text);
}
.fc .fc-button:focus {
  box-shadow: 0 0 0 3px var(--color-primary-soft);
}
.fc .fc-button-primary:not(:disabled).fc-button-active,
.fc .fc-button-primary:not(:disabled):active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}
.fc .fc-button-primary:disabled {
  opacity: 0.5;
}
.fc .fc-col-header-cell-cushion {
  color: var(--color-text-muted);
  font-weight: 500;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 0.5rem 0;
}
.fc .fc-daygrid-day-number {
  color: var(--color-text-muted);
  font-size: 0.82rem;
  padding: 0.4rem;
}
.fc .fc-day-today .fc-daygrid-day-number {
  color: var(--color-primary);
  font-weight: 600;
}
.fc-event {
  border: none;
  border-radius: 5px;
  padding: 1px 5px;
  font-size: 0.8rem;
  font-weight: 500;
}
.fc-daygrid-event-dot {
  border-color: currentColor;
}
.fc-timegrid-slot-label-cushion {
  color: var(--color-text-faint);
  font-size: 0.75rem;
}

/* --- Print --- unscoped so it also reaches the teleported UndoToast and
   FullCalendar's own markup. `.layout--printing` is toggled just before
   window.print() (and on the browser's own Ctrl/Cmd-P via beforeprint);
   the @media print block is the fallback for anything that slips through. */
@media print {
  .sidebar,
  .error-banner,
  .notice-banner,
  .undo-toast,
  .popover {
    display: none !important;
  }
  .layout {
    display: block !important;
    height: auto !important;
  }
  .main {
    padding: 0 !important;
  }
  .calendar-card {
    border: none !important;
    box-shadow: none !important;
    padding: 0 !important;
  }
  /* Keep calendar/event colors -- and grid borders -- instead of the
     browser's ink-saving wash. Applied broadly because Chrome's ink saver
     was dropping roughly every other week-divider line otherwise. */
  .fc *,
  .fc-event,
  .fc-daygrid-event-dot {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /* FullCalendar draws its grid lines as table borders; pagination + the
     browser's ink saver drop some (whole week dividers, and roughly every
     other column line). Force an explicit 1px border on every edge -- both
     axes -- so the grid always prints complete. */
  .fc-scrollgrid,
  .fc-scrollgrid td,
  .fc-scrollgrid th {
    border-color: var(--color-border) !important;
    border-style: solid !important;
  }
  .fc .fc-scrollgrid {
    border-left: 1px solid var(--color-border) !important;
    border-top: 1px solid var(--color-border) !important;
  }
  .fc .fc-daygrid-body tr,
  .fc .fc-daygrid-day {
    border-bottom: 1px solid var(--color-border) !important;
  }
  .fc .fc-col-header-cell,
  .fc .fc-daygrid-day,
  .fc .fc-scrollgrid-sync-table td {
    border-right: 1px solid var(--color-border) !important;
  }
  /* Fill the sheet: let the grid grow, with each week row tall enough to
     spread down the page. --print-cell-h is sized in JS from the real row
     count so the month still fits on one page (fallback covers Ctrl/Cmd-P
     before the measure runs). */
  .fc,
  .fc .fc-view-harness,
  .fc .fc-daygrid-body,
  .fc-scrollgrid-sync-table {
    height: auto !important;
    width: 100% !important;
  }
  .fc-daygrid-day-frame {
    min-height: var(--print-cell-h, 2.6cm) !important;
  }
  /* A month grid is landscape-shaped; force it so a 7-column week never
     wraps or overflows onto a second page. */
  @page {
    size: landscape;
    margin: 1cm;
  }
  .fc .fc-daygrid-body tr {
    break-inside: avoid;
  }
}

.layout--printing .sidebar,
.layout--printing .error-banner,
.layout--printing .notice-banner {
  display: none;
}
.layout--printing .main {
  padding: 0;
}
.layout--printing .calendar-card {
  border: none;
  box-shadow: none;
  padding: 0;
}
.layout--printing .fc .fc-daygrid-body tr,
.layout--printing .fc .fc-daygrid-day {
  border-bottom: 1px solid var(--color-border);
}
.layout--printing .fc .fc-col-header-cell,
.layout--printing .fc .fc-daygrid-day,
.layout--printing .fc .fc-scrollgrid-sync-table td {
  border-right: 1px solid var(--color-border);
}
.layout--printing .fc .fc-scrollgrid {
  border-left: 1px solid var(--color-border);
  border-top: 1px solid var(--color-border);
}
.layout--printing .fc-daygrid-day-frame {
  min-height: var(--print-cell-h, 2.6cm);
}
</style>
