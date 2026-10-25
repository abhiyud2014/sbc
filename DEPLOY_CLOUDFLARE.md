# Deploy SBC-LMS on Cloudflare Workers + D1

This is the Cloudflare deployment path for the same app you run locally. It
keeps the Express routes, React build, Zoom proxy and LMS features, but replaces
the local `node:sqlite` file with a **D1** database and serves the built SPA with
**Workers Assets**.

```
Browser
  └── https://<worker>.<subdomain>.workers.dev
        ├── /            -> Workers Assets (dist/)
        └── /api/*       -> Worker (Express on the Workers Node HTTP server)
                              ├── D1 binding "DB"
                              └── https://api.zoom.us/v2
```

Local development is unchanged: `npm run dev` still uses
`server/sbc.db` through `server/repos.js`. On Workers, `worker/index.js` injects
the async D1 repositories from `server/repos-d1.js` instead.

## Current deployment

| Item | Value |
|---|---|
| Live URL | **https://sbc-traders-lms.abhiyud2014.workers.dev** |
| Worker | `sbc-traders-lms` |
| D1 database | `sbc-lms` (APAC) |
| D1 database id | `d133cc9b-535e-4a29-a04a-eb6ddcfaefab` |
| SPA | Workers Assets from `dist/` |
| API | `/api/*` on the Worker |

`wrangler.jsonc` already contains this database id. The instructions below are
for redeploying or for creating a separate environment from a fork.

---

## 0. Prerequisites

