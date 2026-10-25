/**
 * Local Node entry point.
 *
 * Cloudflare Workers use `worker/index.js` and D1 instead; this file keeps
 * `npm run dev:api` / `npm start` on node:sqlite exactly as before.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

import { createApp } from './app.js';
import { getDb, closeDb } from './db.js';
import {
  students,
  batches,
  targets,
  questions,
  knowledge,
  chats,
  materials,
  auth,
} from './repos.js';
import { KNOWLEDGE_SEED } from './knowledge-seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);

// Boot-time housekeeping: schema, expired sessions, env-seeded secrets and
// the built-in study bank. Idempotent, so restarts are safe.
getDb();
auth.purgeExpired();
auth.seedSecretsFromEnv({
  adminPin: (process.env.ADMIN_PIN || '').trim(),
  studentPasscode: (process.env.STUDENT_PASSCODE || '').trim(),
});
const seededKnowledge = knowledge.seed(KNOWLEDGE_SEED);
if (seededKnowledge.added) {
  console.log(`  Knowledge base: +${seededKnowledge.added} Q&A seeded`);
}

const dist = path.join(__dirname, '..', 'dist');
const app = createApp({
  repos: { students, batches, targets, questions, knowledge, chats, materials, auth },
  config: {
    zoomAccountId: process.env.ZOOM_ACCOUNT_ID,
    zoomClientId: process.env.ZOOM_CLIENT_ID,
    zoomClientSecret: process.env.ZOOM_CLIENT_SECRET,
    rosterCacheMs: process.env.ROSTER_CACHE_MS,
  },
  staticDir: fs.existsSync(dist) ? dist : '',
});

app.listen(PORT, () => {
  console.log(`\n  SBC-LMS Zoom API proxy  ->  http://localhost:${PORT}`);
  console.log(
    process.env.ZOOM_ACCOUNT_ID && process.env.ZOOM_CLIENT_ID && process.env.ZOOM_CLIENT_SECRET
      ? '  Credentials: loaded from .env\n'
      : '  Credentials: MISSING — fill in .env (ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET)\n'
  );
  console.log(`  Database: ${process.env.DB_PATH || 'server/sbc.db'} (SQLite)\n`);
});

// Flush/close the database on shutdown so WAL checkpoints cleanly.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    closeDb();
    process.exit(0);
  });
}
