/**
 * Rotate the admin PIN.
 *
 *   node scripts/rotate-admin-pin.mjs
 *
 * Creates a new 10-digit PIN, writes its scrypt hash to stdout, updates
 * ADMIN_PIN in `.env` (and `.dev.vars` when present), and stores the plaintext
 * PIN in the OS temp folder (`sbc-admin-pin.txt`) so it is not echoed into
 * shell/chat logs.
 *
 * After running this, update D1 + the Worker secret (the deployment guide has
 * the exact commands):
 *
 *   npx wrangler d1 execute sbc-lms --remote --command "UPDATE admins SET pin_hash='<hash>', updated_at='<iso>' WHERE id='admin';"
 *   Get-Content "$env:TEMP\sbc-admin-pin.txt" | npx wrangler secret put ADMIN_PIN
 *
 * The local Node app picks the new PIN up from `.env` on its next restart.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const pin = String(process.env.NEW_ADMIN_PIN || '').trim()
  || Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join('');

const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(pin, salt, 32, { N: 16384 }).toString('hex');
const stored = `scrypt:16384:${salt}:${hash}`;

const envPath = path.join(process.cwd(), '.env');
let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
if (/^ADMIN_PIN=.*$/m.test(env)) {
  env = env.replace(/^ADMIN_PIN=.*$/m, `ADMIN_PIN=${pin}`);
} else {
  env = `${env.replace(/\s*$/, '')}\nADMIN_PIN=${pin}\n`;
}
fs.writeFileSync(envPath, env, 'utf8');

// Keep the local Worker dev secrets in sync when `.dev.vars` exists.
const devVarsPath = path.join(process.cwd(), '.dev.vars');
if (fs.existsSync(devVarsPath)) {
  let devVars = fs.readFileSync(devVarsPath, 'utf8');
  if (/^ADMIN_PIN=.*$/m.test(devVars)) {
    devVars = devVars.replace(/^ADMIN_PIN=.*$/m, `ADMIN_PIN=${pin}`);
  } else {
    devVars = `${devVars.replace(/\s*$/, '')}\nADMIN_PIN=${pin}\n`;
  }
  fs.writeFileSync(devVarsPath, devVars, 'utf8');
}

const pinFile = path.join(os.tmpdir(), 'sbc-admin-pin.txt');
fs.writeFileSync(pinFile, `${pin}\n`, 'utf8');

// Only the hash goes to stdout; the plaintext PIN stays in the temp file.
console.log(stored);
console.error(`New admin PIN written to ${pinFile}`);
