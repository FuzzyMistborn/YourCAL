<script setup lang="ts">
import type { Calendar, CalendarObject, EventFields } from '@yourcal/shared'
import { DateTime } from 'luxon'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import TimeCombobox from './TimeCombobox.vue'

const props = defineProps<{
  event: CalendarObject | null // null => creating a new event
  calendars: Calendar[]
  defaultCalendarId: string
  initialStart?: string
  initialEnd?: string
  initialAllDay?: boolean
}>()

const emit = defineEmits<{
  save: [calendarId: string, fields: EventFields]
  remove: []
  close: []
}>()

type RepeatOption = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
type RepeatEnd = 'never' | 'count' | 'until'

const FREQ_BY_REPEAT: Record<Exclude<RepeatOption, 'none'>, string> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
  yearly: 'YEARLY',
}
const REPEAT_BY_FREQ: Record<string, RepeatOption> = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
}
const UNIT_LABELS: Record<Exclude<RepeatOption, 'none'>, [string, string]> = {
  daily: ['day', 'days'],
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
  yearly: ['year', 'years'],
}

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const
type WeekdayCode = (typeof WEEKDAY_CODES)[number]
const WEEKDAY_BUTTON_LABELS: Record<WeekdayCode, string> = {
  SU: 'Su',
  MO: 'Mo',
  TU: 'Tu',
  WE: 'We',
  TH: 'Th',
  FR: 'Fr',
  SA: 'Sa',
}
const WEEKDAY_SHORT_NAMES: Record<WeekdayCode, string> = {
  SU: 'Sun',
  MO: 'Mon',
  TU: 'Tue',
  WE: 'Wed',
  TH: 'Thu',
  FR: 'Fri',
  SA: 'Sat',
}
// Luxon's DateTime.weekday is ISO-8601: 1 = Monday ... 7 = Sunday.
const ISO_WEEKDAY_TO_CODE: WeekdayCode[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

const TIME_STEP_MINUTES = 5

function initialDate(iso: string): string {
  return DateTime.fromISO(iso).toFormat('yyyy-LL-dd')
}
function initialTime(iso: string): string {
  const dt = DateTime.fromISO(iso)
  const roundedMinute = Math.round(dt.minute / TIME_STEP_MINUTES) * TIME_STEP_MINUTES
  return dt.set({ minute: 0, second: 0, millisecond: 0 }).plus({ minutes: roundedMinute }).toFormat('HH:mm')
}

interface ParsedRepeat {
  repeat: RepeatOption | 'custom'
  interval: number
  end: RepeatEnd
  count: number
  until: string
  weekdays: WeekdayCode[]
}

function parseIcalUntil(until: string): string | null {
  const dt = until.length > 8 ? DateTime.fromFormat(until, "yyyyLLdd'T'HHmmss'Z'", { zone: 'utc' }) : DateTime.fromFormat(until, 'yyyyLLdd')
  return dt.isValid ? dt.toLocal().toFormat('yyyy-LL-dd') : null
}

// Only recognizes FREQ + optional INTERVAL/COUNT/UNTIL/BYDAY (weekly only,
// plain weekday codes -- not numeric-prefixed ones like "2MO" for "2nd
// Monday", which is a different, unsupported pattern). Anything else falls
// back to 'custom', which the picker shows but can't produce; keep its
// existing rule unless the user explicitly picks a different option.
function parseRepeat(rrule: string | null, fallbackUntil: string, defaultWeekday: WeekdayCode): ParsedRepeat {
  const fallback: ParsedRepeat = {
    repeat: 'none',
    interval: 1,
    end: 'never',
    count: 1,
    until: fallbackUntil,
    weekdays: [defaultWeekday],
  }
  if (!rrule) return fallback

  const parts = Object.fromEntries(
    rrule.split(';').map((part) => {
      const [key, value] = part.split('=')
      return [key, value] as [string, string]
    }),
  )
  const repeat = REPEAT_BY_FREQ[parts.FREQ]
  const allowedKeys = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY'])
  const hasUnsupportedKey = Object.keys(parts).some((k) => !allowedKeys.has(k))
  if (!repeat || hasUnsupportedKey) {
    return { ...fallback, repeat: 'custom' }
  }

  let weekdays: WeekdayCode[] = [defaultWeekday]
  if (parts.BYDAY) {
    if (repeat !== 'weekly') return { ...fallback, repeat: 'custom' }
    const codes = parts.BYDAY.split(',').map((c) => c.trim().toUpperCase())
    if (codes.length === 0 || !codes.every((c) => (WEEKDAY_CODES as readonly string[]).includes(c))) {
      return { ...fallback, repeat: 'custom' }
    }
    weekdays = codes as WeekdayCode[]
  }

  const interval = parts.INTERVAL ? parseInt(parts.INTERVAL, 10) : 1
  if (parts.COUNT) {
    return { repeat, interval, end: 'count', count: parseInt(parts.COUNT, 10), until: fallbackUntil, weekdays }
  }
  if (parts.UNTIL) {
    const until = parseIcalUntil(parts.UNTIL)
    return until ? { repeat, interval, end: 'until', count: 1, until, weekdays } : { ...fallback, repeat: 'custom' }
  }
  return { repeat, interval, end: 'never', count: 1, until: fallbackUntil, weekdays }
}

const initialAllDay = props.event?.allDay ?? props.initialAllDay ?? false
const initialStartIso = props.event?.start ?? props.initialStart ?? new Date().toISOString()
const initialEndIso = props.event?.end ?? props.initialEnd ?? initialStartIso

// All-day events are stored/transmitted with an *exclusive* end (CalDAV's
// DTEND convention: a single-day event has end = start + 1 day) but the
// End field should show the *inclusive* last day, like every calendar UI
// users are used to -- otherwise a plain one-day all-day event defaults to
// showing "tomorrow" in the End field, which reads as a bug.
const initialEndDateDisplay = initialAllDay
  ? DateTime.fromISO(initialEndIso).minus({ days: 1 }).toFormat('yyyy-LL-dd')
  : initialDate(initialEndIso)

const defaultUntil = DateTime.fromISO(initialStartIso).plus({ months: 3 }).toFormat('yyyy-LL-dd')
const defaultWeekday = ISO_WEEKDAY_TO_CODE[DateTime.fromISO(initialStartIso).weekday - 1]
const parsedRepeat = parseRepeat(props.event?.rrule ?? null, defaultUntil, defaultWeekday)

// Intl.supportedValuesOf('timeZone') returns every IANA zone name the
// runtime knows -- no separate timezone-data dependency needed client-side.
const TIMEZONES = Intl.supportedValuesOf('timeZone')
const browserZone = DateTime.local().zoneName

const form = reactive({
  calendarId: props.event?.calendarId ?? props.defaultCalendarId,
  summary: props.event?.summary ?? '',
  description: props.event?.description ?? '',
  location: props.event?.location ?? '',
  allDay: initialAllDay,
  timezone: props.event?.timezone ?? browserZone,
  startDate: initialDate(initialStartIso),
  startTime: initialTime(initialStartIso),
  endDate: initialEndDateDisplay,
  endTime: initialTime(initialEndIso),
  repeat: parsedRepeat.repeat,
  repeatInterval: parsedRepeat.interval,
  repeatEnd: parsedRepeat.end,
  repeatCount: parsedRepeat.count,
  repeatUntil: parsedRepeat.until,
  repeatWeekdays: parsedRepeat.weekdays,
})

function toggleWeekday(code: WeekdayCode): void {
  const idx = form.repeatWeekdays.indexOf(code)
  if (idx >= 0) form.repeatWeekdays.splice(idx, 1)
  else form.repeatWeekdays.push(code)
}

const isEditing = computed(() => props.event !== null)

// Switching off "All day" previously left whatever start/end times happened
// to be there -- for an event that was created as all-day, that's 00:00 for
// both, an instantly-invalid zero-length range once time fields reappear.
// Reset to a sensible default hour block instead.
watch(
  () => form.allDay,
  (allDay, wasAllDay) => {
    if (wasAllDay && !allDay) {
      form.startTime = '00:00'
      form.endTime = '01:00'
    }
  },
)

const intervalUnitLabel = computed(() => {
  if (form.repeat === 'none' || form.repeat === 'custom') return ''
  const [singular, plural] = UNIT_LABELS[form.repeat]
  return form.repeatInterval === 1 ? singular : plural
})

function buildRrule(): string | null {
  if (form.repeat === 'none') return null
  if (form.repeat === 'custom') return props.event?.rrule ?? null

  const parts = [`FREQ=${FREQ_BY_REPEAT[form.repeat]}`]
  if (form.repeatInterval > 1) parts.push(`INTERVAL=${form.repeatInterval}`)
  if (form.repeat === 'weekly' && form.repeatWeekdays.length > 0) {
    parts.push(`BYDAY=${form.repeatWeekdays.join(',')}`)
  }
  if (form.repeatEnd === 'count') {
    parts.push(`COUNT=${form.repeatCount}`)
  } else if (form.repeatEnd === 'until') {
    const until = form.allDay
      ? DateTime.fromFormat(form.repeatUntil, 'yyyy-LL-dd')
      : DateTime.fromFormat(`${form.repeatUntil} 23:59:59`, 'yyyy-LL-dd HH:mm:ss')
    const untilStr = form.allDay ? until.toFormat('yyyyLLdd') : until.toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'")
    parts.push(`UNTIL=${untilStr}`)
  }
  return parts.join(';')
}

const repeatPreview = computed<string | null>(() => {
  if (form.repeat === 'none') return null
  if (form.repeat === 'custom') return 'Custom recurrence rule (unchanged by this dialog).'

  let text = form.repeatInterval > 1 ? `Repeats every ${form.repeatInterval} ${intervalUnitLabel.value}` : `Repeats every ${intervalUnitLabel.value}`
  if (form.repeat === 'weekly' && form.repeatWeekdays.length > 0) {
    const ordered = WEEKDAY_CODES.filter((c) => form.repeatWeekdays.includes(c))
    text += ` on ${ordered.map((c) => WEEKDAY_SHORT_NAMES[c]).join(', ')}`
  }
  if (form.repeatEnd === 'count') {
    text += `, ${form.repeatCount} time${form.repeatCount === 1 ? '' : 's'}`
  } else if (form.repeatEnd === 'until') {
    const until = DateTime.fromFormat(form.repeatUntil, 'yyyy-LL-dd')
    text += until.isValid ? `, until ${until.toFormat('LLL d, yyyy')}` : ''
  }
  return `${text}.`
})

// Compares as plain strings ('yyyy-LL-dd' and 'HH:mm' both sort correctly
// lexicographically) so this doesn't need to touch DateTime at all.
const validationError = computed<string | null>(() => {
  if (form.endDate < form.startDate) {
    return form.allDay ? 'End date must be on or after the start date.' : 'End must be after start.'
  }
  if (!form.allDay && form.endDate === form.startDate && form.endTime <= form.startTime) {
    return 'End must be after start.'
  }
  if (form.repeat !== 'none' && form.repeat !== 'custom') {
    if (form.repeatEnd === 'count' && form.repeatCount < 1) {
      return 'Occurrence count must be at least 1.'
    }
    if (form.repeatEnd === 'until' && form.repeatUntil < form.startDate) {
      return 'Recurrence end date must be on or after the start date.'
    }
    if (form.repeat === 'weekly' && form.repeatWeekdays.length === 0) {
      return 'Select at least one day of the week.'
    }
  }
  return null
})

function onSubmit(): void {
  if (validationError.value) return

  const dtStart = form.allDay
    ? DateTime.fromFormat(form.startDate, 'yyyy-LL-dd')
    : DateTime.fromFormat(`${form.startDate} ${form.startTime}`, 'yyyy-LL-dd HH:mm')
  // Convert the inclusive last-day the user picked back to CalDAV's
  // exclusive end for all-day events.
  const dtEnd = form.allDay
    ? DateTime.fromFormat(form.endDate, 'yyyy-LL-dd').plus({ days: 1 })
    : DateTime.fromFormat(`${form.endDate} ${form.endTime}`, 'yyyy-LL-dd HH:mm')

  const fields: EventFields = {
    summary: form.summary,
    description: form.description || null,
    location: form.location || null,
    start: dtStart.toISO() ?? new Date().toISOString(),
    end: dtEnd.toISO() ?? new Date().toISOString(),
    allDay: form.allDay,
    timezone: form.allDay ? null : form.timezone,
    rrule: buildRrule(),
  }
  emit('save', form.calendarId, fields)
}

const titleInput = ref<HTMLInputElement | null>(null)

onMounted(() => {
  titleInput.value?.focus()
})
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <form class="dialog" @submit.prevent="onSubmit" @keydown.esc="emit('close')">
      <input ref="titleInput" v-model="form.summary" class="dialog__title" type="text" placeholder="Add title" required />

      <label v-if="!isEditing" class="field">
        <span>Calendar</span>
        <select v-model="form.calendarId">
          <option v-for="cal in calendars" :key="cal.id" :value="cal.id">{{ cal.displayName }}</option>
        </select>
      </label>

      <label class="dialog__checkbox">
        <input v-model="form.allDay" type="checkbox" />
        <span>All day</span>
      </label>

      <div class="field-group">
        <span class="field-group__label">Start</span>
        <div class="field-row">
          <input v-model="form.startDate" type="date" required />
          <TimeCombobox v-if="!form.allDay" v-model="form.startTime" />
        </div>
      </div>

      <div class="field-group">
        <span class="field-group__label">End</span>
        <div class="field-row">
          <input v-model="form.endDate" type="date" required />
          <TimeCombobox v-if="!form.allDay" v-model="form.endTime" />
        </div>
      </div>

      <label v-if="!form.allDay" class="field">
        <span>Time zone</span>
        <select v-model="form.timezone">
          <option v-for="tz in TIMEZONES" :key="tz" :value="tz">{{ tz }}</option>
        </select>
      </label>

      <label class="field">
        <span>Repeat</span>
        <select v-model="form.repeat">
          <option value="none">Does not repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
          <option v-if="form.repeat === 'custom'" value="custom" disabled>Custom (unsupported here)</option>
        </select>
      </label>

      <template v-if="form.repeat !== 'none' && form.repeat !== 'custom'">
        <div class="field-group">
          <span class="field-group__label">Every</span>
          <div class="field-row field-row--tight">
            <input v-model.number="form.repeatInterval" type="number" min="1" max="365" class="repeat-interval" />
            <span class="repeat-unit">{{ intervalUnitLabel }}</span>
          </div>
        </div>

        <div v-if="form.repeat === 'weekly'" class="field-group">
          <span class="field-group__label">On</span>
          <div class="weekday-row">
            <button
              v-for="code in WEEKDAY_CODES"
              :key="code"
              type="button"
              class="weekday-btn"
              :class="{ 'weekday-btn--active': form.repeatWeekdays.includes(code) }"
              @click="toggleWeekday(code)"
            >
              {{ WEEKDAY_BUTTON_LABELS[code] }}
            </button>
          </div>
        </div>

        <div class="field-group">
          <span class="field-group__label">Ends</span>
          <label class="repeat-end-option">
            <input v-model="form.repeatEnd" type="radio" value="never" />
            <span>Never</span>
          </label>
          <label class="repeat-end-option">
            <input v-model="form.repeatEnd" type="radio" value="count" />
            <span>After</span>
            <input
              v-model.number="form.repeatCount"
              type="number"
              min="1"
              max="999"
              class="repeat-count"
              :disabled="form.repeatEnd !== 'count'"
            />
            <span>occurrence(s)</span>
          </label>
          <label class="repeat-end-option">
            <input v-model="form.repeatEnd" type="radio" value="until" />
            <span>On</span>
            <input v-model="form.repeatUntil" type="date" :disabled="form.repeatEnd !== 'until'" />
          </label>
        </div>

        <p class="repeat-preview">{{ repeatPreview }}</p>
      </template>
      <p v-else-if="form.repeat === 'custom'" class="repeat-preview">{{ repeatPreview }}</p>

      <label class="field">
        <span>Location</span>
        <input v-model="form.location" type="text" placeholder="Optional" />
      </label>

      <label class="field">
        <span>Description</span>
        <textarea v-model="form.description" rows="3" placeholder="Optional" />
      </label>

      <p v-if="validationError" class="dialog__error">{{ validationError }}</p>

      <div class="dialog__actions">
        <button v-if="isEditing" type="button" class="btn btn-danger dialog__delete" @click="emit('remove')">
          Delete
        </button>
        <button type="button" class="btn btn-ghost" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="!!validationError">Save</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(16, 20, 26, 0.45);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 30;
  animation: fade-in 0.12s ease;
}
.dialog {
  background: var(--color-surface);
  padding: 1.5rem;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: 380px;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  max-height: 90vh;
  overflow-y: auto;
  animation: pop-in 0.14s ease;
}
.dialog__title {
  border: none;
  border-radius: 0;
  border-bottom: 1px solid var(--color-border);
  padding: 0.2rem 0 0.6rem;
  font-size: 1.15rem;
  font-weight: 600;
}
.dialog__title:focus {
  box-shadow: none;
  border-bottom-color: var(--color-primary);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.8rem;
  color: var(--color-text-muted);
  flex: 1;
  min-width: 0;
}
.field-group {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.field-group__label {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
.field-row {
  display: flex;
  gap: 0.5rem;
}
.field-row input[type='date'] {
  flex: 0 0 auto;
  width: 9.5rem;
}
.field-row--tight {
  align-items: center;
}
.repeat-interval {
  flex: 0 0 auto;
  width: 4rem;
}
.repeat-unit {
  font-size: 0.85rem;
  color: var(--color-text);
}
.repeat-end-option {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: var(--color-text);
  cursor: pointer;
  padding: 0.15rem 0;
}
.repeat-end-option input[type='radio'] {
  width: 14px;
  height: 14px;
}
.repeat-end-option input[type='number'] {
  width: 3.5rem;
  padding: 0.3rem 0.4rem;
}
.repeat-end-option input[type='date'] {
  padding: 0.3rem 0.4rem;
}
.repeat-preview {
  margin: -0.2rem 0 0;
  font-size: 0.78rem;
  color: var(--color-text-faint);
  font-style: italic;
}
.weekday-row {
  display: flex;
  gap: 0.35rem;
}
.weekday-btn {
  width: 2.1rem;
  height: 2.1rem;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 0.72rem;
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color 0.12s ease,
    border-color 0.12s ease,
    color 0.12s ease;
}
.weekday-btn:hover {
  border-color: var(--color-primary);
}
.weekday-btn--active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}
.dialog__checkbox {
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--color-text);
  cursor: pointer;
}
.dialog__checkbox input {
  width: 15px;
  height: 15px;
}
input,
select,
textarea {
  padding: 0.5rem 0.6rem;
  font-size: 0.9rem;
}
textarea {
  resize: vertical;
  font-family: inherit;
}
.dialog__actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.35rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--color-border);
}
.dialog__delete {
  margin-right: auto;
}
.dialog__error {
  margin: 0;
  padding: 0.5rem 0.7rem;
  background: var(--color-danger-soft);
  color: var(--color-danger);
  border-radius: var(--radius-sm);
  font-size: 0.82rem;
}
@keyframes fade-in {
  from {
    opacity: 0;
  }
}
@keyframes pop-in {
  from {
    opacity: 0;
    transform: scale(0.97) translateY(4px);
  }
}
</style>
