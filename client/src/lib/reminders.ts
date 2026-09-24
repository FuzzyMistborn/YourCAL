// Shared by EventEditDialog's per-event reminder picker and the settings
// dialog's "Default reminder" select, so both offer the same choices.
export const REMINDER_PRESETS: { label: string; minutes: number }[] = [
  { label: 'At time of event', minutes: 0 },
  { label: '5 minutes before', minutes: 5 },
  { label: '10 minutes before', minutes: 10 },
  { label: '15 minutes before', minutes: 15 },
  { label: '30 minutes before', minutes: 30 },
  { label: '1 hour before', minutes: 60 },
  { label: '1 day before', minutes: 1440 },
]
