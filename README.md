# SBC-LMS — Zoom-integrated Trading Academy Dashboard

React + Vite + TailwindCSS front end with a small Express proxy that talks to the
Zoom **Server-to-Server OAuth** API using your app credentials.

The original single-file prototype (`virtual_trading_institution_lms_dashboard.html`)
is untouched and still opens on its own.

```
Browser (React, port 5173)
   └── /api/*  ──►  Express proxy (port 8787)  ──►  https://api.zoom.us/v2
                         │  holds Account ID / Client ID / Client Secret in .env
                         └── caches the OAuth access token until expiry
```

The credentials never reach the browser: Zoom blocks CORS on the token endpoint,
and shipping a client secret in frontend code would leak it to every visitor.

## Quick start

```bash
npm install
```

1. Copy `.env.example` → `.env` (already present) and paste in the three values
   from Zoom Marketplace → *Developed Apps* → **SBC-LMS** → *Server-to-Server OAuth App*:

   ```
   ZOOM_ACCOUNT_ID=...
   ZOOM_CLIENT_ID=...
   ZOOM_CLIENT_SECRET=...

   # Dashboard sign-in (light auth)
   ADMIN_PIN=choose-a-strong-pin
   # STUDENT_PASSCODE=choose-a-class-password  # optional: seeds the shared class password on boot
   ```

   The *Secret Token* is only needed if you later enable Zoom **webhooks**
   (signature validation); nothing here uses it yet.

2. Run both servers:

   ```bash
   npm run dev          # vite on :5173 + api on :8787
   # or separately:
   npm run dev:web
   npm run dev:api
   ```

3. Open <http://localhost:5173>. The sidebar pill turns **Connected** once
   `GET /users/me` succeeds.

Production build:

```bash
npm run build          # outputs dist/
npm start              # express serves dist/ + /api on :8787
```

## Sign-in (light auth)

No plaintext passwords anywhere — everything is stored as **scrypt hashes**.
Two roles sign in through the login screen:

| Role | Credential | Server check |
| --- | --- | --- |
| **Admin (Host)** | PIN | `admins.pin_hash` (scrypt hash, seeded from `ADMIN_PIN` in the project-root `.env` on first boot) |
| **Student (participant)** | registered **email + password** | student found by email in `students`; password checked against their **personal** `password_hash` if set, otherwise against the shared **class password** (scrypt hash in `settings`) |

**Class password + personal override** (admin-managed under
**Students & Batches**):

- The admin sets one **class password** (`PUT /api/class-password`) and shares
  it privately with the class — it scales to any batch size. Rotating it
  affects every student *without* a personal password; `GET /api/class-password`
  reports whether one is configured (the sign-in screen shows a clear error
  until one is set).
- A student can change their password from their **account menu**
  (`POST /api/auth/change-password`, current password required). Success stores
  a **personal** override (`students.password_hash`) that keeps working even
  after the class password is rotated — so nobody can sign in as them with the
  shared password.
- The admin can set/reset an individual student's password
  (`POST /api/students/:id/password` with `{ password }`; `''` clears it back to
  the class password). A reset also ends that student's active session. Only a
  boolean (`hasPersonalPassword`) is ever exposed over the API — never the hash.

How it works (`server/app.js` — shared by the local Node server and the
Cloudflare Worker):

- `POST /api/auth/login` issues a random **bearer token**; only its **sha256**
  is stored (in the `auth_sessions` table, 12 h TTL, revoked by
  `POST /api/auth/logout`). Sessions survive server restarts/deploys. The raw
  token is stored in the browser's `localStorage` (`sbc.token`) and attached to
  every `/api` call.
- **One active device per student.** A second student login is rejected with
  `409` until the first session signs out or expires (12 h). If a student loses
  their device, the admin can use the **sign-out icon** on their row
  (`DELETE /api/students/:id/sessions`) or reset their password — both end the
  old session so they can sign in again. Admin sessions are not limited.
- Everything under `/api` — except `/api/health`, `/api/config` and
  `/api/auth/*` — requires a valid token; **participants are default-denied**
  and may only read `recordings`, `materials`, `knowledge`, `my-classes`,
  `POST /questions` (chatbot logging) and touch **their own** chat conversation
  (`GET/PUT /api/chats/:key` — ownership is enforced server-side, so another
  student's or the admin's conversation returns `403`). Admin routes return `403`.
- A `401` response clears the token and returns the app to the sign-in screen
  (expired/revoked sessions are handled automatically).
- The admin's **"View the app as"** menu is a *preview*, not a role switch:
  the role always comes from the sign-in session, so a student cannot grant
  themselves admin access.

- The sign-in screen no longer fetches any roster: the old public
  `GET /api/auth/students` endpoint (which listed every student name) has been
  removed entirely. Students just type their email; nothing about the class is
  exposed before authentication.

