import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { config } from '../config.ts'
import { LANDMARKS } from '../data/landmarks.ts'
import { normalizeArabic } from '../lib/text.ts'

mkdirSync(dirname(config.dbPath), { recursive: true })

export const db = new DatabaseSync(config.dbPath)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS landmarks (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_en TEXT,
    lat  REAL NOT NULL,
    lng  REAL NOT NULL
  );

  -- Normalised spellings (canonical name + colloquial aliases) → landmark.
  CREATE TABLE IF NOT EXISTS landmark_aliases (
    alias       TEXT PRIMARY KEY,
    landmark_id TEXT NOT NULL REFERENCES landmarks(id) ON DELETE CASCADE,
    is_primary  INTEGER NOT NULL DEFAULT 0
  );

  -- Level-2 (Nominatim) results, so repeated lookups are instant and respect the usage policy.
  CREATE TABLE IF NOT EXISTS geocode_cache (
    query      TEXT PRIMARY KEY,
    results    TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id   TEXT UNIQUE,
    pickup_json  TEXT NOT NULL,
    dropoff_json TEXT NOT NULL,
    ride_type    TEXT NOT NULL,
    status       TEXT NOT NULL,
    eta_minutes  INTEGER NOT NULL,
    created_at   TEXT NOT NULL
  );
`)

// Databases created before English names existed: add the column.
const landmarkColumns = db.prepare('PRAGMA table_info(landmarks)').all() as { name: string }[]
if (!landmarkColumns.some((c) => c.name === 'name_en')) db.exec('ALTER TABLE landmarks ADD COLUMN name_en TEXT')

/** Re-seeds the landmark tables from data/landmarks.ts (idempotent). */
function seedLandmarks() {
  db.exec('BEGIN')
  try {
    db.exec('DELETE FROM landmark_aliases; DELETE FROM landmarks;')
    const insertLandmark = db.prepare('INSERT INTO landmarks (id, name, name_en, lat, lng) VALUES (?, ?, ?, ?, ?)')
    const insertAlias = db.prepare(
      'INSERT OR IGNORE INTO landmark_aliases (alias, landmark_id, is_primary) VALUES (?, ?, ?)',
    )
    for (const l of LANDMARKS) {
      insertLandmark.run(l.id, l.name, l.en, l.lat, l.lng)
      insertAlias.run(normalizeArabic(l.name), l.id, 1)
      insertAlias.run(normalizeArabic(l.en), l.id, 1)
      for (const a of l.aliases) insertAlias.run(normalizeArabic(a), l.id, 0)
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

seedLandmarks()
