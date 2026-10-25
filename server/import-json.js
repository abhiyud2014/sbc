/**
 * One-shot migration: server/*.json  ->  server/sbc.db (SQLite).
 *
 * Run:  npm run db:import          (from the project root)
 *
 * - Idempotent: skips rows that already exist (safe to re-run).
 * - The JSON files are NOT deleted — keep them as a backup archive.
 * - Reconciles derived data: students.batches -> student_batches junction,
 *   targets.json -> meeting_targets + meeting_target_batches + registrations,
 *   chats.json   -> chat_conversations + chat_messages (seq rebuilt).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, tx } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const readJson = (name, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'));
  } catch {
    return fallback;
  }
};

const now = () => new Date().toISOString();

function importStudents(db, students) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO students (id, created_at, name, email, notes) VALUES (?, ?, ?, ?, ?)'
  );
  let n = 0;
  for (const s of students) {
    const r = insert.run(String(s.id), s.createdAt || '', String(s.name || ''), String(s.email || '').toLowerCase(), String(s.notes || ''));
    n += r.changes;
  }
  return n;
}

function importBatches(db, batches) {
  const insert = db.prepare('INSERT OR IGNORE INTO batches (id, name, description, created_at) VALUES (?, ?, ?, ?)');
  let n = 0;
  for (const b of batches) {
    const r = insert.run(String(b.id), String(b.name || ''), String(b.description || ''), String(b.createdAt || ''));
    n += r.changes;
  }
  return n;
}

function importMemberships(db, students) {
  const knownStudents = new Set(db.prepare('SELECT id FROM students').all().map((r) => r.id));
  const knownBatches = new Set(db.prepare('SELECT id FROM batches').all().map((r) => r.id));
  const insert = db.prepare('INSERT OR IGNORE INTO student_batches (student_id, batch_id, joined_at) VALUES (?, ?, ?)');
  let n = 0;
  for (const s of students) {
    for (const batchId of s.batches || []) {
      if (!knownStudents.has(String(s.id)) || !knownBatches.has(String(batchId))) continue;
      n += insert.run(String(s.id), String(batchId), s.createdAt || '').changes;
    }
  }
  return n;
}

function importTargets(db, targets) {
  const knownBatches = new Set(db.prepare('SELECT id FROM batches').all().map((r) => r.id));
  const knownStudents = new Set(db.prepare('SELECT id FROM students').all().map((r) => r.id));
  let meetings = 0;
  let assignments = 0;
  let registrations = 0;

  const upsertTarget = db.prepare(
    `INSERT INTO meeting_targets (meeting_id, topic, updated_at) VALUES (?, '', ?)
     ON CONFLICT(meeting_id) DO UPDATE SET updated_at = excluded.updated_at`
  );
  const insertAssignment = db.prepare('INSERT OR IGNORE INTO meeting_target_batches (meeting_id, batch_id) VALUES (?, ?)');
  const upsertReg = db.prepare(
    `INSERT INTO registrations (meeting_id, student_id, name, email, join_url, registered_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(meeting_id, student_id) DO UPDATE SET
       name = excluded.name, email = excluded.email, join_url = excluded.join_url`
  );

  for (const [meetingId, t] of Object.entries(targets || {})) {
    upsertTarget.run(String(meetingId), String(t.updatedAt || now()));
    meetings += 1;
    for (const batchId of t.batchIds || []) {
      if (!knownBatches.has(String(batchId))) continue;
      assignments += insertAssignment.run(String(meetingId), String(batchId)).changes;
    }
    for (const r of t.registrations || []) {
      if (!knownStudents.has(String(r.studentId))) continue; // orphan link: skip
      upsertReg.run(
        String(meetingId),
        String(r.studentId),
        String(r.name || ''),
        String(r.email || '').toLowerCase(),
        String(r.joinUrl || ''),
        String(t.updatedAt || now())
      );
      registrations += 1;
    }
  }
  return { meetings, assignments, registrations };
}

function importQuestions(db, questions) {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO questions
       (id, question, answer, ai_answer, asked_by, role, student_id, source, topic, meeting_id, meeting_uuid, asked_at, edited_by, edited_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const byName = new Map(db.prepare('SELECT id, lower(email) AS email FROM students').all().map((r) => [r.id, r.email]));
  let n = 0;
  for (const q of questions) {
    const r = insert.run(
      String(q.id),
      String(q.question || ''),
      String(q.answer || ''),
      q.aiAnswer ? String(q.aiAnswer) : null,
      String(q.askedBy || ''),
      String(q.role || 'participant'),
      null, // student_id: attribution by display name is legacy; left NULL
      String(q.source || 'chatbot'),
      String(q.topic || ''),
      String(q.meetingId || ''),
      String(q.meetingUuid || ''),
      String(q.at || now()),
      q.editedBy ? String(q.editedBy) : null,
      q.editedAt ? String(q.editedAt) : null
    );
    n += r.changes;
  }
  void byName;
  return n;
}

function importKnowledge(db, knowledge) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO knowledge (id, question, answer, source, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  let n = 0;
  for (const k of knowledge) {
    n += insert.run(String(k.id), String(k.question || ''), String(k.answer || ''), String(k.source || 'knowledge'), String(k.createdAt || now())).changes;
  }
  return n;
}

function importChats(db, chats) {
  const knownStudents = new Set(db.prepare('SELECT id FROM students').all().map((r) => r.id));
  const upsertConv = db.prepare(
    `INSERT INTO chat_conversations (key, student_id, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET updated_at = excluded.updated_at`
  );
  const clearMessages = db.prepare('DELETE FROM chat_messages WHERE conversation_key = ?');
  const insertMessage = db.prepare(
    `INSERT INTO chat_messages (conversation_key, seq, sender, text, msg_time, created_at, source, mode, corrected)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let conversations = 0;
  let messages = 0;

  for (const [key, list] of Object.entries(chats || {})) {
    if (!Array.isArray(list) || !list.length) continue;
    if (key !== 'admin' && !knownStudents.has(key)) continue; // orphan conversation
    const studentId = key === 'admin' ? null : key;
    upsertConv.run(key, studentId, now());
    conversations += 1;
    // Rebuild seq + a server-clock created_at (the display strings aren't sortable).
    clearMessages.run(key);
    list.slice(-60).forEach((m, seq) => {
      insertMessage.run(
        key,
        seq,
        m?.sender === 'user' ? 'user' : 'bot',
        String(m?.text ?? '').slice(0, 4000),
        String(m?.time ?? '').slice(0, 40),
        now(),
        m?.source ? String(m.source).slice(0, 40) : null,
        m?.mode ? String(m.mode).slice(0, 20) : null,
        m?.corrected ? 1 : 0
      );
      messages += 1;
    });
  }
  return { conversations, messages };
}

function importMaterials(db, materials) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO materials (id, title, category, type, url, description, bookmarks, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  let n = 0;
  for (const m of materials) {
    n += insert.run(
      String(m.id),
      String(m.title || ''),
      String(m.category || ''),
      String(m.type || ''),
      String(m.url || ''),
      String(m.description || ''),
      Number(m.bookmarks) || 0,
      now()
    ).changes;
  }
  return n;
}

/* ------------------------------------------------------------------ */