## Data storage (SQLite locally, D1 on Cloudflare)

In local Node mode, all LMS data lives in a single **SQLite** file,
`server/sbc.db`, using Node's **built-in `node:sqlite`** driver — no native npm
dependency to compile on deploy. On Cloudflare, the same schema lives in **D1**.
The full data model is in [`er_diagram.md`](./er_diagram.md).

- **Schema + connection**: `server/db.js` (WAL mode, foreign keys on).
- **Repositories**: `server/repos.js` — the only code that talks SQL; returns
  the same shapes the flat JSON stores used, so routes are unchanged.
- **Cloudflare Workers**: the same routes run with an async **D1** repository
  layer (`server/repos-d1.js`), injected by `worker/index.js`. See
  [`DEPLOY_CLOUDFLARE.md`](./DEPLOY_CLOUDFLARE.md).
- **Override the location** with `DB_PATH` (e.g. a mounted volume in
  production): `DB_PATH=/data/sbc.db npm run dev:api`.
- **Migrate the old JSON files** (one-shot, idempotent, safe to re-run):

  ```powershell
  npm run db:import        # server/*.json  ->  server/sbc.db
  ```

  The `server/*.json` files are **not** deleted — keep them as a backup
  archive. On a fresh checkout the API seeds itself (materials, hashed admin
  PIN from `.env`) without needing an import.
- **Secrets** are hashed: the admin PIN, the class password and each
  student's personal password are stored as `scrypt` hashes (`admins`,
  `settings`, `students.password_hash`), and sessions store only the
  `sha256` of the bearer token — never the raw token.
- **Backups**: copy `server/sbc.db` (and `-wal`/`-shm` if present), or use a
  managed snapshot in production. Because writes are transactional, a crash
  mid-write can no longer truncate a store the way a half-written JSON file
  could.

## Deploy on Cloudflare Workers + D1

**Live deployment:** https://sbc-traders-lms.abhiyud2014.workers.dev

The app runs entirely on Cloudflare: Workers hosts the Express API on the Node
HTTP runtime, D1 replaces SQLite, and Workers Assets serves the built SPA.

The repo already contains the production D1 `database_id`, so a redeploy is:

```powershell
npm run build
npx wrangler deploy
```

To set up a **new** environment from scratch:

```powershell
npx wrangler login
npx wrangler d1 create sbc-lms       # copy database_id into wrangler.jsonc
npm run build
npx wrangler d1 execute sbc-lms --remote --file=worker/schema.sql
node scripts/export-d1-seed.mjs
npx wrangler d1 execute sbc-lms --remote --file=worker/seed.sql
npx wrangler secret put ZOOM_ACCOUNT_ID
npx wrangler secret put ZOOM_CLIENT_ID
npx wrangler secret put ZOOM_CLIENT_SECRET
npx wrangler secret put ADMIN_PIN
npx wrangler deploy
```

Full instructions, local Worker testing, GitHub auto-deploy, costs/limits and
troubleshooting: **[`DEPLOY_CLOUDFLARE.md`](./DEPLOY_CLOUDFLARE.md)**.

> `worker/seed.sql` contains private student data and password hashes. It is
> git-ignored — never commit it. See the security checklist in the deployment
> guide before making the repo public.

## What each screen calls

| Screen | Zoom endpoints used |
| --- | --- |
| Dashboard | `GET /users/me/meetings`, `GET /users`, `GET /users/me/recordings`, `GET /users/me/webinars`, `GET /users/me` (health) |
| Zoom Sessions | `GET/POST /users/me/meetings`, `GET/PATCH/DELETE /meetings/{id}`, `GET/POST /meetings/{id}/registrants`, `PATCH /meetings/{id}/registrants/status`, `GET /meetings/{id}/registration_questions` |
| Meeting Activity | `GET /report/users/me/meetings` (needs `report:read:user:admin`), `GET /past_meetings/{id}/participants` |
| Cloud Recordings | `GET /users/me/recordings`, `GET /meetings/{id}/recordings` |
| Students & Batches | SQLite locally / D1 on Workers (`students`, `batches`, junction) + `GET /report/users/{id}/meetings` + `GET /past_meetings/{uuid}/participants` (Attendance tab roster) |
| My Classes (participant) | `GET /users/me/meetings` (upcoming) + the cached roster for attended/absent history |
| Q&A Log | `GET /report/users/{id}/meetings` + `GET /past_meetings/{uuid}/qa` (opt-in sync) |
| Reference Hub / AI Bot | SQLite locally / D1 on Workers (`materials`, `knowledge`) — swap in a real LLM/CMS later |

Scope coverage of your app, all consumed:

