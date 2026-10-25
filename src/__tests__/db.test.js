// @vitest-environment node
/**
 * Repository-layer tests: CRUD, cascade integrity, chat/question semantics
 * and session/secret handling — all against an in-memory SQLite database, so
 * they never touch server/sbc.db or the legacy JSON files.
 */
process.env.DB_PATH = ':memory:';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb, closeDb, hashSecret, verifySecret } from '../../server/db.js';
import {
  students,
  batches,
  targets,
  questions,
  knowledge,
  chats,
  materials,
  materialFiles,
  announcements,
  auth,
} from '../../server/repos.js';
import { KNOWLEDGE_SEED } from '../../server/knowledge-seed.js';

const now = () => new Date().toISOString();

let batchA;
let batchB;

beforeAll(() => {
  getDb(); // creates the schema in-memory
  batchA = batches.create({ id: 'bat-a', name: 'Batch A', createdAt: now() });
  batchB = batches.create({ id: 'bat-b', name: 'Batch B', createdAt: now() });
});

afterAll(() => closeDb());

describe('students + batches', () => {
  it('creates a student with batches and resolves batchNames', () => {
    const created = students.create({
      id: 'stu-1',
      createdAt: now(),
      name: 'Ada',
      email: 'ada@test.com',
      notes: '',
      batches: ['bat-a', 'bat-gone'], // stale id must be ignored, not crash
    });
    expect(created.batches).toEqual(['bat-a']);

    const found = students.find('stu-1');
    expect(found.name).toBe('Ada');
    expect(students.find('ada@test.com').id).toBe('stu-1'); // email lookup
    expect(students.emailTaken('ada@test.com')).toBe(true);
    expect(students.emailTaken('ada@test.com', 'stu-1')).toBe(false); // self exempt
  });

  it('inBatches only returns members of the given batches', () => {
    students.create({ id: 'stu-2', createdAt: now(), name: 'Bo', email: '', batches: ['bat-b'] });
    const ids = students.inBatches(['bat-a']).map((s) => s.id);
    expect(ids).toEqual(['stu-1']);
    expect(students.inBatches([])).toEqual([]);
  });

  it('member counts come from the junction table', () => {
    const list = batches.listWithCounts();
    expect(list.find((b) => b.id === 'bat-a').memberCount).toBe(1);
    expect(list.find((b) => b.id === 'bat-b').memberCount).toBe(1);
    expect(batches.nameTaken('batch a')).toBe(true); // case-insensitive
  });

  it('updating a student replaces its memberships', () => {
    students.update('stu-1', { name: 'Ada L.', email: 'ada@test.com', notes: 'n', batches: ['bat-b'] });
    expect(students.get('stu-1').batches).toEqual(['bat-b']);
    expect(students.inBatches(['bat-a'])).toHaveLength(0);
  });

  it('deleting a batch cascades its memberships off every student', () => {
    batches.create({ id: 'bat-tmp', name: 'Temp', createdAt: now() });
    students.update('stu-1', { name: 'Ada L.', email: 'ada@test.com', notes: '', batches: ['bat-tmp'] });
    expect(students.get('stu-1').batches).toEqual(['bat-tmp']);

    expect(batches.remove('bat-tmp')).toBe(true);
    expect(students.get('stu-1').batches).toEqual([]);
    expect(batches.remove('bat-tmp')).toBe(false); // already gone
  });
});