const db = getDb();
const students = readJson('students.json', []);
const batches = readJson('batches.json', []);
const targets = readJson('targets.json', {});
const questionsList = readJson('questions.json', []);
const knowledgeList = readJson('knowledge.json', []);
const chatsMap = readJson('chats.json', {});
const materialsList = readJson('materials.json', []);

console.log('Importing server/*.json -> server/sbc.db\n');

const result = tx(() => ({
  students: importStudents(db, students),
  batches: importBatches(db, batches),
  memberships: importMemberships(db, students),
  targets: importTargets(db, targets),
  questions: importQuestions(db, questionsList),
  knowledge: importKnowledge(db, knowledgeList),
  chats: importChats(db, chatsMap),
  materials: importMaterials(db, materialsList),
}));

console.log(`  students      +${result.students}`);
console.log(`  batches       +${result.batches}`);
console.log(`  memberships   +${result.memberships}`);
console.log(`  meetings      +${result.targets.meetings} (assignments +${result.targets.assignments}, registrations +${result.targets.registrations})`);
console.log(`  questions     +${result.questions}`);
console.log(`  knowledge     +${result.knowledge}`);
console.log(`  chat          +${result.chats.conversations} conversations, +${result.chats.messages} messages`);
console.log(`  materials     +${result.materials}`);

const counts = db
  .prepare(
    `SELECT (SELECT COUNT(*) FROM students) AS students,
            (SELECT COUNT(*) FROM batches) AS batches,
            (SELECT COUNT(*) FROM meeting_targets) AS meetings,
            (SELECT COUNT(*) FROM registrations) AS registrations,
            (SELECT COUNT(*) FROM questions) AS questions,
            (SELECT COUNT(*) FROM chat_messages) AS messages,
            (SELECT COUNT(*) FROM materials) AS materials`
  )
  .get();
console.log('\nTotals in DB:', JSON.stringify(counts));
console.log('\nDone. The JSON files stay in server/ as a backup archive.');
