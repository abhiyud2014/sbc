/**
 * Cloudflare D1 repository layer.
 *
 * Mirrors the return shapes of `server/repos.js`, but every method is async
 * because the D1 binding API is promise-based. `server/app.js` awaits these
 * calls, so the exact same Express routes run locally on node:sqlite and on
 * Workers on D1.
 */
import crypto from 'node:crypto';

const studentRowToApi = (row, batchIds = []) => ({
  id: row.id,
  createdAt: row.created_at,
  name: row.name,
  email: row.email,
  batches: batchIds,
  notes: row.notes || '',
  hasPersonalPassword: Boolean(row.password_hash),
});

const batchRowToApi = (row, memberCount) => ({
  id: row.id,
  name: row.name,
  description: row.description || '',
  createdAt: row.created_at || '',
  ...(memberCount === undefined ? {} : { memberCount }),
});

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

const knowledgeRowToApi = (row) => ({
  id: row.id,
  question: row.question,
  answer: row.answer,
  source: row.source || 'knowledge',
  ...(row.question_id ? { questionId: row.question_id } : {}),
  createdAt: row.created_at || '',
});

const messageRowToApi = (row) => ({
  sender: row.sender,
  text: row.text,
  time: row.msg_time || '',
  ...(row.source ? { source: row.source } : {}),
  ...(row.mode ? { mode: row.mode } : {}),
  ...(row.corrected ? { corrected: true } : {}),
});

const materialRowToApi = (row) => ({
  id: row.id,
  title: row.title,
  category: row.category || '',
  type: row.type || '',
  url: row.url || '',
  description: row.description || '',
  bookmarks: row.bookmarks || 0,
});

function hashWithCost(plain, cost = 16384) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain), salt, 32, { N: cost }).toString('hex');
  return `scrypt:${cost}:${salt}:${hash}`;
}

function verifyScrypt(plain, stored) {
  try {
    const parts = String(stored || '').split(':');
    if (parts[0] !== 'scrypt') return false;
    let cost = 16384;
    let salt;
    let hash;
    if (parts.length === 4) {
      cost = Number(parts[1]) || 16384;
      salt = parts[2];
      hash = parts[3];
    } else if (parts.length === 3) {
      salt = parts[1];
      hash = parts[2];
    } else {
      return false;
    }
    if (!salt || !hash) return false;
    const check = crypto.scryptSync(String(plain), salt, 32, { N: cost }).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
  } catch {
    return false;
  }
}

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

