/**
 * Repository layer — the only code that talks SQL.
 *
 * Returns the exact shapes the Express routes already consume (camelCase,
 * `batches: [...]` arrays, the `{meetingId: {...}}` target map …) so the
 * route bodies stay untouched. Every write is a transaction; every lookup is
 * an indexed query instead of a whole-file read.
 */
import { getDb, tx, sha256 } from './db.js';

/* ------------------------------ students ------------------------------ */

const studentRowToApi = (row, batchIds = []) => ({
  id: row.id,
  createdAt: row.created_at,
  name: row.name,
  email: row.email,
  batches: batchIds,
  notes: row.notes || '',
  // Boolean only — the hash itself is never exposed over the API.
  hasPersonalPassword: Boolean(row.password_hash),
});

export const students = {
  list() {
    const db = getDb();
    const memberships = new Map();
    for (const r of db.prepare('SELECT student_id, batch_id FROM student_batches').all()) {
      if (!memberships.has(r.student_id)) memberships.set(r.student_id, []);
      memberships.get(r.student_id).push(r.batch_id);
    }
    return db
      .prepare('SELECT * FROM students ORDER BY created_at, id')
      .all()
      .map((row) => studentRowToApi(row, memberships.get(row.id) || []));
  },

  get(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM students WHERE id = ?').get(String(id || ''));
    if (!row) return null;
    const batchIds = db
      .prepare('SELECT batch_id FROM student_batches WHERE student_id = ? ORDER BY joined_at, batch_id')
      .all(row.id)
      .map((r) => r.batch_id);
    return studentRowToApi(row, batchIds);
  },

  /** Lookup by id, or by email when the needle contains '@'. */
  find(idOrEmail) {
    const needle = String(idOrEmail || '');
    const byId = students.get(needle);
    if (byId) return byId;
    if (!needle.includes('@')) return null;
    const row = getDb()
      .prepare('SELECT * FROM students WHERE lower(email) = lower(?) LIMIT 1')
      .get(needle);
    return row ? students.get(row.id) : null;
  },

  inBatches(batchIds = []) {
    if (!batchIds.length) return [];
    const db = getDb();
    const placeholders = batchIds.map(() => '?').join(',');
    const ids = db
      .prepare(`SELECT DISTINCT student_id FROM student_batches WHERE batch_id IN (${placeholders})`)
      .all(...batchIds.map(String))
      .map((r) => r.student_id);
    if (!ids.length) return [];
    const all = new Map(students.list().map((s) => [s.id, s]));
    return ids.map((id) => all.get(id)).filter(Boolean);
  },

  emailTaken(email, exceptId = '') {
    if (!email) return false;
    const row = getDb()
      .prepare('SELECT id FROM students WHERE lower(email) = lower(?) AND id <> ? LIMIT 1')
      .get(String(email), String(exceptId));
    return Boolean(row);
  },

  /** `data` = {id, createdAt, name, email, notes, batches[]}. */
  create(data) {
    tx(() => {
      getDb()
        .prepare('INSERT INTO students (id, created_at, name, email, notes) VALUES (?, ?, ?, ?, ?)')
        .run(data.id, data.createdAt || '', data.name, data.email || '', data.notes || '');
      students._setBatches(data.id, data.batches || []);
    });
    return students.get(data.id);
  },

  update(id, data) {
    tx(() => {
      getDb()
        .prepare('UPDATE students SET name = ?, email = ?, notes = ? WHERE id = ?')
        .run(data.name, data.email || '', data.notes || '', String(id));
      students._setBatches(id, data.batches || []);
    });
    return students.get(id);
  },

  remove(id) {
    return getDb().prepare('DELETE FROM students WHERE id = ?').run(String(id)).changes > 0;
  },

  _setBatches(studentId, batchIds) {
    const db = getDb();
    db.prepare('DELETE FROM student_batches WHERE student_id = ?').run(String(studentId));
    // Only attach batches that still exist — a stale form (batch deleted
    // while open) must not 500 on the FK; the old JSON store accepted any id.
    const known = new Set(db.prepare('SELECT id FROM batches').all().map((r) => r.id));
    const insert = db.prepare(
      'INSERT OR IGNORE INTO student_batches (student_id, batch_id, joined_at) VALUES (?, ?, ?)'
    );
    const now = new Date().toISOString();
    for (const batchId of [...new Set(batchIds.map(String))]) {
      if (!known.has(batchId)) continue;
      insert.run(String(studentId), batchId, now);
    }
  },
};

