import type Database from 'better-sqlite3'

/**
 * `CREATE TABLE IF NOT EXISTS` is a no-op against a pre-existing `calendars`
 * table, so a column added after the table was first created (like
 * `is_shared`) never actually gets applied to a database that predates it --
 * every subsequent insert/upsert referencing that column then fails outright
 * against that database. Runs after the CREATE TABLE below so it only ever
 * needs to backfill columns missing from an older on-disk schema.
 */
function migrateColumns(db: Database.Database): void {
  const calendarColumns = db.prepare("PRAGMA table_info(calendars)").all() as { name: string }[]
  const hasIsShared = calendarColumns.some((c) => c.name === 'is_shared')
  if (!hasIsShared) {
    db.exec('ALTER TABLE calendars ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0')
  }

  const objectColumns = db.prepare("PRAGMA table_info(objects)").all() as { name: string }[]
  const hasStartTs = objectColumns.some((c) => c.name === 'start_ts')
  if (!hasStartTs) {
    // start_ts/end_ts default to NULL on backfill for pre-existing rows,
    // which getEvents treats as "unbounded" (always a candidate) until the
    // next sync recomputes real bounds -- correct, just not yet narrowed.
    db.exec('ALTER TABLE objects ADD COLUMN start_ts INTEGER')
    db.exec('ALTER TABLE objects ADD COLUMN end_ts INTEGER')
  }
}

export function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_key TEXT PRIMARY KEY,
      base_url TEXT NOT NULL,
      username TEXT NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS calendars (
      user_key TEXT NOT NULL REFERENCES users(user_key) ON DELETE CASCADE,
      calendar_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      color TEXT NOT NULL,
      read_only INTEGER NOT NULL,
      supports_events INTEGER NOT NULL,
      supports_tasks INTEGER NOT NULL,
      is_shared INTEGER NOT NULL DEFAULT 0,
      ctag TEXT,
      sync_token TEXT,
      last_synced_at INTEGER,
      PRIMARY KEY (user_key, calendar_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS objects (
      user_key TEXT NOT NULL,
      calendar_id TEXT NOT NULL,
      uid TEXT NOT NULL,
      href TEXT NOT NULL,
      etag TEXT NOT NULL,
      ics TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      -- Coarse occurrence bounds (epoch ms) used to prefilter getEvents'
      -- range query in SQL; end_ts NULL means an open-ended recurrence with
      -- no known upper bound. See ical/bounds.ts.
      start_ts INTEGER,
      end_ts INTEGER,
      PRIMARY KEY (user_key, calendar_id, uid),
      FOREIGN KEY (user_key, calendar_id) REFERENCES calendars(user_key, calendar_id) ON DELETE CASCADE
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_objects_href ON objects(user_key, href);
    CREATE INDEX IF NOT EXISTS idx_objects_range ON objects(user_key, calendar_id, start_ts, end_ts);
  `)

  migrateColumns(db)
}
