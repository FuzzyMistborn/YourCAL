import type Database from 'better-sqlite3'

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
      PRIMARY KEY (user_key, calendar_id, uid),
      FOREIGN KEY (user_key, calendar_id) REFERENCES calendars(user_key, calendar_id) ON DELETE CASCADE
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_objects_href ON objects(user_key, href);
  `)
}