/* ------------------------------- batches ------------------------------ */

const batchRowToApi = (row, memberCount) => ({
  id: row.id,
  name: row.name,
  description: row.description || '',
  createdAt: row.created_at || '',
  ...(memberCount === undefined ? {} : { memberCount }),
});

export const batches = {
  list() {
    return getDb()
      .prepare('SELECT * FROM batches ORDER BY created_at, id')
      .all()
      .map((row) => batchRowToApi(row));
  },

  listWithCounts() {
    return getDb()
      .prepare(
        `SELECT b.*, (SELECT COUNT(*) FROM student_batches sb WHERE sb.batch_id = b.id) AS member_count
         FROM batches b ORDER BY b.created_at, b.id`
      )
      .all()
      .map((row) => batchRowToApi(row, row.member_count));
  },

  get(id) {
    const row = getDb().prepare('SELECT * FROM batches WHERE id = ?').get(String(id || ''));
    return row ? batchRowToApi(row) : null;
  },

  nameTaken(name, exceptId = '') {
    return Boolean(
      getDb().prepare('SELECT id FROM batches WHERE lower(name) = lower(?) AND id <> ? LIMIT 1').get(String(name), String(exceptId))
    );
  },

  create(data) {
    getDb()
      .prepare('INSERT INTO batches (id, name, description, created_at) VALUES (?, ?, ?, ?)')
      .run(data.id, data.name, data.description || '', data.createdAt || '');
    return batches.get(data.id);
  },

  update(id, data) {
    getDb().prepare('UPDATE batches SET name = ?, description = ? WHERE id = ?').run(data.name, data.description || '', String(id));
    return batches.get(id);
  },

  /** Deleting a batch cascades its junction rows (students + meeting targets). */
  remove(id) {
    return getDb().prepare('DELETE FROM batches WHERE id = ?').run(String(id)).changes > 0;
  },
};

/* -------------------------- meeting targets --------------------------- */
/**
 * The legacy shape everything consumes:
 *   { [meetingId]: { meetingId, batchIds: [], updatedAt, registrations: [] } }
 */

