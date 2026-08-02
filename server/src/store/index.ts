import { config } from '../config.js'
import type { CalendarStore } from './CalendarStore.js'
import { DavCalendarStore } from './DavCalendarStore.js'
import { SqliteCalendarStore } from './SqliteCalendarStore.js'
import { openDb } from './sqlite/db.js'

const dav = new DavCalendarStore()

export const store: CalendarStore = config.cacheEnabled
  ? new SqliteCalendarStore(openDb(config.sqlitePath), dav, config.cacheSyncTtlMs)
  : dav