describe('meeting targets + registrations', () => {
  it('assignBatches merges, setBatches replaces, clear deletes', () => {
    targets.assignBatches('87621909714', ['bat-a']);
    targets.assignBatches('87621909714', ['bat-b']);
    expect(targets.get('87621909714').batchIds.sort()).toEqual(['bat-a', 'bat-b']);

    targets.setBatches('87621909714', ['bat-b']);
    expect(targets.get('87621909714').batchIds).toEqual(['bat-b']);

    expect(targets.clear('87621909714')).toBe(true);
    expect(targets.get('87621909714')).toBeNull();
  });

  it('saves personalised join links and upserts on re-registration', () => {
    targets.assignBatches('88373216167', ['bat-a']);
    targets.saveRegistrations('88373216167', [
      { studentId: 'stu-1', name: 'Ada L.', email: 'ada@test.com', joinUrl: 'https://zoom.us/j/1' },
    ]);
    targets.saveRegistrations('88373216167', [
      { studentId: 'stu-1', name: 'Ada L.', email: 'ada@test.com', joinUrl: 'https://zoom.us/j/2' },
    ]);

    const regs = targets.get('88373216167').registrations;
    expect(regs).toHaveLength(1); // upsert, not duplicate
    expect(regs[0].joinUrl).toBe('https://zoom.us/j/2');
  });

  it('deleting a student cascades their registrations away', () => {
    students.remove('stu-2'); // not registered, but memberships + chat go too
    students.create({ id: 'stu-3', createdAt: now(), name: 'Cy', email: '', batches: [] });
    targets.saveRegistrations('88373216167', [
      { studentId: 'stu-3', name: 'Cy', email: '', joinUrl: 'https://zoom.us/j/3' },
    ]);
    expect(targets.get('88373216167').registrations).toHaveLength(2);

    students.remove('stu-3');
    const regs = targets.get('88373216167').registrations;
    expect(regs.map((r) => r.studentId)).toEqual(['stu-1']);
  });
});

describe('questions + knowledge', () => {
  it('creates, lists since a cutoff, and stores the student FK', () => {
    questions.create({
      id: 'q-1',
      at: now(),
      question: 'What is stop loss?',
      answer: 'A predetermined exit.',
      askedBy: 'Ada L.',
      role: 'participant',
      studentId: 'stu-1',
      source: 'chatbot',
      topic: '',
    });
    expect(questions.listSince(Date.now() - 60_000)).toHaveLength(1);
    expect(questions.listSince(Date.now() + 1_000)).toHaveLength(0);

    const q = questions.get('q-1');
    expect(q.studentId).toBe('stu-1');
    expect(q.at).toBeTruthy();
  });

  it('editAnswer keeps the original bot answer in aiAnswer (first edit only)', () => {
    const first = questions.editAnswer('q-1', 'Mentor wording v1', 'Admin');
    expect(first.answer).toBe('Mentor wording v1');
    expect(first.aiAnswer).toBe('A predetermined exit.');
    expect(first.editedBy).toBe('Admin');

    const second = questions.editAnswer('q-1', 'Mentor wording v2', 'Admin');
    expect(second.answer).toBe('Mentor wording v2');
    expect(second.aiAnswer).toBe('A predetermined exit.'); // unchanged by re-edits

    expect(questions.editedAnswers().map((q) => q.id)).toEqual(['q-1']);
    expect(questions.editAnswer('q-missing', 'x')).toBeNull();
  });

  it('deleting the student they were asked by keeps the log (FK SET NULL)', () => {
    students.remove('stu-1');
    expect(questions.get('q-1').studentId ?? null).toBeNull(); // link dropped
    expect(questions.get('q-1').askedBy).toBe('Ada L.'); // display name survives
  });

  it('knowledge dedupes case-insensitively', () => {
    knowledge.add({ id: 'kb-1', question: 'What is RSI?', answer: 'Momentum oscillator.', createdAt: now() });
    const list = knowledge.add({ id: 'kb-2', question: '  what is rsi?  ', answer: 'Dup.', createdAt: now() });
    expect(list.filter((k) => k.question.toLowerCase().includes('rsi'))).toHaveLength(1);
  });
});