export const targets = {
  /** Full map (registrations included) — replaces targets.json reads. */
  all() {
    const db = getDb();
    const out = {};
    for (const t of db.prepare('SELECT * FROM meeting_targets').all()) {
      out[t.meeting_id] = {
        meetingId: t.meeting_id,
        topic: t.topic || '',
        batchIds: db
          .prepare('SELECT batch_id FROM meeting_target_batches WHERE meeting_id = ? ORDER BY batch_id')
          .all(t.meeting_id)
          .map((r) => r.batch_id),
        updatedAt: t.updated_at || '',
        registrations: db
          .prepare('SELECT * FROM registrations WHERE meeting_id = ? ORDER BY registered_at, student_id')
          .all(t.meeting_id)
          .map((r) => ({ studentId: r.student_id, name: r.name, email: r.email, joinUrl: r.join_url })),
      };
    }
    return out;
  },

  get(meetingId) {
    return targets.all()[String(meetingId)] || null;
  },

  /** Merge new batch ids into the meeting's assignment (enroll flow). */
  assignBatches(meetingId, batchIds) {
    tx(() => {
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO meeting_targets (meeting_id, updated_at) VALUES (?, ?)
         ON CONFLICT(meeting_id) DO UPDATE SET updated_at = excluded.updated_at`
      ).run(String(meetingId), now);
      const insert = db.prepare('INSERT OR IGNORE INTO meeting_target_batches (meeting_id, batch_id) VALUES (?, ?)');
      for (const id of [...new Set(batchIds.map(String))]) insert.run(String(meetingId), id);
    });
    return targets.get(meetingId);
  },

  /** Replace the assignment outright (PUT /meetings/:id/targets). */
  setBatches(meetingId, batchIds) {
    tx(() => {
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO meeting_targets (meeting_id, updated_at) VALUES (?, ?)
         ON CONFLICT(meeting_id) DO UPDATE SET updated_at = excluded.updated_at`
      ).run(String(meetingId), now);
      db.prepare('DELETE FROM meeting_target_batches WHERE meeting_id = ?').run(String(meetingId));
      const insert = db.prepare('INSERT INTO meeting_target_batches (meeting_id, batch_id) VALUES (?, ?)');
      for (const id of [...new Set(batchIds.map(String))]) insert.run(String(meetingId), id);
    });
    return targets.get(meetingId);
  },

  clear(meetingId) {
    // meeting_target_batches + registrations cascade from the target row.
    return getDb().prepare('DELETE FROM meeting_targets WHERE meeting_id = ?').run(String(meetingId)).changes > 0;
  },

  /** Upsert personalised join links after Zoom registration succeeds. */
  saveRegistrations(meetingId, registrations = []) {
    if (!registrations.length) return;
    tx(() => {
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO meeting_targets (meeting_id, updated_at) VALUES (?, ?)
         ON CONFLICT(meeting_id) DO UPDATE SET updated_at = excluded.updated_at`
      ).run(String(meetingId), now);
      const upsert = db.prepare(
        `INSERT INTO registrations (meeting_id, student_id, name, email, join_url, registered_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(meeting_id, student_id) DO UPDATE SET
           name = excluded.name, email = excluded.email, join_url = excluded.join_url, registered_at = excluded.registered_at`
      );
      for (const r of registrations) {
        upsert.run(String(meetingId), String(r.studentId), r.name || '', r.email || '', r.joinUrl || '', now);
      }
    });
  },
};

/* ------------------------------ questions ----------------------------- */

const questionRowToApi = (row) => ({
  id: row.id,
  at: row.asked_at,
  question: row.question,
  answer: row.answer || '',
  ...(row.ai_answer ? { aiAnswer: row.ai_answer } : {}),
  askedBy: row.asked_by || '',
  role: row.role || 'participant',
  ...(row.student_id ? { studentId: row.student_id } : {}),
  source: row.source || 'chatbot',
  topic: row.topic || '',
  ...(row.meeting_id ? { meetingId: row.meeting_id } : {}),
  ...(row.meeting_uuid ? { meetingUuid: row.meeting_uuid } : {}),
  ...(row.edited_by ? { editedBy: row.edited_by } : {}),
  ...(row.edited_at ? { editedAt: row.edited_at } : {}),
});

export const questions = {
  /** Local entries asked since `cutoffMs` (Zoom Q&A stays a live proxy). */
  listSince(cutoffMs) {
    return getDb()
      .prepare('SELECT * FROM questions WHERE asked_at >= ? ORDER BY asked_at DESC')
      .all(new Date(cutoffMs).toISOString())
      .map(questionRowToApi);
  },

  get(id) {
    const row = getDb().prepare('SELECT * FROM questions WHERE id = ?').get(String(id || ''));
    return row ? questionRowToApi(row) : null;
  },

  create(entry) {
    tx(() => {
      getDb()
        .prepare(
          `INSERT INTO questions (id, question, answer, ai_answer, asked_by, role, student_id, source, topic, meeting_id, meeting_uuid, asked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          entry.id,
          entry.question,
          entry.answer || '',
          entry.aiAnswer || null,
          entry.askedBy || '',
          entry.role || 'participant',
          entry.studentId || null,
          entry.source || 'chatbot',
          entry.topic || '',
          entry.meetingId || '',
          entry.meetingUuid || '',
          entry.at || new Date().toISOString()
        );
      // Keep the log bounded — same policy as the old slice(0, 5000).
      getDb()
        .prepare('DELETE FROM questions WHERE id NOT IN (SELECT id FROM questions ORDER BY asked_at DESC, id LIMIT 5000)')
        .run();
    });
    return questions.get(entry.id);
  },

  /** Mentor-edited answers (the bot's override pool) — indexed lookup. */
  editedAnswers() {
    return getDb()
      .prepare("SELECT * FROM questions WHERE edited_at IS NOT NULL AND answer <> '' ORDER BY edited_at DESC")
      .all()
      .map(questionRowToApi);
  },

  /** Mentor edit: keep the original bot answer in ai_answer (first edit only). */
  editAnswer(id, answer, editedBy = 'Admin') {
    const existing = questions.get(id);
    if (!existing) return null;
    getDb()
      .prepare('UPDATE questions SET answer = ?, ai_answer = COALESCE(ai_answer, ?), edited_by = ?, edited_at = ? WHERE id = ?')
      .run(String(answer), existing.answer || '', String(editedBy), new Date().toISOString(), String(id));
    return questions.get(id);
  },
};

