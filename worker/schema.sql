-- Cloudflare D1 schema for SBC-LMS.
-- Apply with:
--   wrangler d1 execute sbc-lms --remote --file=worker/schema.sql
-- (use --local while developing with `wrangler dev`)

CREATE TABLE IF NOT EXISTS students (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL DEFAULT '',
  name          TEXT NOT NULL,
  email         TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  password_hash TEXT
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
  meeting_id TEXT PRIMARY KEY,
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
  name          TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL DEFAULT '',
  join_url      TEXT NOT NULL DEFAULT '',
  registered_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (meeting_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_registrations_student ON registrations(student_id);

CREATE TABLE IF NOT EXISTS questions (
  id           TEXT PRIMARY KEY,
  question     TEXT NOT NULL,
  answer       TEXT NOT NULL DEFAULT '',
  ai_answer    TEXT,
  asked_by     TEXT NOT NULL DEFAULT '',
  role         TEXT NOT NULL DEFAULT 'participant',
  student_id   TEXT REFERENCES students(id) ON DELETE SET NULL,
  source       TEXT NOT NULL DEFAULT 'chatbot',
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
  key        TEXT PRIMARY KEY,
  student_id TEXT UNIQUE REFERENCES students(id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS chat_messages (
  conversation_key TEXT NOT NULL REFERENCES chat_conversations(key) ON DELETE CASCADE,
  seq              INTEGER NOT NULL,
  sender           TEXT NOT NULL CHECK (sender IN ('user','bot')),
  text             TEXT NOT NULL,
  msg_time         TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT '',
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
  created_at  TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash   TEXT PRIMARY KEY,
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
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  pin_hash   TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