describe('built-in knowledge bank', () => {
  it('ships 100+ unique, non-empty study answers', () => {
    expect(KNOWLEDGE_SEED.length).toBeGreaterThanOrEqual(100);
    expect(new Set(KNOWLEDGE_SEED.map((k) => k.id)).size).toBe(KNOWLEDGE_SEED.length);
    expect(new Set(KNOWLEDGE_SEED.map((k) => k.question.toLowerCase().trim())).size).toBe(
      KNOWLEDGE_SEED.length
    );
    expect(KNOWLEDGE_SEED.every((k) => k.question.trim() && k.answer.trim())).toBe(true);
  });

  it('seeds idempotently without duplicating questions', () => {
    const before = knowledge.list().length;
    const first = knowledge.seed(KNOWLEDGE_SEED);
    expect(first.added).toBe(KNOWLEDGE_SEED.length);
    expect(knowledge.list().length).toBe(before + KNOWLEDGE_SEED.length);

    const second = knowledge.seed(KNOWLEDGE_SEED);
    expect(second.added).toBe(0);
    expect(knowledge.list().length).toBe(before + KNOWLEDGE_SEED.length);

    const questions = knowledge.list().map((k) => k.question.toLowerCase().trim());
    expect(new Set(questions).size).toBe(questions.length);
  });
});

describe('chats', () => {
  it('round-trips messages including the corrected flag', () => {
    chats.replace('admin', [
      { sender: 'user', text: 'hello', time: '5:34 pm' },
      { sender: 'bot', text: 'hi', time: '5:34 pm', source: 'knowledge', corrected: true },
    ]);
    const got = chats.getMessages('admin');
    expect(got).toHaveLength(2);
    expect(got[1]).toMatchObject({ text: 'hi', source: 'knowledge', corrected: true });
  });

  it('rejects a conversation key for an unknown student', () => {
    expect(() => chats.replace('stu-unknown', [{ sender: 'user', text: 'x', time: '1:00 pm' }])).toThrow();
  });

  it('an empty replace deletes the conversation entirely', () => {
    chats.replace('admin', []);
    expect(chats.getMessages('admin')).toEqual([]);
  });
});