/* ------------------------------ knowledge ----------------------------- */

const knowledgeRowToApi = (row) => ({
  id: row.id,
  question: row.question,
  answer: row.answer,
  source: row.source || 'knowledge',
  ...(row.question_id ? { questionId: row.question_id } : {}),
  createdAt: row.created_at || '',
});

export const knowledge = {
  list() {
    return getDb()
      .prepare('SELECT * FROM knowledge ORDER BY created_at DESC, id')
      .all()
      .map(knowledgeRowToApi);
  },

  /** Idempotent by lower(trim(question)) — the unique index enforces it. */
  add(entry) {
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO knowledge (id, question, answer, source, question_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        String(entry.question || '').trim(),
        entry.answer,
        entry.source || 'knowledge',
        entry.questionId || null,
        entry.createdAt || ''
      );
    return knowledge.list();
  },

  /**
   * Upsert the built-in study bank by its stable `kb-*` id. Editing the seed
   * file and rebooting therefore updates answers, while re-running the seed
   * never duplicates rows. If a question was already promoted from the Q&A
   * log under a different id, the unique lower(question) index wins and the
   * seed row is skipped for that boot.
   */
  seed(items = []) {
    if (!Array.isArray(items) || !items.length) return { added: 0, updated: 0 };
    const db = getDb();
    const now = new Date().toISOString();
    const findById = db.prepare('SELECT id FROM knowledge WHERE id = ?');
    const findQuestion = db.prepare(
      'SELECT id FROM knowledge WHERE lower(question) = lower(?) AND id <> ?'
    );
    const insert = db.prepare(
      `INSERT OR IGNORE INTO knowledge (id, question, answer, source, question_id, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`
    );
    const update = db.prepare(
      'UPDATE knowledge SET question = ?, answer = ?, source = ? WHERE id = ?'
    );

    let added = 0;
    let updated = 0;
    tx(() => {
      for (const item of items) {
        const question = String(item.question || '').trim();
        const answer = String(item.answer || '').trim();
        if (!item.id || !question || !answer) continue;
        const source = item.source || 'knowledge';

        if (findById.get(item.id)) {
          if (findQuestion.get(question, item.id)) continue;
          update.run(question, answer, source, item.id);
          updated += 1;
        } else {
          added += insert.run(item.id, question, answer, source, item.createdAt || now).changes;
        }
      }
    });
    return { added, updated };
  },
};

/* -------------------------------- chats ------------------------------- */

const messageRowToApi = (row) => ({
  sender: row.sender,
  text: row.text,
  time: row.msg_time || '',
  ...(row.source ? { source: row.source } : {}),
  ...(row.mode ? { mode: row.mode } : {}),
  ...(row.corrected ? { corrected: true } : {}),
});