- Node.js 22 or newer (`node --version`)
- A Cloudflare account
- A Cloudflare **Workers Paid** plan is strongly recommended (see
  [Limits and cost](#8-limits-and-cost))
- The repo checked out locally, with `.env` containing the Zoom credentials and
  `server/sbc.db` containing the data you want to migrate

Install dependencies and Wrangler once:

```powershell
npm install
npx wrangler --version
```

The project already includes `wrangler` as a dev dependency.

---

## 1. Test the Worker locally first

This uses a local D1 database under `.wrangler/state/`, so it cannot affect
production.

```powershell
# 1. Build the SPA that Workers Assets will serve
npm run build

# 2. Create the local D1 schema
npx wrangler d1 execute sbc-lms --local --file=worker/schema.sql

# 3. Export the local SQLite data (contains private data — see the warning below)
node scripts/export-d1-seed.mjs

# 4. Import it into local D1
npx wrangler d1 execute sbc-lms --local --file=worker/seed.sql
```

Create a `.dev.vars` file in the project root for local Worker secrets. It is
git-ignored:

```env
ZOOM_ACCOUNT_ID=...
ZOOM_CLIENT_ID=...
ZOOM_CLIENT_SECRET=...
ADMIN_PIN=...
STUDENT_PASSCODE=...
```

Start the Worker:

```powershell
npx wrangler dev --port 8787
```

> If your normal local API (`npm run dev:api`) is already using port 8787, use
> `--port 8789` for the Worker instead.

Verify:

```powershell
Invoke-RestMethod http://localhost:8787/api/health
Invoke-RestMethod http://localhost:8787/api/config
```

Open `http://localhost:8787` and sign in with your admin PIN. The built SPA and
the API are both served by the Worker in this mode.

> `worker/seed.sql` contains student names/emails and scrypt password hashes.
> It is **git-ignored on purpose**. Never commit it or paste it into an issue.

---

## 2. Create the production D1 database

> The production database already exists for this deployment (see
> [Current deployment](#current-deployment)). Skip this section unless you are
> creating a separate environment or recreating the database.

Log in to Cloudflare:

```powershell
npx wrangler login
```

Create the database:

```powershell
npx wrangler d1 create sbc-lms
```

The command prints a `database_id`. This repo is already configured with:

```jsonc
"database_id": "d133cc9b-535e-4a29-a04a-eb6ddcfaefab"
```

If you create a new database, replace that value in `wrangler.jsonc` with your
new ID. The ID is not a secret; it is safe to commit. Keep the binding name as
**`DB`** and the database name as **`sbc-lms`**.

---

## 3. Apply the schema and data to production D1

```powershell
# Schema (idempotent; safe to re-run after schema changes)
npx wrangler d1 execute sbc-lms --remote --file=worker/schema.sql

# Generate a fresh export from server/sbc.db
node scripts/export-d1-seed.mjs

# Import students, batches, questions, knowledge, chats, materials, admin
# pin hash and class-password hash
npx wrangler d1 execute sbc-lms --remote --file=worker/seed.sql
```

Check the row counts:

```powershell
npx wrangler d1 execute sbc-lms --remote --command "SELECT (SELECT COUNT(*) FROM students) AS students, (SELECT COUNT(*) FROM knowledge) AS knowledge, (SELECT COUNT(*) FROM materials) AS materials;"
```

The export deliberately **excludes `auth_sessions`**: everyone signs in once
after the migration, and old bearer tokens cannot be replayed.

### Starting from an empty database instead

If you do not want to migrate existing students/chats, skip the export/import.
On the first request the Worker:

- creates the 180-question study bank (only when the table has fewer than 100
  rows), and
- seeds the admin PIN and class password from `ADMIN_PIN` /
  `STUDENT_PASSCODE` secrets **only if they do not already exist**.

Materials are seeded by the app on the first `/api/materials` request.

---

## 4. Set production secrets

Use `wrangler secret put` and paste the value when prompted:

```powershell
npx wrangler secret put ZOOM_ACCOUNT_ID
npx wrangler secret put ZOOM_CLIENT_ID
npx wrangler secret put ZOOM_CLIENT_SECRET
npx wrangler secret put ADMIN_PIN
npx wrangler secret put STUDENT_PASSCODE   # optional if the class password was imported
```

These are encrypted Worker secrets, not `vars` in `wrangler.jsonc`. Never put
them in the repo.

`ADMIN_PIN` and `STUDENT_PASSCODE` only **seed a missing row** on a fresh D1.
If you imported an existing `admins` row / class-password setting, the imported
hash wins. To change the admin PIN of an already-seeded database, follow
[Rotating the admin PIN](#9-rotating-the-admin-pin) instead of only changing the
secret.

For non-interactive shells you can pipe a value:

```powershell
"the-value" | npx wrangler secret put ZOOM_CLIENT_SECRET
```

---

## 5. Build and deploy

```powershell
npm run build
npx wrangler deploy
```

Wrangler prints the deployed URL. This deployment is live at:

```
https://sbc-traders-lms.abhiyud2014.workers.dev
```

Check:

```powershell
Invoke-RestMethod https://sbc-traders-lms.abhiyud2014.workers.dev/api/health
```

Then open the URL in a browser and sign in. The first request after a cold
start may be slightly slower while the Worker initializes.

### Custom domain

In the Cloudflare dashboard: **Workers & Pages → sbc-traders-lms → Settings →
Domains & Routes → Add custom domain**. Add the DNS record through Cloudflare;
the app uses relative `/api` URLs, so no frontend rebuild is needed.

---

## 6. Deploy automatically from GitHub (optional)

You can either keep deploying manually with `wrangler deploy`, or connect the
GitHub repo to Cloudflare Workers Builds:

1. Push `wrangler.jsonc` with the real `database_id`.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Workers → Connect
   to Git**.
3. Select `abhiyud2014/sbc` and the production branch.
4. Build command: `npm ci && npm run build`
5. Deploy command: `npx wrangler deploy`
6. Add the same secrets under **Settings → Variables and Secrets** (the
   `ZOOM_*`, `ADMIN_PIN` and optional `STUDENT_PASSCODE` values).
7. The D1 binding comes from `wrangler.jsonc`; you do not need to recreate it in
   the dashboard.

Every push to the production branch then builds and deploys. D1 schema/data
imports are **not** automatic; run the `wrangler d1 execute` commands when you
change the schema or want to refresh data.

If the build image reports an old Node version, set the `NODE_VERSION`
environment variable to `22` in the Workers Builds settings.

---

## 7. Updating production data later

The local SQLite file remains the source of truth for the mentor's data if you
keep using `npm run dev:api` locally.

```powershell
# 1. Make sure the local DB is up to date (server/sbc.db)
# 2. Re-export
node scripts/export-d1-seed.mjs

# 3. Apply to D1
npx wrangler d1 execute sbc-lms --remote --file=worker/seed.sql
```

`INSERT OR REPLACE` updates rows with the same primary key. It does **not**
delete rows that were removed locally. For a clean reset, delete the relevant
rows first (or recreate the database and re-apply schema + seed).

If you only edit knowledge/materials through the deployed app, those changes
already live in D1 and do not need a re-export.

---

## 8. Limits and cost

- **Workers Paid is recommended.** Password verification uses `scrypt`
  (`N=16384`), which can exceed the free plan's 10 ms CPU limit on sign-in.
  Paid Workers allow up to 30 seconds of CPU per request.
- **Zoom fan-out.** Roster/coverage pages can make many Zoom API calls. The free
  plan allows 50 subrequests per invocation; paid allows 1,000. Large date
  ranges can exceed the free limit.
- **D1 free tier** is usually enough for this app (5 million rows read/day and
  100,000 rows written/day). The database is only reachable through the Worker
  binding, not the public internet.
- The Worker bundle is about **1.3 MB** (about **338 KB gzip**) including
  Express, which fits within the Workers size limits.
- `node:sqlite` is not a working database on Workers; D1 is the supported path.

---

## 9. Rotating the admin PIN

The repo originally documented a public default PIN (`625158`). The production
PIN has been rotated; do not reuse the old default.

Use the helper to generate a new 10-digit PIN. It updates `ADMIN_PIN` in `.env`
(and `.dev.vars` if present) and writes the plaintext PIN to
`%TEMP%\sbc-admin-pin.txt` (so it is not echoed into shell or chat logs). It
prints only the scrypt hash:

```powershell
npm run admin:pin
# -> scrypt:16384:<salt>:<hash>
```

Update the production row and Worker secret with that hash:

```powershell
# Paste the hash printed by the command
npx wrangler d1 execute sbc-lms --remote --command "UPDATE admins SET pin_hash='scrypt:16384:<salt>:<hash>', updated_at='2026-10-21T00:00:00.000Z' WHERE id='admin';"

Get-Content -Raw "$env:TEMP\sbc-admin-pin.txt" | npx wrangler secret put ADMIN_PIN
```

Restart the local API (`npm run dev:api`) so it reloads `.env`. Then sign in
with the PIN from `%TEMP%\sbc-admin-pin.txt` and delete that file once you have
stored it in your password manager.

---

## 10. Security checklist

This deployment has already rotated the public default admin PIN. The new PIN
was written to `%TEMP%\sbc-admin-pin.txt`; store it in a password manager and
then delete that file.

Do these before/after the first production deploy:

- [x] `SBC-Traders-Credentials.csv` is not tracked in the current GitHub tree
      and is git-ignored. If it was ever pushed to a public repo/branch, remove
      it from history (`git filter-repo` or BFG) and rotate every password in it.
- [ ] If the CSV was ever public, **rotate every student password**, the admin
      PIN and the class password. Treat anything that was in it as compromised.
- [ ] **Rotate the Zoom Server-to-Server OAuth client secret** if it was ever
      committed, pasted into a chat, or shared.
- [ ] Confirm `.env`, `.dev.vars` and `worker/seed.sql` are not tracked:

  ```powershell
  git status --ignored
  git ls-files | Select-String -Pattern "\.env$|\.dev\.vars$|seed\.sql$|Credentials"
  ```

- [ ] Use a strong, unique `ADMIN_PIN`.
- [ ] Optionally put **Cloudflare Access** in front of the Worker, or add a
      WAF rate-limit rule for `/api/auth/login`.
- [ ] Keep D1 exports private; they contain password hashes even though the
      passwords themselves are not stored in plaintext.

---

## 11. Troubleshooting

| Symptom | Fix |
|---|---|
| `D1 binding "DB" is missing` | Replace the placeholder `database_id` in `wrangler.jsonc` with the ID from `wrangler d1 create sbc-lms`, then redeploy. |
| `no such table: students` | Apply the schema: `npx wrangler d1 execute sbc-lms --remote --file=worker/schema.sql`. |
| `ADMIN_PIN is not set on the server` | Set the secret: `npx wrangler secret put ADMIN_PIN`, then redeploy/retry. |
| Login times out or returns a Worker CPU error | Use Workers Paid; scrypt is intentionally expensive. |
| Roster/coverage fails on large ranges | Reduce the date range or use Workers Paid for the higher subrequest limit. |
| `assets directory ./dist not found` | Run `npm run build` before `wrangler deploy`. |
| `Cannot find module 'cloudflare:node'` | Use Wrangler 4.151+ (already in `package.json`) and keep the compatibility date at `2026-10-21` or newer. |
| Blank page / 404 on a React route | Confirm `assets.not_found_handling` is `single-page-application` and `run_worker_first` only contains `/api/*`. |
| “Already signed in on another device” | One active student session is enforced. Sign out on the old device, have the admin click the sign-out icon on that student's row, or wait for the 12 h session to expire. |
| Old bearer token stops working after migration | Expected: `auth_sessions` is not exported. Sign in again. |
| Data changes locally but not in production | Re-run `node scripts/export-d1-seed.mjs` and the remote `--file=worker/seed.sql` import. |
| `wrangler d1 execute --remote` asks for auth | Run `npx wrangler login` and make sure the account owns the D1 database. |

---

## Files involved

| File | Purpose |
|---|---|
| `worker/index.js` | Worker entry: Express on `node:http`, D1 repositories, first-request seeding. |
| `worker/schema.sql` | D1 schema and indexes. |
| `worker/seed.sql` | Generated local data export. **Git-ignored and sensitive.** |
| `wrangler.jsonc` | Worker, Assets and D1 binding configuration. |
| `server/app.js` | Shared Express app; awaits repository calls so it works with sync SQLite and async D1. |
| `server/repos.js` | Local synchronous `node:sqlite` repositories. |
| `server/repos-d1.js` | Async D1 repositories with the same return shapes. |
| `server/index.js` | Local Node entry (`npm run dev:api` / `npm start`). |
| `scripts/export-d1-seed.mjs` | Exports `server/sbc.db` to `worker/seed.sql`. |
| `scripts/rotate-admin-pin.mjs` | Generates a new admin PIN, updates `.env`/`.dev.vars`, writes the PIN to `%TEMP%`. |
