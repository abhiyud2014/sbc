# How to run SBC-LMS

Two processes make up the app:

| Process | Command | Port | What it does |
|---|---|---|---|
| **API server** (Express) | `npm run dev:api` | **8787** | Zoom Server-to-Server OAuth proxy + LMS API. Holds the Zoom credentials from `.env`. |
| **Frontend** (Vite + React) | `npm run dev:web` | **5173** | The dashboard UI. Proxies `/api/*` to `http://localhost:8787`. |

Open the app at **http://localhost:5173** — never at port 8787 (that is the API only).

---

## 0. Prerequisites

- **Node.js 22.5+** (uses the built-in `fetch` and `node:sqlite`) — checked with `node --version`
- npm (ships with Node)
- A Zoom **Server-to-Server OAuth** app with scopes:
  `user:read:admin`, `meeting:read:admin`, `meeting:write:admin`, `report:read:admin`,
  `dashboard:read:admin`, `imchat:read:admin`, `imchat:write:admin`, `webinar:read:admin`

## 1. Configure the environment (once)

Create a `.env` file in the **project root** (`sbc-dashboard/.env` — not in `server/`):

```env
# Zoom Server-to-Server OAuth app credentials
ZOOM_ACCOUNT_ID=...
ZOOM_CLIENT_ID=...
ZOOM_CLIENT_SECRET=...

# Access control
ADMIN_PIN=choose-a-strong-pin   # admin sign-in PIN
#STUDENT_PASSCODE=        # optional: seeds the shared class password on boot (or set it in the UI)

# Optional
PORT=8787                 # API port (default 8787)
#DB_PATH=server/sbc.db    # SQLite file (default: server/sbc.db; set a mounted path in prod)
```

> The API fails to start (`Credentials: missing`) if the three Zoom values are absent.

### 1b. Database (one-time, if you have legacy JSON data)

All LMS data lives in **SQLite** (`server/sbc.db`, Node's built-in `node:sqlite`
— no native dependency). The API **creates and seeds the schema automatically**
on first start, so a fresh checkout needs nothing. If you're upgrading from the
old flat-JSON version and want to bring your existing students / batches /
questions / chats over, run the one-shot importer (idempotent, safe to re-run):

```powershell
npm run db:import         # server/*.json  ->  server/sbc.db
```

The `server/*.json` files are left in place as a backup archive. See
`er_diagram.md` for the full data model.

## 2a. Start BOTH at once (recommended)

```powershell
cd D:\zoom-sdk\sbc-dashboard
npm install     # first time only
npm run dev
```

You get both processes in one terminal (`web` + `api`), Vite on 5173, API on 8787.

## 2b. Start them separately (two terminals)

```powershell
# Terminal 1 — API server
cd D:\zoom-sdk\sbc-dashboard
npm run dev:api
#   SBC-LMS Zoom API proxy  ->  http://localhost:8787
#   Credentials: loaded from .env
```

```powershell
# Terminal 2 — Frontend
cd D:\zoom-sdk\sbc-dashboard
npm run dev:web
#   VITE ready  ->  http://localhost:5173
```

## 3. Verify both are up

```powershell
Invoke-RestMethod http://localhost:8787/api/health          # API directly
Invoke-RestMethod http://localhost:5173/api/health          # through the Vite proxy
Invoke-WebRequest http://localhost:5173 -UseBasicParsing    # frontend serves the app
```

All three should succeed (`ok = True` / HTTP 200).

## 4. Sign in

Open **http://localhost:5173**:

- **Admin** — enter the `ADMIN_PIN` from `.env`.
- **Student** — enter their **registered email + password**. The password is the
  shared **class password** you set as the admin under
  **Students & Batches → Class login password** (do this *before* students try
  to sign in — nothing works until one is set). Students can change it to a
  personal password from their account menu (top-right); you can reset any
  student's password from the key icon on their row.
- **One active device per student.** If they are signed in somewhere else, the
  second login shows “already signed in on another device”. If they lost that
  device, click the **sign-out icon** on their row in Students & Batches (or
  reset their password) to release the old session.
- Sign out from the account menu (top-right).

---

## Cloudflare Workers + D1 (production)

**Live:** https://sbc-traders-lms.abhiyud2014.workers.dev

The same app runs on Cloudflare instead of local Node + SQLite. The production
D1 database is already created and `wrangler.jsonc` already has its id; this is
the full first-time setup for a new environment:

```powershell
npm run build
npx wrangler login
npx wrangler d1 create sbc-lms          # only for a new environment
npx wrangler d1 execute sbc-lms --remote --file=worker/schema.sql
node scripts/export-d1-seed.mjs
npx wrangler d1 execute sbc-lms --remote --file=worker/seed.sql
npx wrangler secret put ZOOM_ACCOUNT_ID
npx wrangler secret put ZOOM_CLIENT_ID
npx wrangler secret put ZOOM_CLIENT_SECRET
npx wrangler secret put ADMIN_PIN
npx wrangler deploy
```

For local Worker testing (local D1, no production risk):

```powershell
npx wrangler d1 execute sbc-lms --local --file=worker/schema.sql
node scripts/export-d1-seed.mjs
npx wrangler d1 execute sbc-lms --local --file=worker/seed.sql
npx wrangler dev --port 8789
```

Full guide: **[`DEPLOY_CLOUDFLARE.md`](./DEPLOY_CLOUDFLARE.md)**.

> `worker/seed.sql` contains private student data and password hashes. It is
> git-ignored — never commit it.

## Stop

- Foreground/`npm run dev`: **Ctrl + C**
- If a port is still busy afterwards (Windows):

```powershell
foreach ($port in 5173, 8787) {
  $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($c) { Stop-Process -Id $c[0].OwningProcess -Force }
}
```

## Tests / build

```powershell
npm test          # 54 unit tests (Vitest + Testing Library)
npm run build     # production build into dist/
npm run preview   # serve the production build
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| API exits with `Credentials: missing` | `.env` must be in the **project root** with all three `ZOOM_*` values. A stray `server/.env` is ignored. |
| `EADDRINUSE` / port already in use | Something still listens on 5173 or 8787 — run the "Stop" snippet above, then start again. |
| Frontend shows sign-in loop / 401s | Your session expired (12 h TTL) or the token was revoked — sign in again. Sessions now **survive** restarts/deploys. |
| Student gets "No class password has been set yet" | Sign in as admin → **Students & Batches → Class login password** → set one and share it privately. |
| Student can't sign in / forgot password | Wrong email or password. If they changed it, the old class password no longer works for them — reset it from the key icon on their row (Students & Batches). |
| `SQLITE_CANTOPEN` / disk I/O error | The `DB_PATH` directory doesn't exist or isn't writable — create it or point `DB_PATH` at a writable location. |
| Old data missing after upgrade | Run `npm run db:import` once to migrate `server/*.json` into `server/sbc.db`. |
| Zoom calls return 401 | Check the S2S app's credentials, expiry (JWT valid ~60 min but the app auto-refreshes), and that the account is **SBC Traders** (host id `7o7A9SGnTrimjTZEU9yxIQ`). |
| Students don't see a class | The meeting must be created through the app (schedule → batch), never on the PMI, and registration must be enabled. |