export function createD1Repos(db) {
  const stmt = (sql, ...params) =>
    params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);

  const all = async (sql, ...params) => {
    const result = await stmt(sql, ...params).all();
    return result?.results || [];
  };

  const first = async (sql, ...params) => (await stmt(sql, ...params).first()) ?? null;

  const run = async (sql, ...params) => {
    const result = await stmt(sql, ...params).run();
    return Number(result?.meta?.changes ?? result?.changes ?? 0);
  };

  // D1 `batch()` is atomic. Keep chunks modest so large seeds stay well
  // inside the platform's per-batch statement limit.
  const batch = async (statements, chunkSize = 50) => {
    if (!statements.length) return [];
    const out = [];
    for (let i = 0; i < statements.length; i += chunkSize) {
      out.push(...(await db.batch(statements.slice(i, i + chunkSize))));
    }
    return out;
  };

  /* ------------------------------ students ------------------------------ */

  const students = {
    async list() {
      const [memberships, rows] = await Promise.all([
        all('SELECT student_id, batch_id FROM student_batches'),
        all('SELECT * FROM students ORDER BY created_at, id'),
      ]);
      const byStudent = new Map();
      for (const r of memberships) {
        if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, []);
        byStudent.get(r.student_id).push(r.batch_id);
      }
      return rows.map((row) => studentRowToApi(row, byStudent.get(row.id) || []));
    },

    async get(id) {
      const row = await first('SELECT * FROM students WHERE id = ?', String(id || ''));
      if (!row) return null;
      const batchIds = (
        await all(
          'SELECT batch_id FROM student_batches WHERE student_id = ? ORDER BY joined_at, batch_id',
          row.id
        )
      ).map((r) => r.batch_id);
      return studentRowToApi(row, batchIds);
    },

    async find(idOrEmail) {
      const needle = String(idOrEmail || '');
      const byId = await students.get(needle);
      if (byId) return byId;
      if (!needle.includes('@')) return null;
      const row = await first('SELECT id FROM students WHERE lower(email) = lower(?) LIMIT 1', needle);
      return row ? students.get(row.id) : null;
    },

    async inBatches(batchIds = []) {
      if (!batchIds.length) return [];
      const placeholders = batchIds.map(() => '?').join(',');
      const ids = (
        await all(
          `SELECT DISTINCT student_id FROM student_batches WHERE batch_id IN (${placeholders})`,
          ...batchIds.map(String)
        )
      ).map((r) => r.student_id);
      if (!ids.length) return [];
      const everyone = new Map((await students.list()).map((s) => [s.id, s]));
      return ids.map((id) => everyone.get(id)).filter(Boolean);
    },

    async emailTaken(email, exceptId = '') {
      if (!email) return false;
      const row = await first(
        'SELECT id FROM students WHERE lower(email) = lower(?) AND id <> ? LIMIT 1',
        String(email),
        String(exceptId)
      );
      return Boolean(row);
    },

    async create(data) {
      const known = new Set((await all('SELECT id FROM batches')).map((r) => r.id));
      const now = new Date().toISOString();
      const statements = [
        stmt(
          'INSERT INTO students (id, created_at, name, email, notes) VALUES (?, ?, ?, ?, ?)',
          data.id,
          data.createdAt || '',
          data.name,
          data.email || '',
          data.notes || ''
        ),
      ];
      for (const batchId of [...new Set((data.batches || []).map(String))]) {
        if (!known.has(batchId)) continue;
        statements.push(
          stmt(
            'INSERT OR IGNORE INTO student_batches (student_id, batch_id, joined_at) VALUES (?, ?, ?)',
            data.id,
            batchId,
            now
          )
        );
      }
      await batch(statements);
      return students.get(data.id);
    },

    async update(id, data) {
      const known = new Set((await all('SELECT id FROM batches')).map((r) => r.id));
      const now = new Date().toISOString();
      const statements = [
        stmt(
          'UPDATE students SET name = ?, email = ?, notes = ? WHERE id = ?',
          data.name,
          data.email || '',
          data.notes || '',
          String(id)
        ),
        stmt('DELETE FROM student_batches WHERE student_id = ?', String(id)),
      ];
      for (const batchId of [...new Set((data.batches || []).map(String))]) {
        if (!known.has(batchId)) continue;
        statements.push(
          stmt(
            'INSERT OR IGNORE INTO student_batches (student_id, batch_id, joined_at) VALUES (?, ?, ?)',
            String(id),
            batchId,
            now
          )
        );
      }
      await batch(statements);
      return students.get(id);
    },

    async remove(id) {
      return (await run('DELETE FROM students WHERE id = ?', String(id))) > 0;
    },

    async _setBatches(studentId, batchIds) {
      const known = new Set((await all('SELECT id FROM batches')).map((r) => r.id));
      const now = new Date().toISOString();
      const statements = [stmt('DELETE FROM student_batches WHERE student_id = ?', String(studentId))];
      for (const batchId of [...new Set((batchIds || []).map(String))]) {
        if (!known.has(batchId)) continue;
        statements.push(
          stmt(
            'INSERT OR IGNORE INTO student_batches (student_id, batch_id, joined_at) VALUES (?, ?, ?)',
            String(studentId),
            batchId,
            now
          )
        );
      }
      await batch(statements);
    },
  };

  /* ------------------------------- batches ------------------------------ */

  const batches = {
    async list() {
      return (await all('SELECT * FROM batches ORDER BY created_at, id')).map((row) => batchRowToApi(row));
    },

    async listWithCounts() {
      const rows = await all(
        `SELECT b.*, (SELECT COUNT(*) FROM student_batches sb WHERE sb.batch_id = b.id) AS member_count
         FROM batches b ORDER BY b.created_at, b.id`
      );
      return rows.map((row) => batchRowToApi(row, row.member_count));
    },

    async get(id) {
      const row = await first('SELECT * FROM batches WHERE id = ?', String(id || ''));
      return row ? batchRowToApi(row) : null;
    },

    async nameTaken(name, exceptId = '') {
      const row = await first(
        'SELECT id FROM batches WHERE lower(name) = lower(?) AND id <> ? LIMIT 1',
        String(name),
        String(exceptId)
      );
      return Boolean(row);
    },

    async create(data) {
      await run(
        'INSERT INTO batches (id, name, description, created_at) VALUES (?, ?, ?, ?)',
        data.id,
        data.name,
        data.description || '',
        data.createdAt || ''
      );
      return batches.get(data.id);
    },

    async update(id, data) {
      await run(
        'UPDATE batches SET name = ?, description = ? WHERE id = ?',
        data.name,
        data.description || '',
        String(id)
      );
      return batches.get(id);
    },

    async remove(id) {
      return (await run('DELETE FROM batches WHERE id = ?', String(id))) > 0;
    },
  };

  /* -------------------------- meeting targets --------------------------- */

  const targetRowToApi = (target, batchIds, registrations) => ({
    meetingId: target.meeting_id,
    topic: target.topic || '',
    batchIds,
    updatedAt: target.updated_at || '',
    registrations,
  });

  const registrationsToApi = (rows) =>
    rows.map((r) => ({ studentId: r.student_id, name: r.name, email: r.email, joinUrl: r.join_url }));

  const targets = {
    async all() {
      const [targetRows, batchRows, registrationRows] = await Promise.all([
        all('SELECT * FROM meeting_targets'),
        all('SELECT meeting_id, batch_id FROM meeting_target_batches ORDER BY batch_id'),
        all('SELECT * FROM registrations ORDER BY registered_at, student_id'),
      ]);
      const batchesByMeeting = new Map();
      for (const r of batchRows) {
        if (!batchesByMeeting.has(r.meeting_id)) batchesByMeeting.set(r.meeting_id, []);
        batchesByMeeting.get(r.meeting_id).push(r.batch_id);
      }
      const regsByMeeting = new Map();
      for (const r of registrationRows) {
        if (!regsByMeeting.has(r.meeting_id)) regsByMeeting.set(r.meeting_id, []);
        regsByMeeting.get(r.meeting_id).push(r);
      }
      const out = {};
      for (const t of targetRows) {
        out[t.meeting_id] = targetRowToApi(
          t,
          batchesByMeeting.get(t.meeting_id) || [],
          registrationsToApi(regsByMeeting.get(t.meeting_id) || [])
        );
      }
      return out;
    },

    async get(meetingId) {
      const id = String(meetingId);
      const row = await first('SELECT * FROM meeting_targets WHERE meeting_id = ?', id);
      if (!row) return null;
      const [batchRows, registrationRows] = await Promise.all([
        all('SELECT batch_id FROM meeting_target_batches WHERE meeting_id = ? ORDER BY batch_id', id),
        all('SELECT * FROM registrations WHERE meeting_id = ? ORDER BY registered_at, student_id', id),
      ]);
      return targetRowToApi(
        row,
        batchRows.map((r) => r.batch_id),
        registrationsToApi(registrationRows)
      );
    },

    async assignBatches(meetingId, batchIds) {
      const id = String(meetingId);
      const now = new Date().toISOString();
      const statements = [
        stmt(
          `INSERT INTO meeting_targets (meeting_id, updated_at) VALUES (?, ?)
           ON CONFLICT(meeting_id) DO UPDATE SET updated_at = excluded.updated_at`,
          id,
          now
        ),
      ];
      for (const batchId of [...new Set((batchIds || []).map(String))]) {
        statements.push(
          stmt(
            'INSERT OR IGNORE INTO meeting_target_batches (meeting_id, batch_id) VALUES (?, ?)',
            id,
            batchId
          )
        );
      }
      await batch(statements);
      return targets.get(id);
    },

    async setBatches(meetingId, batchIds) {
      const id = String(meetingId);
      const now = new Date().toISOString();
      const statements = [
        stmt(
          `INSERT INTO meeting_targets (meeting_id, updated_at) VALUES (?, ?)
           ON CONFLICT(meeting_id) DO UPDATE SET updated_at = excluded.updated_at`,
          id,
          now
        ),
        stmt('DELETE FROM meeting_target_batches WHERE meeting_id = ?', id),
      ];
      for (const batchId of [...new Set((batchIds || []).map(String))]) {
        statements.push(
          stmt(
            'INSERT OR IGNORE INTO meeting_target_batches (meeting_id, batch_id) VALUES (?, ?)',
            id,
            batchId
          )
        );
      }
      await batch(statements);
      return targets.get(id);
    },

    async clear(meetingId) {
      return (await run('DELETE FROM meeting_targets WHERE meeting_id = ?', String(meetingId))) > 0;
    },

    async saveRegistrations(meetingId, registrations = []) {
      if (!registrations.length) return;
      const id = String(meetingId);
      const now = new Date().toISOString();
      const statements = [
        stmt(
          `INSERT INTO meeting_targets (meeting_id, updated_at) VALUES (?, ?)
           ON CONFLICT(meeting_id) DO UPDATE SET updated_at = excluded.updated_at`,
          id,
          now
        ),
      ];
      for (const r of registrations) {
        statements.push(
          stmt(
            `INSERT INTO registrations (meeting_id, student_id, name, email, join_url, registered_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(meeting_id, student_id) DO UPDATE SET
               name = excluded.name, email = excluded.email, join_url = excluded.join_url, registered_at = excluded.registered_at`,
            id,
            String(r.studentId),
            r.name || '',
            r.email || '',
            r.joinUrl || '',
            now
          )
        );
      }
      await batch(statements);
    },
  };

  /* ------------------------------ questions ----------------------------- */

  const questions = {
    async listSince(cutoffMs) {
      return (
        await all(
          'SELECT * FROM questions WHERE asked_at >= ? ORDER BY asked_at DESC',
          new Date(cutoffMs).toISOString()
        )
      ).map(questionRowToApi);
    },

    async get(id) {
      const row = await first('SELECT * FROM questions WHERE id = ?', String(id || ''));
      return row ? questionRowToApi(row) : null;
    },

    async create(entry) {
      await batch([
        stmt(
          `INSERT INTO questions (id, question, answer, ai_answer, asked_by, role, student_id, source, topic, meeting_id, meeting_uuid, asked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        ),
        stmt(
          'DELETE FROM questions WHERE id NOT IN (SELECT id FROM questions ORDER BY asked_at DESC, id LIMIT 5000)'
        ),
      ]);
      return questions.get(entry.id);
    },

    async editedAnswers() {
      return (
        await all(
          "SELECT * FROM questions WHERE edited_at IS NOT NULL AND answer <> '' ORDER BY edited_at DESC"
        )
      ).map(questionRowToApi);
    },

    async editAnswer(id, answer, editedBy = 'Admin') {
      const existing = await questions.get(id);
      if (!existing) return null;
      await run(
        'UPDATE questions SET answer = ?, ai_answer = COALESCE(ai_answer, ?), edited_by = ?, edited_at = ? WHERE id = ?',
        String(answer),
        existing.answer || '',
        String(editedBy),
        new Date().toISOString(),
        String(id)
      );
      return questions.get(id);
    },
  };

  /* ------------------------------ knowledge ----------------------------- */

  const knowledge = {
    async list() {
      return (await all('SELECT * FROM knowledge ORDER BY created_at DESC, id')).map(knowledgeRowToApi);
    },

    async add(entry) {
      await run(
        `INSERT OR IGNORE INTO knowledge (id, question, answer, source, question_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        entry.id,
        String(entry.question || '').trim(),
        entry.answer,
        entry.source || 'knowledge',
        entry.questionId || null,
        entry.createdAt || ''
      );
      return knowledge.list();
    },

    async seed(items = []) {
      if (!Array.isArray(items) || !items.length) return { added: 0, updated: 0 };
      const existing = await all('SELECT id, question FROM knowledge');
      const byId = new Map(existing.map((r) => [r.id, r]));
      const byQuestion = new Map(existing.map((r) => [String(r.question || '').toLowerCase(), r.id]));
      const now = new Date().toISOString();
      const statements = [];
      let added = 0;
      let updated = 0;

      for (const item of items) {
        const question = String(item.question || '').trim();
        const answer = String(item.answer || '').trim();
        if (!item.id || !question || !answer) continue;
        const source = item.source || 'knowledge';
        const key = question.toLowerCase();
        const foundId = byId.get(item.id);

        if (foundId) {
          const conflictingId = byQuestion.get(key);
          if (conflictingId && conflictingId !== item.id) continue;
          statements.push(
            stmt('UPDATE knowledge SET question = ?, answer = ?, source = ? WHERE id = ?', question, answer, source, item.id)
          );
          byQuestion.set(key, item.id);
          updated += 1;
          continue;
        }

        if (byQuestion.has(key)) continue;
        statements.push(
          stmt(
            `INSERT OR IGNORE INTO knowledge (id, question, answer, source, question_id, created_at)
             VALUES (?, ?, ?, ?, NULL, ?)`,
            item.id,
            question,
            answer,
            source,
            item.createdAt || now
          )
        );
        byId.set(item.id, { id: item.id, question });
        byQuestion.set(key, item.id);
        added += 1;
      }

      await batch(statements);
      return { added, updated };
    },
  };

  /* -------------------------------- chats ------------------------------- */

  const chats = {
    async getMessages(key) {
      return (
        await all('SELECT * FROM chat_messages WHERE conversation_key = ? ORDER BY seq', String(key))
      ).map(messageRowToApi);
    },

    async replace(key, messages) {
      const conversationKey = String(key);
      const studentId = conversationKey === 'admin' ? null : conversationKey;

      if (messages.length) {
        if (studentId) {
          const student = await first('SELECT id FROM students WHERE id = ?', studentId);
          if (!student) {
            throw Object.assign(new Error('Unknown student for this conversation.'), { status: 403 });
          }
        }
        const now = new Date().toISOString();
        const statements = [
          stmt(
            `INSERT INTO chat_conversations (key, student_id, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET updated_at = excluded.updated_at`,
            conversationKey,
            studentId,
            now
          ),
          stmt('DELETE FROM chat_messages WHERE conversation_key = ?', conversationKey),
        ];
        messages.forEach((m, seq) => {
          statements.push(
            stmt(
              `INSERT INTO chat_messages (conversation_key, seq, sender, text, msg_time, created_at, source, mode, corrected)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              conversationKey,
              seq,
              m.sender,
              m.text,
              m.time || '',
              now,
              m.source || null,
              m.mode || null,
              m.corrected ? 1 : 0
            )
          );
        });
        await batch(statements);
      } else {
        await batch([
          stmt('DELETE FROM chat_messages WHERE conversation_key = ?', conversationKey),
          stmt('DELETE FROM chat_conversations WHERE key = ?', conversationKey),
        ]);
      }

      return chats.getMessages(conversationKey);
    },
  };

  /* ------------------------------ materials ----------------------------- */

  const materials = {
    async list() {
      return (await all('SELECT * FROM materials ORDER BY created_at DESC, id')).map(materialRowToApi);
    },

    async seedIfEmpty(seedList = []) {
      const count = Number((await first('SELECT COUNT(*) AS n FROM materials'))?.n || 0);
      if (count > 0) return;
      const now = new Date().toISOString();
      const statements = seedList.map((m) =>
        stmt(
          'INSERT INTO materials (id, title, category, type, url, description, bookmarks, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
          m.id,
          m.title,
          m.category,
          m.type,
          m.url,
          m.description,
          now
        )
      );
      await batch(statements);
    },

    async get(id) {
      const row = await first('SELECT * FROM materials WHERE id = ?', String(id || ''));
      return row ? materialRowToApi(row) : null;
    },

    async create(data) {
      await run(
        'INSERT INTO materials (id, title, category, type, url, description, bookmarks, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        data.id,
        data.title,
        data.category,
        data.type,
        data.url,
        data.description,
        data.bookmarks || 0,
        new Date().toISOString()
      );
      return materials.get(data.id);
    },

    async update(id, data) {
      await run(
        'UPDATE materials SET title = ?, category = ?, type = ?, url = ?, description = ?, updated_at = ? WHERE id = ?',
        data.title,
        data.category,
        data.type,
        data.url,
        data.description,
        new Date().toISOString(),
        String(id)
      );
      return materials.get(id);
    },

    async remove(id) {
      return (await run('DELETE FROM materials WHERE id = ?', String(id))) > 0;
    },
  };

  /* -------------------------------- auth -------------------------------- */

  const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

  const auth = {
    async createSession(token, role, studentId = null) {
      const now = new Date();
      await run(
        `INSERT INTO auth_sessions (token_hash, role, student_id, created_at, expires_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        sha256(token),
        String(role),
        studentId || null,
        now.toISOString(),
        new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
        now.toISOString()
      );
    },

    /**
     * D1 equivalent of the local single-session check. The two statements run
     * in one atomic batch: clear expired/revoked rows, then insert only if no
     * live participant row remains. A concurrent second login sees changes=0
     * and gets a 409 from the API.
     */
    async createStudentSession(token, studentId) {
      const id = String(studentId);
      const now = new Date();
      const nowIso = now.toISOString();
      const expiresIso = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
      const results = await db.batch([
        stmt(
          'DELETE FROM auth_sessions WHERE student_id = ? AND (expires_at <= ? OR revoked_at IS NOT NULL)',
          id,
          nowIso
        ),
        stmt(
          `INSERT INTO auth_sessions (token_hash, role, student_id, created_at, expires_at, last_seen_at)
           SELECT ?, 'participant', ?, ?, ?, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM auth_sessions
             WHERE student_id = ? AND role = 'participant'
               AND revoked_at IS NULL AND expires_at > ?
           )`,
          sha256(token),
          id,
          nowIso,
          expiresIso,
          nowIso,
          id,
          nowIso
        ),
      ]);
      const inserted = results[1];
      return Number(inserted?.meta?.changes ?? inserted?.changes ?? 0) > 0;
    },

    async revokeStudentSessions(studentId) {
      return run('DELETE FROM auth_sessions WHERE student_id = ?', String(studentId));
    },

    async getSession(token) {
      const row = await first('SELECT * FROM auth_sessions WHERE token_hash = ?', sha256(token));
      if (!row) return null;
      if (row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
        await run('DELETE FROM auth_sessions WHERE token_hash = ?', row.token_hash);
        return null;
      }
      await run(
        'UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?',
        new Date().toISOString(),
        row.token_hash
      );
      return { role: row.role, studentId: row.student_id, createdAt: row.created_at };
    },

    async revokeSession(token) {
      return (await run('DELETE FROM auth_sessions WHERE token_hash = ?', sha256(token))) > 0;
    },

    async purgeExpired() {
      await run(
        'DELETE FROM auth_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL',
        new Date().toISOString()
      );
    },

    async seedSecretsFromEnv({ adminPin, studentPasscode }) {
      // Only seed when missing: secrets should not overwrite a PIN/password
      // the admin rotated in the UI on every Worker cold start.
      if (adminPin) {
        const existing = await first("SELECT id FROM admins WHERE id = 'admin'");
        if (!existing) {
          await run(
            "INSERT INTO admins (id, name, pin_hash, updated_at) VALUES ('admin', '', ?, ?)",
            hashWithCost(adminPin),
            new Date().toISOString()
          );
        }
      }
      if (studentPasscode) {
        const existing = await first("SELECT value FROM settings WHERE key = 'class_password'");
        if (!existing) {
          await run(
            "INSERT INTO settings (key, value) VALUES ('class_password', ?)",
            hashWithCost(studentPasscode)
          );
        }
      }
    },

    _hashPin(pin) {
      return hashWithCost(pin);
    },

    async verifyAdminPin(pin) {
      const row = await first("SELECT pin_hash FROM admins WHERE id = 'admin'");
      if (!row) return false;
      return verifyScrypt(pin, row.pin_hash);
    },

    async hasAdminPin() {
      return Boolean(await first("SELECT id FROM admins WHERE id = 'admin'"));
    },

    async setClassPassword(password) {
      await run(
        `INSERT INTO settings (key, value) VALUES ('class_password', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        hashWithCost(password)
      );
    },

    async clearClassPassword() {
      await run("DELETE FROM settings WHERE key = 'class_password'");
    },

    async hasClassPassword() {
      return Boolean(await first("SELECT value FROM settings WHERE key = 'class_password'"));
    },

    async verifyClassPassword(password) {
      const row = await first("SELECT value FROM settings WHERE key = 'class_password'");
      if (!row) return false;
      return verifyScrypt(password, row.value);
    },

    async checkStudentPassword(studentId, password) {
      const row = await first('SELECT password_hash FROM students WHERE id = ?', String(studentId));
      if (!row) return 'bad';
      if (row.password_hash) return verifyScrypt(password, row.password_hash) ? 'ok' : 'bad';
      const cls = await first("SELECT value FROM settings WHERE key = 'class_password'");
      if (!cls) return 'unprovisioned';
      return verifyScrypt(password, cls.value) ? 'ok' : 'bad';
    },

    async setStudentPassword(studentId, password) {
      const changes = await run(
        'UPDATE students SET password_hash = ? WHERE id = ?',
        hashWithCost(password),
        String(studentId)
      );
      if (!changes) throw Object.assign(new Error('Student not found.'), { status: 404 });
    },

    async clearStudentPassword(studentId) {
      await run('UPDATE students SET password_hash = NULL WHERE id = ?', String(studentId));
    },

    async studentHasPassword(studentId) {
      const row = await first('SELECT password_hash FROM students WHERE id = ?', String(studentId));
      return Boolean(row?.password_hash);
    },
  };

  return { students, batches, targets, questions, knowledge, chats, materials, auth };
}
