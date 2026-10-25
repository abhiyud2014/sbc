/**
 * SQLite connection + schema (the app's real database).
 *
 * Uses Node's BUILT-IN `node:sqlite` (SQLite 3.47) — no native npm
 * dependency to compile on deploy. The file lives at `server/sbc.db` by
 * default; override with the DB_PATH env var (e.g. a mounted volume in
 * production). The legacy `server/*.json` files remain as a read-only backup
 * archive after the one-shot import (`npm run db:import`).
 *
 * See er_diagram.md for the full data model.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// node:sqlite announces itself as experimental on stderr — harmless here.
const realWarn = process.emitWarning?.bind(process);
if (realWarn) {
  process.emitWarning = (warning, ...rest) => {
    if (String(warning).includes('SQLite is an experimental feature')) return;
    return realWarn(warning, ...rest);
  };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS students (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL DEFAULT '',
  name          TEXT NOT NULL,
  email         TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  password_hash TEXT                       -- personal override (scrypt); NULL = class password
);
CREATE INDEX IF NOT EXISTS idx_students_name ON students(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS batches (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS student_batches (
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  batch_id   TEXT NOT NULL REFERENCES batches(id)  ON DELETE CASCADE,
  joined_at  TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (student_id, batch_id)
);
CREATE INDEX IF NOT EXISTS idx_student_batches_batch ON student_batches(batch_id);

CREATE TABLE IF NOT EXISTS meeting_targets (
  meeting_id TEXT PRIMARY KEY,             -- Zoom numeric id as TEXT
  topic      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS meeting_target_batches (
  meeting_id TEXT NOT NULL REFERENCES meeting_targets(meeting_id) ON DELETE CASCADE,
  batch_id   TEXT NOT NULL REFERENCES batches(id)                 ON DELETE CASCADE,
  PRIMARY KEY (meeting_id, batch_id)
);
CREATE INDEX IF NOT EXISTS idx_target_batches_batch ON meeting_target_batches(batch_id);

CREATE TABLE IF NOT EXISTS registrations (
  meeting_id    TEXT NOT NULL REFERENCES meeting_targets(meeting_id) ON DELETE CASCADE,
  student_id    TEXT NOT NULL REFERENCES students(id)                ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT '',   -- snapshot at register time
  email         TEXT NOT NULL DEFAULT '',
  join_url      TEXT NOT NULL DEFAULT '',   -- personal Zoom link: sensitive
  registered_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (meeting_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_registrations_student ON registrations(student_id);

CREATE TABLE IF NOT EXISTS questions (
  id           TEXT PRIMARY KEY,
  question     TEXT NOT NULL,
  answer       TEXT NOT NULL DEFAULT '',    -- current wording (mentor-editable)
  ai_answer    TEXT,                        -- original bot answer (NULL until first edit)
  asked_by     TEXT NOT NULL DEFAULT '',
  role         TEXT NOT NULL DEFAULT 'participant',
  student_id   TEXT REFERENCES students(id) ON DELETE SET NULL,
  source       TEXT NOT NULL DEFAULT 'chatbot',  -- chatbot | zoom-qa
  topic        TEXT NOT NULL DEFAULT '',
  meeting_id   TEXT NOT NULL DEFAULT '',
  meeting_uuid TEXT NOT NULL DEFAULT '',
  asked_at     TEXT NOT NULL DEFAULT '',
  edited_by    TEXT,
  edited_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_questions_asked_at ON questions(asked_at DESC);
CREATE INDEX IF NOT EXISTS idx_questions_student  ON questions(student_id);

CREATE TABLE IF NOT EXISTS knowledge (
  id          TEXT PRIMARY KEY,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'knowledge',
  question_id TEXT REFERENCES questions(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_question ON knowledge(lower(question));

CREATE TABLE IF NOT EXISTS chat_conversations (
  key        TEXT PRIMARY KEY,                 -- 'admin' | student id
  student_id TEXT UNIQUE REFERENCES students(id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS chat_messages (
  conversation_key TEXT NOT NULL REFERENCES chat_conversations(key) ON DELETE CASCADE,
  seq              INTEGER NOT NULL,
  sender           TEXT NOT NULL CHECK (sender IN ('user','bot')),
  text             TEXT NOT NULL,
  msg_time         TEXT NOT NULL DEFAULT '',   -- display string, e.g. '5:34 pm'
  created_at       TEXT NOT NULL DEFAULT '',   -- server clock — sortable
  source           TEXT,
  mode             TEXT,
  corrected        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_key, seq)
);

CREATE TABLE IF NOT EXISTS materials (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  bookmarks   INTEGER NOT NULL DEFAULT 0,
  files       TEXT NOT NULL DEFAULT '[]',   -- JSON metadata for uploaded PDFs
  created_at  TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT ''
);

-- PDF bytes are split into chunks so every row stays well below D1's row
-- limit; metadata (name/size/mime) lives in materials.files.
CREATE TABLE IF NOT EXISTS material_file_chunks (
  file_id     TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  data        BLOB NOT NULL,
  PRIMARY KEY (file_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS announcements (
  id         TEXT PRIMARY KEY,
  subject    TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_announcements_created ON announcements(created_at DESC);

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  student_id      TEXT NOT NULL REFERENCES students(id)      ON DELETE CASCADE,
  read_at         TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (announcement_id, student_id)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash   TEXT PRIMARY KEY,        -- sha256(raw token): the raw is never stored
  role         TEXT NOT NULL CHECK (role IN ('admin','participant')),
  student_id   TEXT REFERENCES students(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT '',
  expires_at   TEXT NOT NULL DEFAULT '',
  last_seen_at TEXT,
  revoked_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_student ON auth_sessions(student_id, expires_at);

CREATE TABLE IF NOT EXISTS admins (
  id         TEXT PRIMARY KEY,           -- single row: 'admin'
  name       TEXT NOT NULL DEFAULT '',
  pin_hash   TEXT NOT NULL,              -- scrypt:<salt>:<hash>
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,                -- 'class_password', …
  value TEXT NOT NULL                    -- hashed where sensitive
);
`;

let _db = null;

/** Column/key migrations for databases created before student passwords. */
function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(students)').all();
  if (!cols.some((c) => c.name === 'password_hash')) {
    db.exec('ALTER TABLE students ADD COLUMN password_hash TEXT'); // NULL = use the class password
  }
  // The shared class password used to be called 'student_passcode'.
  db.exec(`
    INSERT OR IGNORE INTO settings (key, value) SELECT 'class_password', value FROM settings WHERE key = 'student_passcode';
    DELETE FROM settings WHERE key = 'student_passcode';
  `);
  // PDF uploads added a `files` metadata column to materials.
  const materialCols = db.prepare('PRAGMA table_info(materials)').all();
  if (!materialCols.some((c) => c.name === 'files')) {
    db.exec("ALTER TABLE materials ADD COLUMN files TEXT NOT NULL DEFAULT '[]'");
  }
}

export function getDb() {
  if (_db) return _db;
  const location = (process.env.DB_PATH || '').trim() || path.join(__dirname, 'sbc.db');
  const db = new DatabaseSync(location);
  db.exec('PRAGMA foreign_keys = ON');
  if (location !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  migrate(db);
  _db = db;
  return db;
}

export function closeDb() {
  try {
    _db?.close();
  } catch {
    /* already closed */
  }
  _db = null;
}

/** Run `fn` inside a transaction; rolls back on any throw. */
export function tx(fn) {
  const db = getDb();
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* connection already unwound */
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Secret hashing (built-in scrypt — no dependencies)                  */
/* ------------------------------------------------------------------ */

export function hashSecret(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain), salt, 32).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifySecret(plain, stored) {
  try {
    const [scheme, salt, hash] = String(stored || '').split(':');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const check = crypto.scryptSync(String(plain), salt, 32).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
  } catch {
    return false;
  }
}

export const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
