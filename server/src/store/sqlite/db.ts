import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { applySchema } from './schema.js'

let instance: Database.Database | null = null

export function openDb(dbPath: string): Database.Database {
  if (instance) return instance

  const fullPath = path.resolve(dbPath)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  const db = new Database(fullPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  applySchema(db)

  instance = db
  return db
}