export const chats = {
  getMessages(key) {
    return getDb()
      .prepare('SELECT * FROM chat_messages WHERE conversation_key = ? ORDER BY seq')
      .all(String(key))
      .map(messageRowToApi);
  },

  /** Replace the whole conversation (PUT semantics, same as the JSON store). */
  replace(key, messages) {
    tx(() => {
      const db = getDb();
      db.prepare('DELETE FROM chat_messages WHERE conversation_key = ?').run(String(key));
      if (!messages.length) {
        db.prepare('DELETE FROM chat_conversations WHERE key = ?').run(String(key));
        return;
      }
      // 'admin' owns no student row; student keys reference the students table.
      const studentId = String(key) === 'admin' ? null : String(key);
      if (studentId && !db.prepare('SELECT id FROM students WHERE id = ?').get(studentId)) {
        throw Object.assign(new Error('Unknown student for this conversation.'), { status: 403 });
      }
      db.prepare(
        `INSERT INTO chat_conversations (key, student_id, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET updated_at = excluded.updated_at`
      ).run(String(key), studentId, new Date().toISOString());
      const insert = db.prepare(
        `INSERT INTO chat_messages (conversation_key, seq, sender, text, msg_time, created_at, source, mode, corrected)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const now = new Date().toISOString();
      messages.forEach((m, seq) => {
        insert.run(String(key), seq, m.sender, m.text, m.time || '', now, m.source || null, m.mode || null, m.corrected ? 1 : 0);
      });
    });
    return chats.getMessages(key);
  },
};

/* ------------------------------ materials ----------------------------- */

const parseMaterialFiles = (raw) => {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

const materialRowToApi = (row) => ({
  id: row.id,
  title: row.title,
  category: row.category || '',
  type: row.type || '',
  url: row.url || '',
  description: row.description || '',
  bookmarks: row.bookmarks || 0,
  files: parseMaterialFiles(row.files),
});

export const materials = {
  list() {
    // Newest first (the old JSON store unshifted new materials to the front).
    return getDb()
      .prepare('SELECT * FROM materials ORDER BY created_at DESC, id')
      .all()
      .map(materialRowToApi);
  },

  seedIfEmpty(seedList = []) {
    if (getDb().prepare('SELECT COUNT(*) AS n FROM materials').get().n > 0) return;
    // One shared timestamp: ties fall back to id order, preserving seed order.
    const now = new Date().toISOString();
    const insert = getDb().prepare(
      'INSERT INTO materials (id, title, category, type, url, description, bookmarks, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
    );
    for (const m of seedList) insert.run(m.id, m.title, m.category, m.type, m.url, m.description, now);
  },

  get(id) {
    const row = getDb().prepare('SELECT * FROM materials WHERE id = ?').get(String(id || ''));
    return row ? materialRowToApi(row) : null;
  },

  create(data) {
    getDb()
      .prepare(
        'INSERT INTO materials (id, title, category, type, url, description, bookmarks, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(data.id, data.title, data.category, data.type, data.url, data.description, data.bookmarks || 0, new Date().toISOString());
    return materials.get(data.id);
  },

  update(id, data) {
    getDb()
      .prepare('UPDATE materials SET title = ?, category = ?, type = ?, url = ?, description = ?, updated_at = ? WHERE id = ?')
      .run(data.title, data.category, data.type, data.url, data.description, new Date().toISOString(), String(id));
    return materials.get(id);
  },

  /** Replace the uploaded-PDF metadata list for one material. */
  setFiles(id, files = []) {
    getDb()
      .prepare('UPDATE materials SET files = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(files), new Date().toISOString(), String(id));
    return materials.get(id);
  },

  remove(id) {
    return getDb().prepare('DELETE FROM materials WHERE id = ?').run(String(id)).changes > 0;
  },
};

/* --------------------------- material files --------------------------- */
/**
 * Uploaded PDF bytes, stored in fixed-size chunks so no row approaches D1's
 * limits. Metadata (file name, size, mime) lives in `materials.files`; this
 * repository only owns the bytes.
 */
export const materialFiles = {
  putChunks(fileId, chunks = []) {
    const db = getDb();
    const del = db.prepare('DELETE FROM material_file_chunks WHERE file_id = ?');
    const ins = db.prepare(
      'INSERT INTO material_file_chunks (file_id, chunk_index, data) VALUES (?, ?, ?)'
    );
    tx(() => {
      del.run(String(fileId));
      chunks.forEach((chunk, index) => ins.run(String(fileId), index, chunk));
    });
  },

  readChunks(fileId) {
    return getDb()
      .prepare('SELECT data FROM material_file_chunks WHERE file_id = ? ORDER BY chunk_index')
      .all(String(fileId))
      .map((row) => row.data);
  },

  remove(fileId) {
    return (
      getDb()
        .prepare('DELETE FROM material_file_chunks WHERE file_id = ?')
        .run(String(fileId)).changes > 0
    );
  },

  removeMany(fileIds = []) {
    if (!fileIds.length) return 0;
    const del = getDb().prepare('DELETE FROM material_file_chunks WHERE file_id = ?');
    return tx(() => fileIds.reduce((sum, id) => sum + del.run(String(id)).changes, 0));
  },
};

/* ---------------------------- announcements --------------------------- */
const parseRead = (row) =>
  row.read_at === undefined ? {} : { read: Boolean(row.read_at), readAt: row.read_at || null };

const announcementRowToApi = (row) => ({
  id: row.id,
  subject: row.subject || '',
  body: row.body,
  createdBy: row.created_by || '',
  createdAt: row.created_at || '',
  ...parseRead(row),
});

export const announcements = {
  list() {
    return getDb()
      .prepare('SELECT * FROM announcements ORDER BY created_at DESC, id DESC')
      .all()
      .map(announcementRowToApi);
  },

  get(id) {
    const row = getDb().prepare('SELECT * FROM announcements WHERE id = ?').get(String(id || ''));
    return row ? announcementRowToApi(row) : null;
  },

  create(data) {
    getDb()
      .prepare(
        'INSERT INTO announcements (id, subject, body, created_by, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(
        data.id,
        String(data.subject || ''),
        String(data.body || ''),
        String(data.createdBy || ''),
        data.createdAt || new Date().toISOString()
      );
    return announcements.get(data.id);
  },

  /** Every announcement visible to a student, with their read flag. */
  forStudent(studentId, since = '') {
    return getDb()
      .prepare(
        `SELECT a.*, r.read_at
           FROM announcements a
           LEFT JOIN announcement_reads r
             ON r.announcement_id = a.id AND r.student_id = ?
          WHERE (? = '' OR a.created_at >= ?)
          ORDER BY a.created_at DESC, a.id DESC`
      )
      .all(String(studentId), String(since || ''), String(since || ''))
      .map(announcementRowToApi);
  },

  markRead(studentId, ids = []) {
    if (!ids.length) return 0;
    const ins = getDb().prepare(
      'INSERT OR IGNORE INTO announcement_reads (announcement_id, student_id, read_at) VALUES (?, ?, ?)'
    );
    const at = new Date().toISOString();
    return tx(() => ids.reduce((sum, id) => sum + ins.run(String(id), String(studentId), at).changes, 0));
  },

  remove(id) {
    const db = getDb();
    return tx(() => {
      db.prepare('DELETE FROM announcement_reads WHERE announcement_id = ?').run(String(id));
      return db.prepare('DELETE FROM announcements WHERE id = ?').run(String(id)).changes > 0;
    });
  },
};

/* -------------------------------- auth -------------------------------- */
/**
 * Sessions survive restarts (deploy-friendly) and only the sha256 of the
 * bearer token is stored. The admin PIN / class passcode are scrypt hashes —
 * seeded from the env on first boot, then owned by the database.
 */

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export const auth = {
  createSession(token, role, studentId = null) {
    const now = new Date();
    getDb()
      .prepare(
        `INSERT INTO auth_sessions (token_hash, role, student_id, created_at, expires_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(sha256(token), String(role), studentId || null, now.toISOString(), new Date(now.getTime() + SESSION_TTL_MS).toISOString(), now.toISOString());
  },

  /**
   * Create a participant session only when the student has no other live
   * session. Expired/revoked rows are cleared first; a conditional INSERT
   * makes the check + write atomic. Returns false when another device is
   * already signed in (the API turns that into a 409).
   */
  createStudentSession(token, studentId) {
    const db = getDb();
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresIso = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
    const id = String(studentId);
    return tx(() => {
      db.prepare(
        'DELETE FROM auth_sessions WHERE student_id = ? AND (expires_at <= ? OR revoked_at IS NOT NULL)'
      ).run(id, nowIso);
      const inserted = db
        .prepare(
          `INSERT INTO auth_sessions (token_hash, role, student_id, created_at, expires_at, last_seen_at)
           SELECT ?, 'participant', ?, ?, ?, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM auth_sessions
             WHERE student_id = ? AND role = 'participant'
               AND revoked_at IS NULL AND expires_at > ?
           )`
        )
        .run(sha256(token), id, nowIso, expiresIso, nowIso, id, nowIso);
      return inserted.changes > 0;
    });
  },

  /** End every session for one student (e.g. they lost their device). */
  revokeStudentSessions(studentId) {
    return getDb().prepare('DELETE FROM auth_sessions WHERE student_id = ?').run(String(studentId)).changes;
  },

  getSession(token) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM auth_sessions WHERE token_hash = ?').get(sha256(token));
    if (!row) return null;
    if (row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
      db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(row.token_hash);
      return null;
    }
    db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?').run(new Date().toISOString(), row.token_hash);
    return { role: row.role, studentId: row.student_id, createdAt: row.created_at };
  },

  revokeSession(token) {
    return getDb().prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(sha256(token)).changes > 0;
  },

  purgeExpired() {
    getDb().prepare('DELETE FROM auth_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL').run(new Date().toISOString());
  },

  /* Class password + per-student passwords ---------------------------- */
  /**
   * Model (chosen by the admin): students sign in with their registered
   * email + the SHARED class password, which the admin can rotate anytime.
   * A student who changes their password gets a PERSONAL override that
   * outlives class-password rotations; the admin can set/clear it too.
   * Only scrypt hashes are ever stored.
   */

  /** Seed hashed secrets from env on first boot; env wins on change. */
  seedSecretsFromEnv({ adminPin, studentPasscode }) {
    const db = getDb();
    if (adminPin) {
      db.prepare(
        `INSERT INTO admins (id, name, pin_hash, updated_at) VALUES ('admin', '', ?, ?)
         ON CONFLICT(id) DO UPDATE SET pin_hash = excluded.pin_hash, updated_at = excluded.updated_at`
      ).run(auth._hashPin(adminPin), new Date().toISOString());
    }
    if (studentPasscode) {
      // .env STUDENT_PASSCODE seeds the class password (UI can rotate it later).
      db.prepare(
        `INSERT INTO settings (key, value) VALUES ('class_password', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(auth._hashPin(studentPasscode));
    }
  },

  // scrypt is slow BY DESIGN (brute-force resistance) — raise the cost here
  // if you ever want it slower; verifySecret accepts whatever N the hash used.
  _hashPin(pin) {
    return hashWithCost(pin);
  },

  verifyAdminPin(pin) {
    const row = getDb().prepare("SELECT pin_hash FROM admins WHERE id = 'admin'").get();
    if (!row) return false;
    return verifyScrypt(pin, row.pin_hash);
  },

  hasAdminPin() {
    return Boolean(getDb().prepare("SELECT id FROM admins WHERE id = 'admin'").get());
  },

  setClassPassword(password) {
    getDb()
      .prepare(
        `INSERT INTO settings (key, value) VALUES ('class_password', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(hashWithCost(password));
  },

  clearClassPassword() {
    getDb().prepare("DELETE FROM settings WHERE key = 'class_password'").run();
  },

  hasClassPassword() {
    return Boolean(getDb().prepare("SELECT value FROM settings WHERE key = 'class_password'").get());
  },

  verifyClassPassword(password) {
    const row = getDb().prepare("SELECT value FROM settings WHERE key = 'class_password'").get();
    if (!row) return false;
    return verifyScrypt(password, row.value);
  },

  /**
   * Verify a student's sign-in password.
   *   'ok'            → matches (personal hash wins, else the class password)
   *   'bad'           → wrong password
   *   'unprovisioned' → no personal hash AND no class password yet
   */
  checkStudentPassword(studentId, password) {
    const db = getDb();
    const row = db.prepare('SELECT password_hash FROM students WHERE id = ?').get(String(studentId));
    if (!row) return 'bad';
    if (row.password_hash) return verifyScrypt(password, row.password_hash) ? 'ok' : 'bad';
    const cls = db.prepare("SELECT value FROM settings WHERE key = 'class_password'").get();
    if (!cls) return 'unprovisioned';
    return verifyScrypt(password, cls.value) ? 'ok' : 'bad';
  },

  setStudentPassword(studentId, password) {
    const r = getDb()
      .prepare('UPDATE students SET password_hash = ? WHERE id = ?')
      .run(hashWithCost(password), String(studentId));
    if (!r.changes) throw Object.assign(new Error('Student not found.'), { status: 404 });
  },

  clearStudentPassword(studentId) {
    getDb().prepare('UPDATE students SET password_hash = NULL WHERE id = ?').run(String(studentId));
  },

  studentHasPassword(studentId) {
    const row = getDb().prepare('SELECT password_hash FROM students WHERE id = ?').get(String(studentId));
    return Boolean(row?.password_hash);
  },
};

/* Local scrypt helpers (kept out of db.js to avoid a cycle with sha256) */
import crypto from 'node:crypto';

function hashWithCost(plain, cost = 16384) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain), salt, 32, { N: cost }).toString('hex');
  return `scrypt:${cost}:${salt}:${hash}`;
}

function verifyScrypt(plain, stored) {
  try {
    const [scheme, cost, salt, hash] = String(stored || '').split(':');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const n = Number(cost) || 16384;
    const check = crypto.scryptSync(String(plain), salt, 32, { N: n }).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
  } catch {
    return false;
  }
}