- `meeting:write:meeting:admin` / `meeting:update:meeting:admin` / `meeting:delete:meeting:admin` / `meeting:read:meeting:admin` / `meeting:read:list_meetings:admin` → **Sessions CRUD**
- `meeting:write:registrant:admin` / `meeting:read:registrant:admin` / `meeting:read:list_registrants:admin` / `meeting:read:list_registration_questions:admin` → **Registrants modal**
- `meeting:read:past_meeting:admin` / `meeting:read:list_past_participants:admin` / `meeting:read:past_qa:admin` / `meeting:read:summary:admin` / `meeting:read:list_summaries:admin` → **past-meeting routes below**
- `cloud_recording:read:*` → **Cloud Recordings**
- `user:read:user:admin` / `user:read:list_users:admin` → **health check** (the roster itself is built from attendance, not licensed seats)
- `webinar:read:list_webinars:admin` / `webinar:read:list_registrants:admin` / `webinar:read:list_registration_questions:admin` → **Webinar routes**
- `device:read:command:admin` → use the passthrough (below)

### Routes exposed by the proxy

```
GET    /api/health
GET    /api/config
GET    /api/meetings?type=upcoming|previous|scheduled|live   POST /api/meetings
GET    /api/meetings/:id                           PATCH /api/meetings/:id     DELETE /api/meetings/:id
GET    /api/meetings/:id/registrants               POST /api/meetings/:id/registrants
PATCH  /api/meetings/:id/registrants/status
GET    /api/meetings/:id/registration_questions
GET    /api/meetings/:id/summaries
GET    /api/past-meetings/:id
GET    /api/past-meetings/:id/participants
GET    /api/past-meetings/:id/qa
GET    /api/past-meetings/:id/summary
GET    /api/recordings                             GET /api/recordings/meeting/:id
GET    /api/reports/meetings?from=YYYY-MM-DD&to=YYYY-MM-DD   (report:read:user:admin)
GET    /api/users                                  GET /api/users/:id
GET    /api/users/:userId/recordings
GET    /api/webinars                               GET /api/webinars/:id/registrants
```

LMS layer (role-based UI; data persisted in **SQLite** locally or **D1** on Cloudflare):

```
GET    /api/students                POST /api/students        PATCH/DELETE /api/students/:id
GET    /api/batches                 POST /api/batches         PATCH/DELETE /api/batches/:id
GET    /api/targets                                            PUT /api/meetings/:id/targets
POST   /api/meetings/:id/enroll     { batchIds }  → auto-enables registration (type 2/3),
                                                registers every student (top-level body),
                                                stores personalised join URLs
GET    /api/meetings/:id/attendance?uuid=  → expected (batches) vs joined w/ duration,
                                                absent, guests, batch assignment
GET    /api/questions?days=&zoom=1&refresh=1   POST /api/questions
PATCH  /api/questions/:id  { answer }  → mentor answers/corrects a logged question;
                                        original AI answer kept in `aiAnswer`; the edit
                                        is merged into the bot's answer pool, appears in
                                        the asker's chat history ("mentor-corrected" tag),
                                        and is served to anyone re-asking the question
POST   /api/questions/promote       GET /api/knowledge   (promoted pairs + mentor-edited answers)
GET    /api/chats/:key              chat conversation, SERVER-side (`admin` or a student id)
PUT    /api/chats/:key  { messages }  → replaces the history (last 60 kept); participants
                                        may only read/write their own key, so chats follow
                                        the user to any browser/device (localStorage only
                                        caches the last copy for instant paint)
GET    /api/my-classes?studentId=   → upcoming (personal join link) + attended/absent history
GET    /api/roster?days=&refresh=1  → attendance roll-up (cached 5 min)
GET    /api/materials               POST/PATCH/DELETE /api/materials[/:id]
GET    /api/coverage?days=
```

Anything else is reachable through the passthrough, which forwards to
`https://api.zoom.us/v2` with the same token:

```
GET /api/zoom/<any v2 path>          e.g. /api/zoom/devices/12345/commands   (device:read:command:admin)
```

## Notes & limitations

- **Embedding Zoom in the browser is not possible with these credentials.**
  The Web/Meeting SDK needs a separate *Meeting SDK* app (different client ID)
  plus a JWT signer. Join buttons open `https://zoom.us/j/<id>` instead.
- Registration (`registrants`) requires the meeting to be created with
  registration enabled — the create form has an **Enable registration** tickbox
  (`settings.registration_type: 1` = auto-approve).
- Recording download links are short-lived signed URLs from Zoom; the page
  always fetches fresh ones.
- Keep `.env` out of version control (already in `.gitignore`). If a credential
  is ever pasted into a chat, ticket or repo, **rotate it** in the marketplace.