describe('materials + auth', () => {
  it('seeds only when empty, then CRUDs', () => {
    materials.seedIfEmpty([{ id: 'mat-1', title: 'Seed', category: 'Beginner', type: 'Ref', url: 'https://a.b', description: '' }]);
    materials.seedIfEmpty([{ id: 'mat-999', title: 'Should not appear', category: '', type: '', url: '', description: '' }]);
    expect(materials.list().map((m) => m.id)).toEqual(['mat-1']);

    const created = materials.create({ id: 'mat-2', title: 'Mine', category: '', type: '', url: '', description: '', bookmarks: 0 });
    expect(materials.list().map((m) => m.id)).toContain('mat-2');
    expect(materials.update('mat-2', { ...created, title: 'Mine v2' }).title).toBe('Mine v2');
    expect(materials.remove('mat-2')).toBe(true);
    expect(materials.remove('mat-2')).toBe(false);
    expect(materials.list().map((m) => m.id)).toEqual(['mat-1']);
  });

  it('stores sessions by token hash and revokes them', () => {
    const token = 'a'.repeat(48);
    auth.createSession(token, 'participant', null);
    const session = auth.getSession(token);
    expect(session.role).toBe('participant');

    expect(auth.revokeSession(token)).toBe(true);
    expect(auth.getSession(token)).toBeNull();
    expect(auth.getSession('b'.repeat(48))).toBeNull(); // unknown token
  });

  it('allows exactly one active session per student, with expiry + admin release', () => {
    students.create({ id: 'stu-session', createdAt: now(), name: 'Session', email: 'session@test.com', batches: [] });
    const first = 'c'.repeat(48);
    const second = 'd'.repeat(48);

    expect(auth.createStudentSession(first, 'stu-session')).toBe(true);
    expect(auth.createStudentSession(second, 'stu-session')).toBe(false); // second device blocked
    expect(auth.getSession(first).studentId).toBe('stu-session');
    expect(auth.getSession(second)).toBeNull();

    expect(auth.revokeStudentSessions('stu-session')).toBe(1); // admin release
    expect(auth.getSession(first)).toBeNull();
    expect(auth.createStudentSession(second, 'stu-session')).toBe(true);

    // An expired session must not block the next device.
    getDb()
      .prepare('UPDATE auth_sessions SET expires_at = ? WHERE student_id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), 'stu-session');
    const third = 'e'.repeat(48);
    expect(auth.createStudentSession(third, 'stu-session')).toBe(true);
    expect(auth.getSession(second)).toBeNull();
    expect(auth.getSession(third).studentId).toBe('stu-session');

    auth.revokeStudentSessions('stu-session');
    students.remove('stu-session');
  });

  it('seeds the admin PIN / class password as scrypt hashes and verifies them', () => {
    auth.seedSecretsFromEnv({ adminPin: '625158', studentPasscode: '1234' });
    expect(auth.hasAdminPin()).toBe(true);
    expect(auth.hasClassPassword()).toBe(true);
    expect(auth.verifyAdminPin('625158')).toBe(true);
    expect(auth.verifyAdminPin('000000')).toBe(false);
    expect(auth.verifyClassPassword('1234')).toBe(true);
    expect(auth.verifyClassPassword('9999')).toBe(false);

    const stored = getDb().prepare("SELECT pin_hash FROM admins WHERE id = 'admin'").get().pin_hash;
    expect(stored).not.toBe('625158'); // never plaintext
    expect(stored.startsWith('scrypt:')).toBe(true);
  });

  it('hashSecret/verifySecret round-trip', () => {
    const hash = hashSecret('hunter2');
    expect(verifySecret('hunter2', hash)).toBe(true);
    expect(verifySecret('wrong', hash)).toBe(false);
    expect(verifySecret('x', 'not-a-hash')).toBe(false);
  });
});

describe('class password + personal override', () => {
  it('class password: set, verify, rotate, clear', () => {
    auth.setClassPassword('class-one');
    expect(auth.hasClassPassword()).toBe(true);
    expect(auth.verifyClassPassword('class-one')).toBe(true);

    auth.setClassPassword('class-two'); // rotation invalidates the old one
    expect(auth.verifyClassPassword('class-one')).toBe(false);
    expect(auth.verifyClassPassword('class-two')).toBe(true);

    auth.clearClassPassword();
    expect(auth.hasClassPassword()).toBe(false);
  });

  it('personal override wins, survives rotation, and reverts on clear', () => {
    auth.setClassPassword('class-pass');
    students.create({ id: 'stu-pw', createdAt: now(), name: 'Pw', email: 'pw@test.com', batches: [] });
    students.create({ id: 'stu-plain', createdAt: now(), name: 'Plain', email: 'plain@test.com', batches: [] });

    // No personal password yet → class password signs them in.
    expect(auth.checkStudentPassword('stu-pw', 'class-pass')).toBe('ok');
    expect(auth.checkStudentPassword('stu-pw', 'nope')).toBe('bad');

    // Personal override set → class password no longer works for THEM…
    auth.setStudentPassword('stu-pw', 'own-pass');
    expect(auth.checkStudentPassword('stu-pw', 'own-pass')).toBe('ok');
    expect(auth.checkStudentPassword('stu-pw', 'class-pass')).toBe('bad');
    // …while everyone else keeps using the class password.
    expect(auth.checkStudentPassword('stu-plain', 'class-pass')).toBe('ok');

    // Rotating the class password must not lock out personal passwords.
    auth.setClassPassword('class-new');
    expect(auth.checkStudentPassword('stu-pw', 'own-pass')).toBe('ok');
    expect(auth.checkStudentPassword('stu-plain', 'class-new')).toBe('ok');
    expect(auth.checkStudentPassword('stu-plain', 'class-pass')).toBe('bad');

    // Clearing the personal password reverts the student to the class password.
    auth.clearStudentPassword('stu-pw');
    expect(auth.studentHasPassword('stu-pw')).toBe(false);
    expect(auth.checkStudentPassword('stu-pw', 'class-new')).toBe('ok');

    // The API shape exposes a boolean only — never the hash.
    auth.setStudentPassword('stu-plain', 'plain-own');
    expect(students.get('stu-plain').hasPersonalPassword).toBe(true);
    expect(students.get('stu-plain').passwordHash).toBeUndefined();
    expect(students.get('stu-pw').hasPersonalPassword).toBe(false);
  });

  it('reports unprovisioned when neither a personal nor a class password exists', () => {
    auth.clearClassPassword();
    students.create({ id: 'stu-none', createdAt: now(), name: 'None', email: 'none@test.com', batches: [] });
    expect(auth.checkStudentPassword('stu-none', 'anything')).toBe('unprovisioned');
    expect(auth.checkStudentPassword('stu-missing', 'anything')).toBe('bad'); // unknown student
  });
});

describe('material PDFs + announcements', () => {
  it('stores PDF bytes as ordered chunks and replaces/deletes them', () => {
    materialFiles.putChunks('file-a', [Buffer.from('first'), Buffer.from('second')]);
    expect(materialFiles.readChunks('file-a').map((c) => Buffer.from(c).toString())).toEqual([
      'first',
      'second',
    ]);

    // putChunks replaces rather than appends.
    materialFiles.putChunks('file-a', [Buffer.from('only')]);
    expect(materialFiles.readChunks('file-a').map((c) => Buffer.from(c).toString())).toEqual(['only']);

    materialFiles.putChunks('file-b', [Buffer.from('b')]);
    expect(materialFiles.removeMany(['file-a', 'file-b'])).toBe(2);
    expect(materialFiles.readChunks('file-a')).toEqual([]);
    expect(materialFiles.remove('file-b')).toBe(false); // already gone
  });

  it('keeps uploaded-file metadata on the material', () => {
    materials.create({ id: 'mat-files', title: 'Has PDF', category: '', type: '', url: '', description: '' });
    const file = { id: 'file-a', name: 'guide.pdf', size: 10, mimeType: 'application/pdf' };
    const updated = materials.setFiles('mat-files', [file]);
    expect(updated.files).toEqual([file]);
    expect(materials.get('mat-files').files).toEqual([file]);
  });

  it('publishes announcements and tracks each student’s read state', () => {
    students.create({ id: 'stu-ann', createdAt: now(), name: 'Ann', email: 'ann@test.com', batches: [] });
    students.create({ id: 'stu-ann2', createdAt: now(), name: 'Bea', email: 'bea@test.com', batches: [] });
    const created = announcements.create({
      id: 'ann-1',
      subject: 'Class moved',
      body: 'This Saturday starts at 4 PM.',
      createdBy: 'Admin',
      createdAt: '2026-10-01T10:00:00.000Z',
    });
    expect(created.subject).toBe('Class moved');
    expect(announcements.list().map((a) => a.id)).toEqual(['ann-1']);

    let mine = announcements.forStudent('stu-ann');
    expect(mine).toHaveLength(1);
    expect(mine[0].read).toBe(false);

    expect(announcements.markRead('stu-ann', ['ann-1'])).toBe(1);
    mine = announcements.forStudent('stu-ann');
    expect(mine[0].read).toBe(true);
    // Marking again is a no-op (INSERT OR IGNORE).
    expect(announcements.markRead('stu-ann', ['ann-1'])).toBe(0);

    // Another student still has it unread.
    expect(announcements.forStudent('stu-ann2')[0].read).toBe(false);

    // `since` hides announcements older than the student's enrolment.
    expect(announcements.forStudent('stu-ann', '2026-10-02T00:00:00.000Z')).toHaveLength(0);

    // Removing the announcement also drops its read rows.
    expect(announcements.remove('ann-1')).toBe(true);
    expect(announcements.list()).toEqual([]);
    expect(announcements.forStudent('stu-ann')).toEqual([]);
  });
});
