/**
 * One-off pilot import: create the client batch + register every student from
 * the client's CSV, generating a unique password per student, then write a
 * credential sheet for handover. Uses the app's own HTTP API (no direct DB writes).
 *
 * Usage: node scripts/import-client-students.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';

const BASE = 'http://localhost:8787/api';
const CSV_IN = 'D:/zoom-sdk/sbc-dashboard/students DETAILS.csv';
const SHEET_OUT = 'D:/zoom-sdk/sbc-dashboard/SBC-Traders-Credentials.csv';
const BATCH_NAME = 'SBC Traders Batch 1';
const BATCH_DESC = 'Pilot batch — all students from the client list (16 Oct 2026).';

// ---- password generator (8 chars: lower + upper + digit + safe special) ----
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGIT = '23456789';
const SPECIAL = '!@#$&*?';
const ALL = LOWER + UPPER + DIGIT + SPECIAL;
function genPassword(len = 8) {
  const pick = (set) => set[randomInt(set.length)];
  const chars = [pick(LOWER), pick(UPPER), pick(DIGIT), pick(SPECIAL)];
  while (chars.length < len) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// ---- minimal CSV parse (4 columns, comma separated, quoted fields ok) ----
function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (field !== '' || row.length) { row.push(field); rows.push(row); row = []; field = ''; }
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${data.error || ''}`);
  return data;
}

// ---- main ----
const raw = parseCsv(readFileSync(CSV_IN, 'utf8'));
const header = raw[0].map((h) => h.trim().toUpperCase());
const expected = ['SL NO', 'NAME', 'CONTACT NO', 'EMAIL ID'];
if (header.join('|') !== expected.join('|')) {
  throw new Error(`Unexpected columns: ${header.join(', ')} (want ${expected.join(', ')})`);
}
const students = raw.slice(1).filter((r) => r.some((c) => c.trim() !== '')).map((r) => ({
  sl: r[0].trim(),
  name: r[1].trim().replace(/\s+/g, ' '),
  phone: r[2].trim(),
  email: r[3].trim().toLowerCase(),
}));

console.log(`Parsed ${students.length} rows from ${CSV_IN}`);

const { token } = await api('/auth/login', { method: 'POST', body: { role: 'admin', pin: '625158' } });
console.log('Admin logged in.');

const batches = await api('/batches', { token });
let batch = batches.batches.find((b) => b.name === BATCH_NAME);
if (!batch) {
  batch = await api('/batches', { method: 'POST', token, body: { name: BATCH_NAME, description: BATCH_DESC } });
  console.log(`Created batch “${BATCH_NAME}” (${batch.id})`);
} else {
  console.log(`Batch “${BATCH_NAME}” already exists (${batch.id}) — reusing.`);
}

const existing = new Map((await api('/students', { token })).students.map((s) => [s.email, s]));
const sheet = [];
let created = 0, skipped = 0, failed = 0;

for (const st of students) {
  const flagged = /\.vom$/i.test(st.email) ? ' !! INVALID EMAIL — confirm with client' : '';
  try {
    let record = existing.get(st.email);
    if (!record) {
      record = await api('/students', {
        method: 'POST',
        token,
        body: {
          name: st.name,
          email: st.email,
          batches: [batch.id],
          notes: `Client SL NO: ${st.sl}${st.phone ? ` | Contact: ${st.phone}` : ''}`,
        },
      });
      created++;
    } else {
      skipped++; // already enrolled — keep existing credentials
    }
    const password = genPassword(8);
    await api(`/students/${record.id}/password`, { method: 'POST', token, body: { password } });
    sheet.push([st.sl, st.name, st.email, password, st.phone, flagged.trim()]);
  } catch (err) {
    failed++;
    sheet.push([st.sl, st.name, st.email, '', st.phone, `FAILED: ${err.message}`]);
    console.error(`  ✗ SL ${st.sl} ${st.email}: ${err.message}`);
  }
}

const csvEscape = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const lines = [
  'SL NO,NAME,EMAIL,PASSWORD,CONTACT NO,NOTE',
  ...sheet.map((r) => r.map(csvEscape).join(',')),
];
writeFileSync(SHEET_OUT, lines.join('\n') + '\n', 'utf8');

console.log(`\nDone. created=${created} already-existed=${skipped} failed=${failed}`);
console.log(`Credential sheet: ${SHEET_OUT}`);
const counts = await api('/batches', { token });
const b = counts.batches.find((x) => x.id === batch.id);
console.log(`Batch “${b.name}” now has ${b.studentCount ?? b.students ?? '?'} students.`);
