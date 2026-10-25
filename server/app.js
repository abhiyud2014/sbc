/**
 * SBC-LMS -> Zoom API proxy.
 *
 * Holds the Server-to-Server OAuth credentials (in .env, never shipped to the
 * browser), exchanges them for an access token (cached until shortly before
 * expiry) and exposes a small /api surface that the React app calls.
 *
 * Any Zoom endpoint that is not mapped explicitly can still be reached through
 * the passthrough:  GET/PATCH/POST /api/zoom/<zoom/v2 path>  e.g.
 * GET /api/zoom/devices/1234/commands   (device:read:command:admin)
 */
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';

/**
 * Which past instances did this student attend, according to the cached roster?
 *
 * Zoom keys a person by email when it has one and by display name when it does
 * not, so the SAME student can appear as two roster rows (e.g. one join with
 * email, another without). The admin attendance audit matches each join by
 * email OR name; My Classes must do the same and union every matching row,
 * otherwise joins recorded under the other row show up as "Absent".
 *
 * Returns two maps of MINUTES keyed by exact instance uuid and by
 * `id|start_time`. A plain meeting id is deliberately not used: Personal
 * Meeting Room rows share one id across many sessions, so id-only matching
 * would credit every instance.
 */
export function buildStudentAttendance(roster, student) {
  const wantedEmail = (student?.email || '').trim().toLowerCase();
  const wantedName = (student?.name || '').trim().toLowerCase();

  const meetings = [];
  for (const person of roster?.students || []) {
    const email = (person.email || '').trim().toLowerCase();
    const name = (person.name || '').trim().toLowerCase();
    const emailHit = Boolean(wantedEmail && email && email === wantedEmail);
    const nameHit = Boolean(wantedName && name && name === wantedName);
    if (emailHit || nameHit) meetings.push(...(person.meetings || []));
  }

  const byUuid = new Map();
  const byInstance = new Map();
  for (const meeting of meetings) {
    const minutes = Number(meeting.minutes) || 0;
    if (meeting.uuid) {
      const key = String(meeting.uuid);
      byUuid.set(key, (byUuid.get(key) || 0) + minutes);
    }
    const instance = `${meeting.id}|${meeting.start_time}`;
    byInstance.set(instance, (byInstance.get(instance) || 0) + minutes);
  }
  return { byUuid, byInstance };
}

/**
 * Attendance for one student from already-fetched participant rows.
 *
 * `participantsByKey` maps an instance key (`uuid` when Zoom gives one, else
 * the meeting id) to that instance's participant array. A key that is missing
 * means "not fetched yet" and is returned in `pending`, so the caller can say
 * "syncing" instead of wrongly reporting the student as Absent.
 *
 * Matching unions email and exact display name, because Zoom records the same
 * person twice when one join has an email and another does not.
 */
export function attendanceFromParticipants(instances, student, participantsByKey) {
  const wantedEmail = (student?.email || '').trim().toLowerCase();
  const wantedName = (student?.name || '').trim().toLowerCase();
  const byUuid = new Map();
  const byInstance = new Map();
  const pending = [];
  const lookup = (key) =>
    participantsByKey instanceof Map ? participantsByKey.get(key) : participantsByKey?.[key];

  for (const meeting of instances || []) {
    const key = String(meeting.uuid || meeting.id || '');
    const rows = lookup(key);
    if (rows === undefined || rows === null) {
      pending.push(key);
      continue;
    }

    let minutes = 0;
    let joined = false;
    for (const p of rows) {
      const email = (p.user_email || '').trim().toLowerCase();
      const name = (p.name || '').trim().toLowerCase();
      const emailHit = Boolean(wantedEmail && email && email === wantedEmail);
      const nameHit = Boolean(wantedName && name && name === wantedName);
      if (!emailHit && !nameHit) continue;
      joined = true;
      minutes += Math.round((Number(p.duration) || 0) / 60);
    }
    if (!joined) continue;

    if (meeting.uuid) byUuid.set(String(meeting.uuid), minutes);
    if (meeting.id && meeting.start_time) {
      byInstance.set(`${meeting.id}|${meeting.start_time}`, minutes);
    }
  }

  return { byUuid, byInstance, pending };
}

/**
 * Build the Express app around an injected repository set.
 *
 * `repos` is either the synchronous node:sqlite repositories (server/repos.js)
 * for local development or the async D1 repositories (server/repos-d1.js) on
 * Cloudflare Workers. Routes await every repository call, so both work.
 */
export function createApp({ repos, config = {}, staticDir = '' }) {
  const {
    students: studentsRepo,
    batches: batchesRepo,
    targets: targetsRepo,
    questions: questionsRepo,
    knowledge: knowledgeRepo,
    chats: chatsRepo,
    materials: materialsRepo,
    auth: authRepo,
  } = repos;

  const ZOOM_API = 'https://api.zoom.us/v2';

  const ACCOUNT_ID = String(config.zoomAccountId || '').trim();
  const CLIENT_ID = String(config.zoomClientId || '').trim();
  const CLIENT_SECRET = String(config.zoomClientSecret || '').trim();

class HttpError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

const hasCredentials = () => Boolean(ACCOUNT_ID && CLIENT_ID && CLIENT_SECRET);

/* ------------------------------------------------------------------ */
/* OAuth (Server-to-Server) with token caching                         */
/* ------------------------------------------------------------------ */

let tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
  if (!hasCredentials()) {
    throw new HttpError(
      500,
      'Zoom credentials are missing. Fill ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET in the .env file, then restart the API server.'
    );
  }

  // Refresh 60s before Zoom's own expiry.
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  let res;
  try {
    res = await fetch('https://zoom.us/oauth/token?grant_type=account_credentials', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ account_id: ACCOUNT_ID }),
    });
  } catch (err) {
    throw new HttpError(502, `Could not reach zoom.us for a token: ${err.message}`);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new HttpError(
      res.status,
      data.error_description ||
        data.reason ||
        `Zoom OAuth rejected the credentials (HTTP ${res.status}).`,
      data
    );
  }

  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
  return tokenCache.token;
}

/** Forward a request to api.zoom.us/v2 and normalise errors. */
async function zoom(apiPath, { method = 'GET', body, query } = {}) {
  const token = await getAccessToken();
  const url = new URL(ZOOM_API + apiPath);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new HttpError(502, `Could not reach api.zoom.us: ${err.message}`);
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    // Keep Zoom's own message so the UI can show something actionable.
    const message =
      data?.error?.message || data?.message || data?.reason || `Zoom API error (HTTP ${res.status}).`;
    throw new HttpError(res.status, message, data);
  }

  return data;
}

/**
 * Follow Zoom's next_page_token until the list is exhausted, so callers get
 * the COMPLETE list instead of a single page (Zoom caps page_size at 300 and
 * defaults to 30 for past-meeting participants).
 */
async function zoomAllPages(apiPath, { query = {}, listKey, maxPages = 10 } = {}) {
  let token = '';
  const items = [];
  let total = 0;
  let last = {};
  let pages = 0;

  do {
    const data = await zoom(apiPath, { query: { ...query, next_page_token: token } });
    last = data || {};
    items.push(...(last[listKey] || []));
    total = Number.isFinite(last.total_records) ? last.total_records : items.length;
    token = last.next_page_token || '';
    pages += 1;
  } while (token && pages < maxPages);

  return { ...last, [listKey]: items, total_records: total, aggregated_pages: pages };
}

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Zoom uuids can contain `/`, so they must be double-encoded in the path. */
const encodeMeetingKey = (key) => encodeURIComponent(encodeURIComponent(String(key)));

/* ------------------ per-instance participant cache ----------------- */
/**
 * A Workers invocation may only make ~50 subrequests on the free plan, and
 * the meeting report needs ONE participants call per past session. A 30-day
 * roster (170+ sessions) therefore cannot finish in a single request: the
 * platform starts rejecting fetches and the old code silently treated those
 * sessions as "nobody attended".
 *
 * Cache participant rows per instance instead, fetch only what is missing,
 * and surface anything unfetched as "pending" rather than "Absent". Repeated
 * polls and My Classes visits advance the backfill.
 */
const PARTICIPANT_CACHE_MS = Number(config.participantCacheMs || 10 * 60_000);
const PARTICIPANT_CACHE_MAX = 300;
/** Leave ~15 subrequests of headroom for token/report/host lookups. */
const ROSTER_FETCH_BUDGET = Number(config.rosterFetchBudget || 30);
const ATTENDANCE_FETCH_BUDGET = Number(config.attendanceFetchBudget || 30);
const participantCache = new Map();

const participantKey = (meeting) => String(meeting?.uuid || meeting?.id || '');

/** Cached participant rows for an instance, or null when absent/stale. */
const readParticipantCache = (key) => {
  const k = String(key || '');
  const hit = participantCache.get(k);
  if (!hit) return null;
  if (Date.now() - hit.at > PARTICIPANT_CACHE_MS) {
    participantCache.delete(k);
    return null;
  }
  return hit.participants;
};

const writeParticipantCache = (key, participants) => {
  const k = String(key || '');
  participantCache.delete(k);
  participantCache.set(k, { at: Date.now(), participants });
  while (participantCache.size > PARTICIPANT_CACHE_MAX) {
    participantCache.delete(participantCache.keys().next().value);
  }
};

async function fetchParticipantsFor(meeting) {
  const key = participantKey(meeting);
  const data = await zoomAllPages(
    `/past_meetings/${encodeMeetingKey(meeting.uuid || meeting.id)}/participants`,
    { query: { page_size: 300 }, listKey: 'participants' }
  );
  const participants = data.participants || [];
  writeParticipantCache(key, participants);
  return participants;
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

const app = express();
app.use(cors());
app.use(express.json());

// Tiny request log (skips the noisy health poll).
app.use((req, _res, next) => {
  if (!req.path.includes('/health')) {
    console.log(`[api] ${req.method} ${req.originalUrl}`);
  }
  next();
});

const wrap = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

/* --------------------------- data stores --------------------------- */
/**
 * Repositories are injected by the runtime:
 *   local Node  -> server/repos.js (synchronous node:sqlite)
 *   Workers     -> server/repos-d1.js (async D1)
 * Boot-time seeding lives in the entry points, not in the route module.
 */

/**
 * List meetings for a user. Zoom's `previous`/`upcoming` filters are not
 * trustworthy (see partitionMeetings), so those two requests are served from
 * Zoom's own `scheduled` list and split by end time here.
 */
const listMeetings = async (userId, query = {}) => {
  const requested = meetingQuery(query).type;
  const trustworthy = requested !== 'previous' && requested !== 'upcoming';

  const data = await zoom(`/users/${userId}/meetings`, {
    query: trustworthy ? meetingQuery(query) : { ...meetingQuery(query), type: 'scheduled' },
  });

  if (trustworthy) return data;

  const meetings = partitionMeetings(data.meetings || [], requested);
  return { ...data, meetings, total_records: meetings.length };
};

const mask = (value, keep = 4) =>
  value ? `${value.slice(0, keep)}${'*'.repeat(Math.max(4, value.length - keep))}` : '';

/* ---------------------------- status ----------------------------- */

app.get(
  '/api/health',
  wrap(async (_req, res) => {
    if (!hasCredentials()) {
      return res.status(500).json({
        ok: false,
        configured: false,
        message: 'No Zoom credentials in .env (ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET).',
      });
    }
    try {
      const me = await zoom('/users/me');
      return res.json({
        ok: true,
        configured: true,
        account: { id: me.id, email: me.email, name: `${me.first_name ?? ''} ${me.last_name ?? ''}`.trim() },
        tokenExpiresIn: Math.max(0, Math.round((tokenCache.expiresAt - Date.now()) / 1000)),
      });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        configured: true,
        message: err.message,
        detail: err.detail,
      });
    }
  })
);

app.get('/api/config', (_req, res) => {
  res.json({
    accountId: mask(ACCOUNT_ID, 4),
    clientId: mask(CLIENT_ID, 4),
    clientSecret: CLIENT_SECRET ? '••••••••' : '',
    configured: hasCredentials(),
    authType: 'Server-to-Server OAuth',
    endpoints: { api: ZOOM_API, oauth: 'https://zoom.us/oauth/token' },
  });
});

/* --------------------- sign-in / sessions (light) ------------------ */
/**
 * Light authentication — no user-password database:
 *
 *   Admin         signs in with a PIN       (ADMIN_PIN in server/.env)
 *   Participant   signs in by picking their enrolled name, optionally
 *                 gated by one shared class passcode (STUDENT_PASSCODE)
 *
 * A successful sign-in issues a random bearer token held server-side in
 * memory (12h TTL, revoked on sign-out). Everything under /api after the
 * gate below requires a valid token; participants are further restricted
 * to a small read-only surface (recordings, materials, their own class
 * history) plus chatbot question logging.
 *
 * The token is NOT an authority for admin actions: role comes from the
 * server session, never from the client.
 */
/**
 * Sessions live in the database (survive restarts/deploys) and only the
 * sha256 of the bearer token is stored. The PIN / class passcode are scrypt
 * hashes seeded by the entry point (server/index.js locally,
 * worker/index.js on Cloudflare).
 */
const issueToken = async (role, studentId = null) => {
  const token = crypto.randomBytes(24).toString('hex');
  await authRepo.createSession(token, role, studentId);
  return token;
};

/** Students get exactly one active device/browser at a time. */
const issueStudentToken = async (studentId) => {
  const token = crypto.randomBytes(24).toString('hex');
  if (!(await authRepo.createStudentSession(token, studentId))) {
    throw new HttpError(
      409,
      'This account is already signed in on another device. Sign out there first, or ask your mentor to end that session.'
    );
  }
  return token;
};

const sessionFrom = async (req) => {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const session = await authRepo.getSession(token);
  if (!session) return null;
  let user = { name: '', email: '' }; // admin identity comes from /health after sign-in
  if (session.role === 'participant') {
    const student = await studentsRepo.get(session.studentId || '');
    user = student ? { id: student.id, name: student.name, email: student.email || '' } : null;
  }
  if (!user) {
    await authRepo.revokeSession(token); // student was deleted mid-session
    return null;
  }
  return { token, role: session.role, user };
};

app.post(
  '/api/auth/login',
  wrap(async (req, res) => {
    const { role, pin, email, password } = req.body || {};

    if (String(role) === 'admin') {
      if (!(await authRepo.hasAdminPin())) {
        throw new HttpError(
          500,
          'ADMIN_PIN is not set on the server — add ADMIN_PIN=<code> to the .env file in the project root and restart the API.'
        );
      }
      if (!(await authRepo.verifyAdminPin(String(pin ?? '').trim()))) {
        throw new HttpError(401, 'Incorrect admin PIN.');
      }
      const user = { name: '', email: '' }; // identity comes from /health after sign-in
      return res.json({ token: await issueToken('admin'), role: 'admin', user });
    }

    if (String(role) === 'participant') {
      const mail = String(email || '').trim().toLowerCase();
      const pass = String(password ?? '');
      if (!mail) throw new HttpError(400, 'Enter the email your mentor registered for you.');
      if (!EMAIL_RE.test(mail)) throw new HttpError(400, 'That is not a valid email address.');

      // Deliberately generic: never reveal whether an email is enrolled.
      const student = await studentsRepo.find(mail);
      if (!student) throw new HttpError(401, 'Email or password is incorrect.');

      const verdict = await authRepo.checkStudentPassword(student.id, pass);
      if (verdict === 'unprovisioned') {
        throw new HttpError(
          400,
          'No class password has been set yet — ask your mentor to set one (Students & Batches → Class login password).'
        );
      }
      if (verdict !== 'ok') throw new HttpError(401, 'Email or password is incorrect.');

      const user = { id: student.id, name: student.name, email: student.email || '' };
      return res.json({
        token: await issueStudentToken(student.id),
        role: 'participant',
        user,
      });
    }

    throw new HttpError(400, 'Choose Admin or Student to sign in.');
  })
);

/**
 * Student self-service password change. The CURRENT password is required
 * (a stolen session can't lock the real student out), and success stores a
 * PERSONAL override that keeps working across class-password rotations.
 */
app.post(
  '/api/auth/change-password',
  wrap(async (req, res) => {
    const session = await sessionFrom(req);
    if (!session) throw new HttpError(401, 'Not signed in. Please sign in again.');
    if (session.role !== 'participant') {
      throw new HttpError(403, 'The admin signs in with a PIN — there is no password to change.');
    }
    const current = String(req.body?.currentPassword ?? '');
    const next = String(req.body?.newPassword ?? '').trim();
    if (next.length < 6) throw new HttpError(400, 'Use at least 6 characters for the new password.');
    if (next === current) throw new HttpError(400, 'The new password must be different from the current one.');
    if ((await authRepo.checkStudentPassword(session.user.id, current)) !== 'ok') {
      throw new HttpError(400, 'Your current password is incorrect.');
    }
    await authRepo.setStudentPassword(session.user.id, next);
    res.json({ ok: true, hasPersonalPassword: true });
  })
);

app.get(
  '/api/auth/me',
  wrap(async (req, res) => {
    const session = await sessionFrom(req);
    if (!session) return res.status(401).json({ error: 'Not signed in.' });
    res.json({ role: session.role, user: session.user });
  })
);

app.post(
  '/api/auth/logout',
  wrap(async (req, res) => {
    const session = await sessionFrom(req);
    if (session) await authRepo.revokeSession(session.token);
    res.json({ ok: true });
  })
);

/* ---------------------------- access gate ------------------------- */
/**
 * Everything registered AFTER this middleware needs a signed-in session.
 * Public: /api/health, /api/config, /api/auth/* (registered above).
 *
 * Participants (default deny) may only:
 *   GET  /api/recordings…  /api/materials  /api/knowledge  /api/my-classes
 *   POST /api/questions    (chatbot question logging with attribution)
 *   GET/PUT /api/chats/*   (own conversation only — enforced in the route)
 */
const PARTICIPANT_READ = /^\/api\/(recordings|materials|knowledge|my-classes)(\/|$)/;

app.use(
  wrap(async (req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    const session = await sessionFrom(req);
    if (!session) return res.status(401).json({ error: 'Not signed in. Please sign in again.' });
    req.session = session;
    if (session.role === 'admin') return next();
    const allowed =
      (req.method === 'GET' && PARTICIPANT_READ.test(req.path)) ||
      (req.method === 'POST' && req.path === '/api/questions') ||
      req.path.startsWith('/api/chats/'); // ownership checked in the chat routes
    if (allowed) return next();
    res.status(403).json({ error: 'This area is admin-only.' });
  })
);

/* --------------------------- meetings ---------------------------- */

/**
 * Zoom's List Meetings endpoint filters on `type`, NOT `status`:
 *   scheduled (default) | live | upcoming | previous
 * `status=upcoming|previous` is accepted here as an alias for backward
 * compatibility and mapped to the real parameter.
 */
const meetingQuery = (query = {}) => ({
  type: query.type || query.status,
  page_size: query.page_size || 100,
});

/**
 * Zoom's own `type=previous` filter is unreliable — it has been observed
 * returning meetings that have not started yet (a meeting starting in ten
 * hours came back under `previous`). So we never trust it: we ask Zoom for
 * `scheduled` (the full list) and partition by each meeting's END time.
 *
 * A meeting is "past" once start_time + duration has elapsed.
 */
const meetingEndsAt = (m) => {
  const start = new Date(m.start_time).getTime();
  return Number.isFinite(start) ? start + (Number(m.duration) || 0) * 60_000 : start;
};

const partitionMeetings = (meetings = [], type, now = Date.now()) => {
  if (type !== 'previous' && type !== 'upcoming') return meetings;
  return meetings.filter((m) => {
    const ended = meetingEndsAt(m) <= now;
    return type === 'previous' ? ended : !ended;
  });
};

// List meetings for a user (default: "me").
app.get(
  '/api/users/:userId/meetings',
  wrap(async (req, res) => {
    res.json(await listMeetings(req.params.userId, req.query));
  })
);

app.post(
  '/api/users/:userId/meetings',
  wrap(async (req, res) => {
    const data = await zoom(`/users/${req.params.userId}/meetings`, {
      method: 'POST',
      body: req.body,
    });
    res.status(201).json(data);
  })
);

// Convenience alias for the host account.
app.get(
  '/api/meetings',
  wrap(async (req, res) => {
    res.json(await listMeetings('me', req.query));
  })
);

app.post(
  '/api/meetings',
  wrap(async (req, res) => {
    const data = await zoom('/users/me/meetings', { method: 'POST', body: req.body });
    res.status(201).json(data);
  })
);

app.get(
  '/api/meetings/:id',
  wrap(async (req, res) => res.json(await zoom(`/meetings/${req.params.id}`, { query: req.query })))
);

app.patch(
  '/api/meetings/:id',
  wrap(async (req, res) =>
    res.json(await zoom(`/meetings/${req.params.id}`, { method: 'PATCH', body: req.body }))
  )
);

app.delete(
  '/api/meetings/:id',
  wrap(async (req, res) => {
    await zoom(`/meetings/${req.params.id}`, { method: 'DELETE' });
    // Drop the batch assignment + personalised join links with it (cascades).
    await targetsRepo.clear(String(req.params.id));
    res.status(204).end();
  })
);

/* -------------------------- registrants -------------------------- */

app.get(
  '/api/meetings/:id/registrants',
  wrap(async (req, res) =>
    res.json(
      await zoomAllPages(`/meetings/${req.params.id}/registrants`, {
        query: { page_size: req.query.page_size || 300, status: req.query.status },
        listKey: 'registrants',
      })
    )
  )
);

app.post(
  '/api/meetings/:id/registrants',
  wrap(async (req, res) =>
    res.json(await zoom(`/meetings/${req.params.id}/registrants`, { method: 'POST', body: req.body }))
  )
);

app.patch(
  '/api/meetings/:id/registrants/status',
  wrap(async (req, res) =>
    res.json(
      await zoom(`/meetings/${req.params.id}/registrants/status`, {
        method: 'PATCH',
        body: req.body,
      })
    )
  )
);

app.get(
  '/api/meetings/:id/registration_questions',
  wrap(async (req, res) =>
    res.json(await zoom(`/meetings/${req.params.id}/registration_questions`))
  )
);

/* ------------------------- past meetings ------------------------- */

app.get(
  '/api/past-meetings/:id',
  wrap(async (req, res) => res.json(await zoom(`/past_meetings/${req.params.id}`)))
);

app.get(
  '/api/past-meetings/:id/participants',
  wrap(async (req, res) =>
    res.json(
      await zoomAllPages(`/past_meetings/${req.params.id}/participants`, {
        query: { page_size: req.query.page_size || 300, include_fields: req.query.include_fields },
        listKey: 'participants',
      })
    )
  )
);

app.get(
  '/api/past-meetings/:id/qa',
  wrap(async (req, res) => res.json(await zoom(`/past_meetings/${req.params.id}/qa`)))
);

app.get(
  '/api/past-meetings/:id/summary',
  wrap(async (req, res) => res.json(await zoom(`/past_meetings/${req.params.id}/summary`)))
);

app.get(
  '/api/meetings/:id/summaries',
  wrap(async (req, res) => res.json(await zoom(`/meetings/${req.params.id}/summaries`)))
);

/* -------------------------- recordings --------------------------- */
/**
 * Zoom's recording list defaults to the CURRENT DAY when no range is sent, and
 * rejects/clamps windows wider than about a month. A request without
 * `from`/`to` therefore goes empty as soon as the newest recording is more than
 * a day old - which made Cloud Recordings say "no recordings yet". Default to a
 * wide window, walk it in <=30-day chunks, and page through every chunk.
 */
const DAY = 86_400_000;
const RECORDING_WINDOW_DAYS = 90;
const RECORDING_CHUNK_DAYS = 30;

const isoDate = (value) => {
  const at = value ? new Date(value) : new Date();
  return (Number.isFinite(at.getTime()) ? at : new Date()).toISOString().slice(0, 10);
};

const listRecordings = async (userId, { from, to, trash, page_size: pageSize } = {}) => {
  const endInput = to ? new Date(to) : new Date();
  const anchor = Number.isFinite(endInput.getTime()) ? endInput : new Date();
  const end = new Date(`${isoDate(anchor)}T00:00:00Z`).getTime();
  const startInput = from ? new Date(from) : new Date(anchor.getTime() - RECORDING_WINDOW_DAYS * DAY);
  const startDate = Number.isFinite(startInput.getTime()) ? startInput : new Date(anchor.getTime() - RECORDING_WINDOW_DAYS * DAY);
  const start = new Date(`${isoDate(startDate)}T00:00:00Z`).getTime();

  const chunks = [];
  for (let cursor = start; cursor <= end; cursor += RECORDING_CHUNK_DAYS * DAY) {
    const stop = Math.min(cursor + (RECORDING_CHUNK_DAYS - 1) * DAY, end);
    chunks.push({ from: isoDate(cursor), to: isoDate(stop) });
  }

  const byKey = new Map();
  let pages = 0;
  let last = {};
  for (const chunk of chunks) {
    const data = await zoomAllPages(`/users/${userId}/recordings`, {
      query: { ...chunk, page_size: pageSize || 300, ...(trash ? { trash } : {}) },
      listKey: 'meetings',
      maxPages: 10,
    });
    last = last && Object.keys(last).length ? last : data;
    pages += data.aggregated_pages || 1;
    for (const meeting of data.meetings || []) {
      byKey.set(String(meeting.uuid || `${meeting.id}:${meeting.start_time}`), meeting);
    }
  }

  const meetings = [...byKey.values()].sort(
    (a, b) => new Date(b.start_time || 0) - new Date(a.start_time || 0)
  );

  return {
    ...last,
    from: isoDate(start),
    to: isoDate(end),
    meetings,
    total_records: meetings.length,
    next_page_token: '',
    aggregated_pages: pages,
  };
};

app.get(
  '/api/users/:userId/recordings',
  wrap(async (req, res) => res.json(await listRecordings(req.params.userId, req.query)))
);

app.get(
  '/api/recordings',
  wrap(async (req, res) => res.json(await listRecordings('me', req.query)))
);

app.get(
  '/api/recordings/meeting/:id',
  wrap(async (req, res) => res.json(await zoom(`/meetings/${req.params.id}/recordings`)))
);

/* ---------------------------- users ------------------------------ */

app.get(
  '/api/users',
  wrap(async (req, res) =>
    res.json(
      await zoom('/users', {
        query: {
          status: req.query.status,
          page_size: req.query.page_size || 300,
          role_id: req.query.role_id,
        },
      })
    )
  )
);

app.get(
  '/api/users/:id',
  wrap(async (req, res) => res.json(await zoom(`/users/${req.params.id}`)))
);

/* --------------------------- webinars ---------------------------- */

app.get(
  '/api/users/:userId/webinars',
  wrap(async (req, res) =>
    res.json(await zoom(`/users/${req.params.userId}/webinars`, { query: { page_size: 100 } }))
  )
);

app.get(
  '/api/webinars',
  wrap(async (req, res) => res.json(await zoom('/users/me/webinars', { query: { page_size: 100 } })))
);

app.get(
  '/api/webinars/:id/registrants',
  wrap(async (req, res) =>
    res.json(await zoom(`/webinars/${req.params.id}/registrants`, { query: req.query }))
  )
);

app.get(
  '/api/webinars/:id/registration_questions',
  wrap(async (req, res) => res.json(await zoom(`/webinars/${req.params.id}/registration_questions`)))
);

/* ---------------------------- reports ----------------------------- */
/**
 * The report API rejects the literal "me" alias, so resolve it to the
 * host's real Zoom user ID (cached after the first lookup).
 */
let hostUserId = null;

const resolveUserId = async (requested) => {
  if (requested && requested !== 'me') return requested;
  if (!hostUserId) {
    const me = await zoom('/users/me');
    hostUserId = me.id;
  }
  return hostUserId;
};

/**
 * Complete meeting report for a date range. Zoom returns the OLDEST instances
 * first and caps a page at 300, so a single request can hide the most recent
 * sessions in a busy month. Follow `next_page_token` until the list is whole.
 */
const listReportMeetings = async ({ from, to, requestedUserId, pageSize = 300 } = {}) => {
  const userId = await resolveUserId(requestedUserId);
  return zoomAllPages(`/report/users/${userId}/meetings`, {
    query: { from, to, page_size: pageSize },
    listKey: 'meetings',
    maxPages: 10,
  });
};

/**
 * Chronological list of meetings held in a date range (Zoom's "meeting
 * report"). Requires the `report:read:user:admin` scope. Max range: 1 month.
 */
app.get(
  '/api/reports/meetings',
  wrap(async (req, res) => {
    const data = await listReportMeetings({
      from: req.query.from,
      to: req.query.to,
      requestedUserId: req.query.user_id,
      pageSize: req.query.page_size || 300,
    });
    res.json(data);
  })
);

/* --------------------------- student roster ------------------------ */
/**
 * Build a REAL student roster from attendance.
 *
 * `GET /users` only lists Zoom-licensed seats (on this account: the admin),
 * which is useless as an LMS roster — students join as guests. So we start
 * from the meeting report (which sessions actually happened) and pull the
 * participant list for each one, then roll those up per person.
 *
 * This costs one Zoom call per past session, so the result is cached
 * (default 5 min) and rebuilt lazily.
 *
 *   GET /api/roster?days=30&refresh=1
 */
const ROSTER_CACHE_MS = Number(config.rosterCacheMs || 5 * 60_000);
let rosterCache = { at: 0, key: null, payload: null };

/**
 * The authenticated host's identity (cached5 min) — used to keep the mentor
 * out of every attendance roll-up. Matching is on lowercase email, falling
 * back to name because Zoom often omits email for the session host.
 */
let hostIdentityCache = { at: 0, value: { email: '', name: '' } };

async function hostIdentity() {
  if (hostIdentityCache.value && Date.now() - hostIdentityCache.at < 5 * 60_000) {
    return hostIdentityCache.value;
  }
  let value = { email: '', name: '' };
  try {
    const me = await zoom('/users/me');
    value = {
      email: (me.email || '').trim().toLowerCase(),
      name: `${me.first_name ?? ''} ${me.last_name ?? ''}`.trim().toLowerCase(),
    };
  } catch {
    /* non-fatal: we just won't filter the host out */
  }
  hostIdentityCache = { at: Date.now(), value };
  return value;
}

/** Zoom rejects ranges longer than a month — split into <=31d chunks. */
function chunkRange(fromDate, toDate) {
  const chunks = [];
  const DAY = 86_400_000;
  let start = new Date(`${fromDate}T00:00:00Z`).getTime();
  const end = new Date(`${toDate}T00:00:00Z`).getTime();
  while (start <= end) {
    const stop = Math.min(start + 31 * DAY - 1, end);
    chunks.push({ from: new Date(start).toISOString().slice(0, 10), to: new Date(stop).toISOString().slice(0, 10) });
    start = stop + 1;
  }
  return chunks;
}

async function buildRoster(days) {
  const userId = await resolveUserId();
  const to = new Date();
  const from = new Date(Date.now() - days * 86_400_000);

  // The host account (and anyone Zoom reports as a panelist) is not a
  // student — exclude the authenticated host from the roll-up.
  const { email: hostEmail, name: hostName } = await hostIdentity();

  // 1) Which sessions happened in the window?
  const meetings = [];
  for (const chunk of chunkRange(from.toISOString().slice(0, 10), to.toISOString().slice(0, 10))) {
    const data = await zoom(`/report/users/${userId}/meetings`, {
      query: { from: chunk.from, to: chunk.to, page_size: 300 },
    });
    meetings.push(...(data.meetings || []));
  }

  // 2) Who attended each one? One Zoom call per instance, but a Workers
  // invocation cannot make 170+ subrequests, so reuse the per-instance cache
  // and fetch a bounded number of uncached instances per build. Repeated
  // polls advance the backfill; sessions not fetched yet are reported as
  // pending instead of being silently treated as empty.
  const toFetch = [];
  for (const m of meetings) {
    if (toFetch.length >= ROSTER_FETCH_BUDGET) break;
    if (!readParticipantCache(participantKey(m))) toFetch.push(participantKey(m));
  }
  const fetchable = new Set(toFetch);

  const rows = await mapLimit(meetings, 4, async (m) => {
    const key = participantKey(m);
    const cached = readParticipantCache(key);
    if (cached) return { meeting: m, participants: cached };
    if (!fetchable.has(key)) return { meeting: m, participants: null };
    try {
      return { meeting: m, participants: await fetchParticipantsFor(m) };
    } catch {
      // Some instances have no participant detail available — skip, don't fail.
      return { meeting: m, participants: null };
    }
  });

  // 3) Roll up per person. Keyed by email when we have it, else by name.
  // NOTE: Zoom's participant `duration` is in SECONDS (join 14:23:17 ->
  // leave 14:26:21 returns 184). The meeting report's `duration` is minutes.
  const people = new Map();
  let joinRecords = 0;
  let pendingSessions = 0;

  for (const { meeting, participants } of rows) {
    // null = participant rows not fetched yet (budget/limit); counting those
    // as "nobody joined" is what made attendance look empty in production.
    if (participants === null) {
      pendingSessions += 1;
      continue;
    }
    for (const p of participants) {
      const personEmail = (p.user_email || '').trim().toLowerCase();
      const personName = (p.name || '').trim().toLowerCase();
      // Skip the host account — not a student. (Zoom does not send
      // user_type on this endpoint, so match on the authenticated
      // host's email, falling back to their name when Zoom omits email.)
      if (hostEmail && personEmail === hostEmail) continue;
      if (!personEmail && hostName && personName === hostName) continue;

      joinRecords += 1;
      const email = (p.user_email || '').trim().toLowerCase();
      const key = email || `name:${(p.name || 'unknown').trim().toLowerCase()}`;
      const minutes = Math.round((Number(p.duration) || 0) / 60);

      const found = people.get(key);
      if (!found) {
        people.set(key, {
          key,
          name: (p.name || 'Unknown').trim(),
          email: p.user_email || '',
          sessions: 1,
          joins: 1,
          totalMinutes: minutes,
          longestMinutes: minutes,
          firstAttended: meeting.start_time,
          lastAttended: meeting.start_time,
          meetings: [{ id: meeting.id, uuid: meeting.uuid, topic: meeting.topic, start_time: meeting.start_time, minutes }],
        });
        continue;
      }

      found.joins += 1;
      found.totalMinutes += minutes;
      found.longestMinutes = Math.max(found.longestMinutes, minutes);
      if (p.name && (!found.name || found.name === 'Unknown')) found.name = p.name.trim();
      if (p.user_email && !found.email) found.email = p.user_email;

      // "sessions" counts distinct meetings attended, not rejoin attempts.
      const alreadyCounted = found.meetings.some((mm) => (mm.uuid || mm.id) === (meeting.uuid || meeting.id));
      if (!alreadyCounted) {
        found.sessions += 1;
        found.meetings.push({
          id: meeting.id,
          uuid: meeting.uuid,
          topic: meeting.topic,
          start_time: meeting.start_time,
          minutes,
        });
      } else {
        const entry = found.meetings.find((mm) => (mm.uuid || mm.id) === (meeting.uuid || meeting.id));
        entry.minutes += minutes;
      }

      if (new Date(meeting.start_time) < new Date(found.firstAttended)) found.firstAttended = meeting.start_time;
      if (new Date(meeting.start_time) > new Date(found.lastAttended)) found.lastAttended = meeting.start_time;
    }
  }

  const students = [...people.values()]
    .map((p) => ({
      ...p,
      avgMinutes: p.sessions ? Math.round(p.totalMinutes / p.sessions) : 0,
      meetings: p.meetings.sort((a, b) => new Date(b.start_time) - new Date(a.start_time)),
    }))
    .sort((a, b) => b.totalMinutes - a.totalMinutes);

  return {
    generatedAt: new Date().toISOString(),
    windowDays: days,
    sessionsAnalyzed: meetings.length,
    joinRecords,
    // Sessions whose participant rows the platform cache has not fetched yet.
    // Consumers should show "syncing" rather than "absent" for these.
    pendingSessions,
    // Session list (what actually happened) so consumers like My Classes can
    // cross-reference targeted batches against real sessions without a second
    // Zoom walk. Report `duration` is MINUTES (participants' is seconds).
    sessions: meetings
      .map((m) => ({
        id: m.id,
        uuid: m.uuid,
        topic: m.topic,
        start_time: m.start_time,
        duration: m.duration,
        participants: m.participants_count ?? m.participants ?? null,
      }))
      .sort((a, b) => new Date(b.start_time) - new Date(a.start_time)),
    students,
    totalStudents: students.length,
  };
}

/** Cached roster fetch shared by /api/roster and /api/my-classes. */
async function getRoster(days, force = false) {
  const key = `days:${days}`;
  const fresh =
    rosterCache.payload && rosterCache.key === key && Date.now() - rosterCache.at < ROSTER_CACHE_MS;
  if (fresh && !force) {
    return {
      ...rosterCache.payload,
      cached: true,
      cacheAgeSeconds: Math.round((Date.now() - rosterCache.at) / 1000),
    };
  }
  const payload = await buildRoster(days);
  rosterCache = { at: Date.now(), key, payload };
  return { ...payload, cached: false };
}

app.get(
  '/api/roster',
  wrap(async (req, res) => {
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    res.json(await getRoster(days, force));
  })
);

/* ------------------------- recording coverage --------------------- */
/**
 * Which recent sessions have a cloud recording and which don't.
 *
 * Students constantly ask "where's the replay?" — this answers it in one
 * call. Cross-references the meeting report (what happened) against the
 * recording list (what was captured). Matched by meeting id first, then by
 * uuid, because Zoom's two lists don't always agree on the format.
 *
 *   GET /api/coverage?days=14
 */
app.get(
  '/api/coverage',
  wrap(async (req, res) => {
    const days = Math.max(1, Math.min(31, Number(req.query.days) || 14));
    const userId = await resolveUserId();
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

    const report = await zoom(`/report/users/${userId}/meetings`, {
      query: { from, to, page_size: 300 },
    });
    const rec = await zoom('/users/me/recordings', {
      query: { from, to, page_size: 300 },
    });

    // Index recordings by uuid (exact instance) and by id.
    const recUuids = new Set();
    const recIds = new Set();
    for (const m of rec.meetings || []) {
      if (m.uuid) recUuids.add(String(m.uuid));
      if (m.id) recIds.add(String(m.id));
    }

    // PMI meetings (e.g. a personal meeting room) all share ONE meeting id,
    // so matching by id would mark every instance recorded when only one
    // was. Only trust the id match when that id is not shared by several
    // report rows — otherwise require a uuid (exact-instance) match.
    const idCounts = new Map();
    for (const m of report.meetings || []) {
      const id = String(m.id);
      idCounts.set(id, (idCounts.get(id) || 0) + 1);
    }

    const sessions = (report.meetings || [])
      .map((m) => {
        const uuidHit = m.uuid ? recUuids.has(String(m.uuid)) : false;
        const idHit = recIds.has(String(m.id)) && (idCounts.get(String(m.id)) || 0) === 1;
        return {
          id: m.id,
          uuid: m.uuid,
          topic: m.topic,
          start_time: m.start_time,
          duration: m.duration,
          participants: m.participants_count,
          recorded: uuidHit || idHit,
        };
      })
      .sort((a, b) => new Date(b.start_time) - new Date(a.start_time));

    const missing = sessions.filter((s) => !s.recorded);
    res.json({
      windowDays: days,
      from,
      to,
      total: sessions.length,
      recorded: sessions.length - missing.length,
      missingCount: missing.length,
      sessions,
    });
  })
);

/* --------------------------- materials ---------------------------- */
/**
 * Reference-hub materials, stored in the database so admin edits survive
 * restarts. Seeded with real, working links on first run.
 */
const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

const SEED_MATERIALS = [
  {
    title: 'Zoom Meeting Controls & Security Settings',
    category: 'Beginner',
    type: 'Reference Guide',
    url: 'https://support.zoom.us/hc/en-us/articles/201362273-Meeting-controls-and-settings',
    description: 'Host controls, waiting room, breakout rooms and in-meeting security — what every mentor should know before a live class.',
  },
  {
    title: 'Scheduling & Recurring Meetings via the API',
    category: 'Intermediate',
    type: 'API Reference',
    url: 'https://developers.zoom.com/docs/api/rest/meetings',
    description: 'The Zoom REST meeting endpoints this dashboard uses to schedule, update and list sessions.',
  },
  {
    title: 'Understanding Candlestick Charts',
    category: 'Beginner',
    type: 'Concept Guide',
    url: 'https://www.investopedia.com/terms/c/candlestick.asp',
    description: 'Anatomy of candlesticks, common patterns and how to read them on any timeframe.',
  },
  {
    title: 'Moving Average Convergence Divergence (MACD)',
    category: 'Intermediate',
    type: 'Concept Guide',
    url: 'https://www.investopedia.com/terms/m/movingaverageconvergencedivergencemacd.asp',
    description: 'How MACD is calculated, and how divergence between price and MACD signals momentum shifts.',
  },
  {
    title: 'Risk Management Position Sizing Calculator',
    category: 'Advanced',
    type: 'Worksheet',
    url: 'https://www.calculator.net/position-size-calculator.html',
    description: 'Work out lot size and dollar risk per trade from account size and stop distance.',
  },
  {
    title: 'Investopedia Stock Market Simulator',
    category: 'Beginner',
    type: 'Practice Tool',
    url: 'https://www.investopedia.com/simulator/',
    description: 'Paper-trading sandbox for students to practise strategies with virtual capital before going live.',
  },
];

async function readMaterials() {
  // Seed the reference library on first run (same links as the old JSON seed).
  await materialsRepo.seedIfEmpty(
    SEED_MATERIALS.map((m, i) => ({ id: `mat-${i + 1}`, ...m }))
  );
  return materialsRepo.list();
}

function normaliseMaterial(input, existing = {}) {
  const title = String(input.title ?? existing.title ?? '').trim();
  if (!title) throw new HttpError(400, 'A material needs a title.');
  const url = String(input.url ?? existing.url ?? '').trim();
  if (url && !/^https?:\/\//i.test(url)) throw new HttpError(400, 'URL must start with http:// or https://.');
  const category = LEVELS.includes(input.category) ? input.category : existing.category || 'Beginner';
  return {
    ...existing,
    title,
    url,
    category,
    type: String(input.type ?? existing.type ?? 'Reference Guide').trim() || 'Reference Guide',
    description: String(input.description ?? existing.description ?? '').trim(),
  };
}

app.get(
  '/api/materials',
  wrap(async (_req, res) => res.json({ materials: await readMaterials() }))
);

app.post(
  '/api/materials',
  wrap(async (req, res) => {
    await readMaterials(); // ensures the seed has run
    const material = { id: `mat-${Date.now().toString(36)}`, bookmarks: 0, ...normaliseMaterial(req.body || {}) };
    res.status(201).json(await materialsRepo.create(material));
  })
);

app.patch(
  '/api/materials/:id',
  wrap(async (req, res) => {
    const existing = await materialsRepo.get(req.params.id);
    if (!existing) throw new HttpError(404, 'Material not found.');
    res.json(await materialsRepo.update(req.params.id, normaliseMaterial(req.body || {}, existing)));
  })
);

app.delete(
  '/api/materials/:id',
  wrap(async (req, res) => {
    if (!(await materialsRepo.remove(req.params.id))) throw new HttpError(404, 'Material not found.');
    res.status(204).end();
  })
);

/* ============================ LMS layer ============================= */
// The repositories (server/repos.js) replace the old flat JSON stores; the
// students/batches/targets/questions/knowledge data now lives in SQLite.

const uid = (prefix) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const splitName = (name = '') => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
};

const readStudentsInBatches = (batchIds = []) => studentsRepo.inBatches(batchIds);

function normaliseStudent(input, existing = {}) {
  const name = String(input.name ?? existing.name ?? '').trim();
  if (!name) throw new HttpError(400, 'A student needs a name.');
  const email = String(input.email ?? existing.email ?? '').trim().toLowerCase();
  if (email && !EMAIL_RE.test(email)) throw new HttpError(400, `“${email}” is not a valid email address.`);
  const batches = Array.isArray(input.batches) ? input.batches.map(String) : existing.batches || [];
  return {
    ...existing,
    name,
    email,
    batches: [...new Set(batches)],
    notes: String(input.notes ?? existing.notes ?? '').trim(),
  };
}

/* ---------------------------- students ---------------------------- */

app.get(
  '/api/students',
  wrap(async (_req, res) => {
    const batchName = new Map((await batchesRepo.list()).map((b) => [b.id, b.name]));
    const students = (await studentsRepo.list())
      .map((s) => ({
        ...s,
        batchNames: (s.batches || []).map((id) => batchName.get(id)).filter(Boolean),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    res.json({ students });
  })
);

app.post(
  '/api/students',
  wrap(async (req, res) => {
    const student = { id: uid('stu'), createdAt: new Date().toISOString(), ...normaliseStudent(req.body || {}) };
    if (student.email && (await studentsRepo.emailTaken(student.email))) {
      throw new HttpError(409, `A student with the email ${student.email} is already enrolled.`);
    }
    res.status(201).json(await studentsRepo.create(student));
  })
);

app.patch(
  '/api/students/:id',
  wrap(async (req, res) => {
    const existing = await studentsRepo.get(req.params.id);
    if (!existing) throw new HttpError(404, 'Student not found.');
    const updated = normaliseStudent(req.body || {}, existing);
    if (updated.email && (await studentsRepo.emailTaken(updated.email, existing.id))) {
      throw new HttpError(409, `A student with the email ${updated.email} is already enrolled.`);
    }
    res.json(await studentsRepo.update(existing.id, updated));
  })
);

app.delete(
  '/api/students/:id',
  wrap(async (req, res) => {
    // Cascades: memberships, registrations, chat conversation; question
    // attribution keeps the display name but loses the FK (SET NULL).
    if (!(await studentsRepo.remove(req.params.id))) throw new HttpError(404, 'Student not found.');
    res.status(204).end();
  })
);

/* --------------------- login passwords (admin) ---------------------- */
/**
 * Class password — the shared secret students sign in with (email + this).
 * Rotating it affects every student WITHOUT a personal override; students
 * who changed their password keep theirs until the admin clears it.
 */
app.get(
  '/api/class-password',
  wrap(async (_req, res) => {
    res.json({ configured: await authRepo.hasClassPassword() });
  })
);

app.put(
  '/api/class-password',
  wrap(async (req, res) => {
    const password = String(req.body?.password ?? '');
    if (password) {
      if (password.length < 6) throw new HttpError(400, 'Use at least 6 characters for the class password.');
      await authRepo.setClassPassword(password);
    } else {
      await authRepo.clearClassPassword(); // students with a personal password can still sign in
    }
    res.json({ configured: await authRepo.hasClassPassword() });
  })
);

/** Per-student override: { password } sets it, { password: '' } clears it. */
app.post(
  '/api/students/:id/password',
  wrap(async (req, res) => {
    const student = await studentsRepo.get(req.params.id);
    if (!student) throw new HttpError(404, 'Student not found.');
    const password = String(req.body?.password ?? '');
    if (password) {
      if (password.length < 6) throw new HttpError(400, 'Use at least 6 characters for the password.');
      await authRepo.setStudentPassword(student.id, password);
    } else {
      await authRepo.clearStudentPassword(student.id);
    }
    // A password reset is also the admin's escape hatch when the student is
    // locked to a lost device: end the old session so they can sign in again.
    const revokedSessions = await authRepo.revokeStudentSessions(student.id);
    res.json({
      id: student.id,
      hasPersonalPassword: await authRepo.studentHasPassword(student.id),
      revokedSessions,
    });
  })
);

/** Admin-only: release a student's active device (lost phone, crashed browser). */
app.delete(
  '/api/students/:id/sessions',
  wrap(async (req, res) => {
    const student = await studentsRepo.get(req.params.id);
    if (!student) throw new HttpError(404, 'Student not found.');
    const revoked = await authRepo.revokeStudentSessions(student.id);
    res.json({ ok: true, revoked });
  })
);

/* ----------------------------- batches ---------------------------- */

app.get(
  '/api/batches',
  wrap(async (_req, res) => {
    res.json({ batches: await batchesRepo.listWithCounts() });
  })
);

app.post(
  '/api/batches',
  wrap(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) throw new HttpError(400, 'A batch needs a name.');
    if (await batchesRepo.nameTaken(name)) {
      throw new HttpError(409, `A batch named “${name}” already exists.`);
    }
    const batch = {
      id: uid('bat'),
      name,
      description: String(req.body?.description || '').trim(),
      createdAt: new Date().toISOString(),
    };
    res.status(201).json({ ...(await batchesRepo.create(batch)), memberCount: 0 });
  })
);

app.patch(
  '/api/batches/:id',
  wrap(async (req, res) => {
    const existing = await batchesRepo.get(req.params.id);
    if (!existing) throw new HttpError(404, 'Batch not found.');
    const name = String(req.body?.name ?? existing.name).trim();
    if (!name) throw new HttpError(400, 'A batch needs a name.');
    res.json(
      await batchesRepo.update(existing.id, {
        name,
        description: String(req.body?.description ?? existing.description ?? '').trim(),
      })
    );
  })
);

app.delete(
  '/api/batches/:id',
  wrap(async (req, res) => {
    // Cascades through student_batches + meeting_target_batches (detach from
    // every student and meeting target in one statement).
    if (!(await batchesRepo.remove(req.params.id))) throw new HttpError(404, 'Batch not found.');
    res.status(204).end();
  })
);

/** Meeting -> batch assignments (drives My Classes + attendance badges). */
app.get(
  '/api/targets',
  wrap(async (_req, res) => res.json({ targets: await targetsRepo.all() }))
);

/* --------------------------- enrolment ---------------------------- */
/**
 * Assign batches to a meeting and register every student in them.
 *
 *   POST /api/meetings/:id/enroll   { batchIds: [...] }
 *
 * Zoom only accepts registrants when registration is enabled on the meeting.
 * For scheduled (type 2/3) meetings we enable it automatically; the Personal
 * Meeting Room is NEVER patched silently — the admin gets a clear warning and
 * the assignment is still recorded so attendance can be tracked.
 *
 * Registrant bodies are TOP-LEVEL ({ email, first_name, last_name }); Zoom
 * rejects a { registrants: [...] } wrapper with HTTP 400. Duplicate emails
 * return 200 and the existing join_url, so re-running an enroll is safe.
 */
app.post(
  '/api/meetings/:id/enroll',
  wrap(async (req, res) => {
    const meetingId = String(req.params.id);
    const requested = Array.isArray(req.body?.batchIds) ? req.body.batchIds.map(String) : [];
    const batchIds = [...new Set(requested)];
    if (!batchIds.length) throw new HttpError(400, 'Pick at least one batch to enrol.');

    const allBatches = await batchesRepo.list();
    const known = new Set(allBatches.map((b) => b.id));
    const validBatchIds = batchIds.filter((id) => known.has(id));
    if (!validBatchIds.length) throw new HttpError(400, 'Those batches no longer exist.');

    const roster = await readStudentsInBatches(validBatchIds);
    const withEmail = roster.filter((s) => EMAIL_RE.test(s.email || ''));
    const noEmail = roster.filter((s) => !EMAIL_RE.test(s.email || ''));

    // 1) Record the assignment — attendance reads this even when Zoom
    //    registration is unavailable (e.g. the Personal Meeting Room).
    const target = await targetsRepo.assignBatches(meetingId, validBatchIds);

    // 2) Make sure registration is on (type 2/3 meetings only).
    const warnings = [];
    let registrable = true;
    let meeting = null;
    try {
      meeting = await zoom(`/meetings/${meetingId}`);
    } catch (err) {
      registrable = false;
      warnings.push(`Could not read the meeting from Zoom: ${err.message}`);
    }

    if (registrable) {
      const approval = Number(meeting.settings?.approval_type);
      const registrationOn = approval === 0 || approval === 1;
      if (!registrationOn) {
        if (meeting.type === 2 || meeting.type === 3) {
          try {
            await zoom(`/meetings/${meetingId}`, {
              method: 'PATCH',
              body: { settings: { approval_type: 0, registration_type: 1 } },
            });
          } catch (err) {
            registrable = false;
            warnings.push(`Zoom refused to enable registration: ${err.message}`);
          }
        } else {
          registrable = false;
          warnings.push(
            'Registration is not enabled on this meeting (Personal Meeting Room / instant meeting), so personalised join links were not issued. Students will join with the shared link — attendance is still tracked.'
          );
        }
      }
    }

    // 3) Register every student that has an email (limited concurrency).
    const results = registrable
      ? await mapLimit(withEmail, 4, async (student) => {
          const { first, last } = splitName(student.name);
          try {
            const data = await zoom(`/meetings/${meetingId}/registrants`, {
              method: 'POST',
              body: { email: student.email, first_name: first, ...(last ? { last_name: last } : {}) },
            });
            return { ok: true, student, joinUrl: data.join_url || '' };
          } catch (err) {
            return { ok: false, student, error: err.message };
          }
        })
      : [];

    const registered = results.filter((r) => r.ok);
    const failed = results
      .filter((r) => !r.ok)
      .map((r) => ({ name: r.student.name, email: r.student.email, error: r.error }));

    // 4) Remember personalised join links (My Classes shows each student theirs).
    await targetsRepo.saveRegistrations(
      meetingId,
      registered
        .filter((r) => r.joinUrl)
        .map((r) => ({ studentId: r.student.id, name: r.student.name, email: r.student.email, joinUrl: r.joinUrl }))
    );

    res.json({
      meetingId,
      topic: meeting?.topic || '',
      batchIds: target.batchIds,
      batches: allBatches.filter((b) => validBatchIds.includes(b.id)).map((b) => b.name),
      expected: roster.length,
      registered: registered.length,
      skippedNoEmail: noEmail.map((s) => ({ name: s.name })),
      failed,
      warnings,
      joinUrls: registered
        .filter((r) => r.joinUrl)
        .map((r) => ({ name: r.student.name, email: r.student.email, joinUrl: r.joinUrl })),
    });
  })
);

/**
 * Assign (or clear) batches WITHOUT touching Zoom registrants — used
 * retroactively so past sessions can be audited against the expected list.
 *   PUT /api/meetings/:id/targets   { batchIds: [...] }  (empty array clears)
 */
app.put(
  '/api/meetings/:id/targets',
  wrap(async (req, res) => {
    const meetingId = String(req.params.id);
    const requested = Array.isArray(req.body?.batchIds) ? req.body.batchIds.map(String) : [];
    const batchIds = [...new Set(requested)];

    if (!batchIds.length) {
      await targetsRepo.clear(meetingId);
      return res.json({ meetingId, batchIds: [] });
    }

    const known = new Set((await batchesRepo.list()).map((b) => b.id));
    const valid = batchIds.filter((id) => known.has(id));
    if (!valid.length) throw new HttpError(400, 'Those batches no longer exist.');

    await targetsRepo.setBatches(meetingId, valid);
    res.json({ meetingId, batchIds: valid });
  })
);

/* --------------------------- attendance --------------------------- */
/**
 * The meeting list (`type=scheduled` / `previous`) carries the meeting's
 * *scheduled* UUID. Zoom does not always accept that UUID as a past-instance
 * key, so find the real instance in the meeting report by ID and closest
 * start time. Needed for the Attendance button on the Zoom Sessions cards.
 */
async function resolvePastInstance(meetingId, startTime) {
  const parsed = new Date(startTime || Date.now()).getTime();
  const anchor = Number.isFinite(parsed) ? parsed : Date.now();
  const from = new Date(anchor - 2 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(anchor + 2 * 86_400_000).toISOString().slice(0, 10);
  const report = await listReportMeetings({ from, to, pageSize: 300 });
  const wanted = String(meetingId);
  const digits = wanted.replace(/\D/g, '');

  const candidates = (report.meetings || []).filter((m) => {
    const id = String(m.id || '');
    return id === wanted || (digits && id.replace(/\D/g, '') === digits);
  });
  if (!candidates.length) return null;

  const distance = (m) => {
    const at = new Date(m.start_time || 0).getTime();
    return Number.isFinite(at) ? Math.abs(at - anchor) : Number.POSITIVE_INFINITY;
  };
  return candidates.sort((a, b) => distance(a) - distance(b))[0] || null;
}

/**
 * Who was expected (batches assigned to the meeting) vs who actually joined,
 * with duration — plus anyone who joined who wasn't on the expected list.
 *
 *   GET /api/meetings/:id/attendance?uuid=<exact instance uuid>&start_time=<iso>
 *
 * Pass `uuid` for Personal Meeting Room instances (they all share one id).
 * `start_time` lets the server resolve the real past instance when the
 * scheduled meeting UUID Zoom returns is not a valid instance key.
 * Matching is by email first, then by name — guests often join with no email.
 */
app.get(
  '/api/meetings/:id/attendance',
  wrap(async (req, res) => {
    const meetingId = String(req.params.id);
    const requestedUuid = String(req.query.uuid || '').trim();
    const scheduledStart = String(req.query.start_time || '').trim();
    let meetingKey = requestedUuid || meetingId;
    const target = (await targetsRepo.get(meetingId)) || null;
    const batchIds = target?.batchIds || [];
    const batchName = new Map((await batchesRepo.list()).map((b) => [b.id, b.name]));
    const enrolled = await readStudentsInBatches(batchIds);

    const { email: hostEmail, name: hostName } = await hostIdentity();

    let participants = [];
    let participantError = null;
    let loaded = false;

    const loadParticipants = (key) =>
      zoomAllPages(`/past_meetings/${encodeMeetingKey(key)}/participants`, {
        query: { page_size: 300 },
        listKey: 'participants',
      });

    try {
      const data = await loadParticipants(meetingKey);
      participants = data.participants || [];
      loaded = true;
    } catch (err) {
      // Scheduled meetings can expose a UUID that is not a past instance.
      // Resolve the real report instance, then fall back to the meeting ID
      // (which Zoom resolves to the latest past instance for recurring IDs).
      if (requestedUuid && (err.status === 404 || /does not exist/i.test(err.message))) {
        const instance = await resolvePastInstance(meetingId, scheduledStart).catch(() => null);
        const fallbackKeys = [instance?.uuid, meetingId]
          .filter(Boolean)
          .map(String)
          .filter((key) => key !== meetingKey);

        for (const key of fallbackKeys) {
          try {
            const data = await loadParticipants(key);
            participants = data.participants || [];
            meetingKey = key;
            participantError = null;
            loaded = true;
            break;
          } catch (fallbackErr) {
            participantError = fallbackErr.message || err.message;
          }
        }
        if (!loaded && !participantError) participantError = err.message;
      } else {
        // Most common cause: the session has not happened yet.
        participantError = err.message;
      }
    }

    // Zoom logs one row per JOIN — roll up per person (duration is SECONDS).
    const people = new Map();
    for (const p of participants) {
      const email = (p.user_email || '').trim().toLowerCase();
      const name = (p.name || '').trim().toLowerCase();
      if (hostEmail && email === hostEmail) continue;
      if (!email && hostName && name === hostName) continue;

      const key = email || `name:${name}`;
      const seconds = Number(p.duration) || 0;
      const found = people.get(key);
      if (!found) {
        people.set(key, {
          name: (p.name || 'Unknown').trim(),
          email: p.user_email || '',
          durationSeconds: seconds,
          joins: 1,
          firstJoin: p.join_time,
          lastLeave: p.leave_time,
        });
        continue;
      }
      found.joins += 1;
      found.durationSeconds += seconds;
      if (p.join_time && (!found.firstJoin || p.join_time < found.firstJoin)) found.firstJoin = p.join_time;
      if (p.leave_time && (!found.lastLeave || p.leave_time > found.lastLeave)) found.lastLeave = p.leave_time;
      if (p.name && found.name === 'Unknown') found.name = p.name.trim();
      if (p.user_email && !found.email) found.email = p.user_email;
    }

    // Expected student -> attendee: email first, then name (guest joins).
    const byEmail = new Map();
    const byName = new Map();
    for (const [key, person] of people) {
      const e = (person.email || '').trim().toLowerCase();
      if (e && !byEmail.has(e)) byEmail.set(e, key);
      const n = (person.name || '').trim().toLowerCase();
      if (n && !byName.has(n)) byName.set(n, key);
    }

    const matched = new Set();
    const joined = [];
    const absent = [];
    for (const student of enrolled) {
      const e = (student.email || '').trim().toLowerCase();
      const n = (student.name || '').trim().toLowerCase();
      const hit = (e && byEmail.get(e)) || (n && byName.get(n)) || null;
      if (hit && !matched.has(hit)) {
        matched.add(hit);
        const person = people.get(hit);
        joined.push({
          studentId: student.id,
          name: student.name,
          email: student.email,
          durationSeconds: person.durationSeconds,
          joins: person.joins,
          firstJoin: person.firstJoin,
          lastLeave: person.lastLeave,
          matchedBy: e && byEmail.get(e) === hit ? 'email' : 'name',
        });
      } else if (!participantError) {
        absent.push({ studentId: student.id, name: student.name, email: student.email });
      }
    }

    const guests = [...people.entries()]
      .filter(([key]) => !matched.has(key))
      .map(([, person]) => person)
      .sort((a, b) => b.durationSeconds - a.durationSeconds);

    res.json({
      meetingId,
      meetingKey,
      assigned: Boolean(target && batchIds.length),
      batchIds,
      batchNames: batchIds.map((id) => batchName.get(id)).filter(Boolean),
      enrolledCount: enrolled.length,
      joined,
      absent,
      guests,
      participantError,
      generatedAt: new Date().toISOString(),
    });
  })
);

/* ----------------------------- Q&A log ---------------------------- */
/**
 * Everything students ask, in one audit log:
 *   - chatbot questions, posted by the UI with role attribution
 *   - Zoom's own in-session Q&A (opt-in via ?zoom=1, cached5 min)
 *
 *   GET    /api/questions?days=30&zoom=1&refresh=1
 *   POST   /api/questions        { question, answer?, askedBy?, role? }
 *   PATCH  /api/questions/:id    { answer }  -> mentor answers/corrects (admin)
 *   POST   /api/questions/promote  { question, answer }  -> knowledge base
 *   GET    /api/knowledge        (promoted pairs + mentor-edited answers)
 */

const QA_CACHE_MS = 5 * 60_000;
let zoomQaCache = { at: 0, key: null, payload: null };

async function collectZoomQa(days, force = false) {
  const key = `days:${days}`;
  const fresh = zoomQaCache.payload && zoomQaCache.key === key && Date.now() - zoomQaCache.at < QA_CACHE_MS;
  if (fresh && !force) return { ...zoomQaCache.payload, cached: true };

  const userId = await resolveUserId();
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const meetings = [];
  for (const chunk of chunkRange(from, to)) {
    const data = await zoom(`/report/users/${userId}/meetings`, {
      query: { from: chunk.from, to: chunk.to, page_size: 300 },
    });
    meetings.push(...(data.meetings || []));
  }

  const rows = await mapLimit(meetings, 4, async (m) => {
    try {
      const qa = await zoom(`/past_meetings/${encodeMeetingKey(m.uuid || m.id)}/qa`);
      return { meeting: m, questions: qa.questions || [] };
    } catch {
      return { meeting: m, questions: [] };
    }
  });

  const questions = [];
  for (const { meeting, questions: list } of rows) {
    list.forEach((q, i) => {
      const question = String(q.question ?? q.text ?? '').trim();
      if (!question) return;
      questions.push({
        id: `zoom-${meeting.uuid || meeting.id}-${q.id ?? i}`,
        source: 'zoom-qa',
        question,
        answer: String(q.answer ?? '').trim(),
        askedBy: q.questioner_name || q.name || 'Zoom attendee',
        at: q.date_time || q.date || meeting.start_time,
        meetingId: meeting.id,
        meetingUuid: meeting.uuid,
        topic: meeting.topic,
      });
    });
  }

  const payload = { questions, sessionsScanned: meetings.length };
  zoomQaCache = { at: Date.now(), key, payload };
  return { ...payload, cached: false };
}

app.get(
  '/api/questions',
  wrap(async (req, res) => {
    const days = Math.max(1, Math.min(31, Number(req.query.days) || 30));
    const cutoff = Date.now() - days * 86_400_000;
    const local = await questionsRepo.listSince(cutoff);

    const withZoom = req.query.zoom === '1' || req.query.zoom === 'true';
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    let merged = local;
    let zoomMeta = null;

    if (withZoom) {
      const payload = await collectZoomQa(days, force);
      zoomMeta = { sessionsScanned: payload.sessionsScanned, cached: Boolean(payload.cached) };
      merged = [...local, ...payload.questions];
    }

    merged.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
    res.json({ questions: merged, zoomMeta, generatedAt: new Date().toISOString() });
  })
);

app.post(
  '/api/questions',
  wrap(async (req, res) => {
    const question = String(req.body?.question || '').trim();
    if (!question) throw new HttpError(400, 'A question is required.');
    // Participants: keep the real FK when their id is known (attribution that
    // survives renames); the display name is stored either way.
    const claimedId = String(req.body?.studentId || '');
    const studentId = claimedId && (await studentsRepo.get(claimedId)) ? claimedId : null;
    const entry = {
      id: uid('q'),
      at: new Date().toISOString(),
      question,
      answer: String(req.body?.answer || '').trim(),
      askedBy: String(req.body?.askedBy || '').trim() || 'Student',
      role: req.body?.role === 'admin' ? 'admin' : 'participant',
      studentId,
      source: req.body?.source === 'zoom-qa' ? 'zoom-qa' : 'chatbot',
      topic: String(req.body?.topic || '').trim(),
    };
    res.status(201).json(await questionsRepo.create(entry));
  })
);

/**
 * The mentor answers or corrects a logged question. The AI's original answer
 * is preserved in `aiAnswer` (first edit only) and the edited `answer` is
 * merged into GET /api/knowledge, so the bot serves the mentor's wording to
 * everyone from then on — including the student who originally asked.
 * (Admin-only: the access gate denies participants everything except GETs
 * plus POST /api/questions.)
 */
app.patch(
  '/api/questions/:id',
  wrap(async (req, res) => {
    const answer = String(req.body?.answer || '').trim();
    if (!answer) throw new HttpError(400, 'Write the response before saving.');
    const entry = await questionsRepo.editAnswer(req.params.id, answer, 'Admin');
    if (!entry) throw new HttpError(404, 'That question is not in the log.');
    res.json(entry);
  })
);

app.post(
  '/api/questions/promote',
  wrap(async (req, res) => {
    const question = String(req.body?.question || '').trim();
    const answer = String(req.body?.answer || '').trim();
    if (!question || !answer) throw new HttpError(400, 'Both the question and its answer are required.');
    // INSERT OR IGNORE + the unique index on lower(question) enforce dedupe.
    await knowledgeRepo.add({ id: uid('kb'), question, answer, createdAt: new Date().toISOString() });
    res.status(201).json({ knowledge: await knowledgeRepo.list() });
  })
);

/**
 * The bot's answer pool: promoted Q&A pairs PLUS every mentor-edited answer.
 * Edited entries are listed first and win the dedupe by question, so a
 * corrected answer always overrides the older promoted/AI wording.
 */
app.get(
  '/api/knowledge',
  wrap(async (_req, res) => {
    const merged = [];
    const seen = new Set();
    const push = (item) => {
      const key = String(item.question || '').toLowerCase().trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push(item);
    };

    (await questionsRepo.editedAnswers()).forEach((q) =>
      push({
        id: `qa-${q.id}`,
        question: q.question,
        answer: q.answer,
        source: 'qa-edit',
        editedAt: q.editedAt,
        editedBy: q.editedBy,
      })
    );

    (await knowledgeRepo.list()).forEach((k) => push({ ...k, source: k.source || 'knowledge' }));
    res.json({ knowledge: merged });
  })
);

/* ------------------------- chat history ---------------------------- */
/**
 * Server-side chat conversations, so a student's history follows them to any
 * browser/device (the browser only keeps a local cache for instant paint).
 * Keys: 'admin' for the host, the student id for participants. A participant
 * may only read/write THEIR OWN key (enforced here, not just in the UI).
 */
const CHAT_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
// Prototype-pollution style keys are syntactically valid above — the repo
// layer treats them as plain TEXT primary keys (no object indexing).
const CHAT_BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const chatKeyOk = (session, key) =>
  session.role === 'admin' || Boolean(session.user?.id && key === session.user.id);

const sanitiseMessages = (incoming) =>
  incoming
    .slice(-60) // bounded
    .map((m) => ({
      sender: m?.sender === 'user' ? 'user' : 'bot',
      text: String(m?.text ?? '').slice(0, 4000),
      time: String(m?.time ?? '').slice(0, 40),
      ...(m?.source ? { source: String(m.source).slice(0, 40) } : {}),
      ...(m?.mode ? { mode: String(m.mode).slice(0, 20) } : {}),
      ...(m?.corrected ? { corrected: true } : {}),
    }));

app.get(
  '/api/chats/:key',
  wrap(async (req, res) => {
    const { key } = req.params;
    if (!CHAT_KEY_RE.test(key) || CHAT_BAD_KEYS.has(key)) throw new HttpError(400, 'Bad chat key.');
    if (!chatKeyOk(req.session, key)) throw new HttpError(403, 'You can only read your own conversation.');
    res.json({ messages: await chatsRepo.getMessages(key) });
  })
);

app.put(
  '/api/chats/:key',
  wrap(async (req, res) => {
    const { key } = req.params;
    if (!CHAT_KEY_RE.test(key) || CHAT_BAD_KEYS.has(key)) throw new HttpError(400, 'Bad chat key.');
    if (!chatKeyOk(req.session, key)) throw new HttpError(403, 'You can only write your own conversation.');
    const incoming = Array.isArray(req.body?.messages) ? req.body.messages : null;
    if (!incoming) throw new HttpError(400, 'Expected { messages: [...] }.');
    const messages = sanitiseMessages(incoming);
    try {
      const stored = await chatsRepo.replace(key, messages); // [] clears the conversation
      res.json({ messages: stored });
    } catch (err) {
      if (err?.status) throw new HttpError(err.status, err.message);
      throw err;
    }
  })
);

/* --------------------------- my classes --------------------------- */
/**
 * Everything a participant's "My Classes" screen needs, in one call:
 *   GET /api/my-classes?studentId=stu-x&days=30
 *   - upcoming sessions assigned to the student's batches, each with their
 *     personalised join link when they were registered
 *   - past assigned sessions with joined/absent + minutes attended, or
 *     "pending" when the per-instance participant data hasn't been fetched yet
 */
app.get(
  '/api/my-classes',
  wrap(async (req, res) => {
    const studentId = String(req.query.studentId || req.query.student_id || '');
    const student = await studentsRepo.find(studentId);
    if (!student) {
      throw new HttpError(404, 'Student not found — pick a participant in the top-right role switcher.');
    }

    const days = Math.max(1, Math.min(90, Number(req.query.days) || 30));
    const myBatchIds = new Set((student.batches || []).map(String));
    const targets = await targetsRepo.all();
    const batchName = new Map((await batchesRepo.list()).map((b) => [b.id, b.name]));

    const mine = (meetingId) => {
      const target = targets[String(meetingId)];
      if (!target) return null;
      const shared = (target.batchIds || []).filter((id) => myBatchIds.has(String(id)));
      return shared.length ? { target, shared } : null;
    };

    // Upcoming: the scheduled list partitioned by end time (same rules as /api/meetings).
    const upcomingData = await listMeetings('me', { type: 'upcoming', page_size: 100 });
    const upcoming = (upcomingData.meetings || [])
      .filter((m) => mine(m.id))
      .map((m) => {
        const { target, shared } = mine(m.id);
        const registration = (target.registrations || []).find(
          (r) =>
            r.studentId === student.id ||
            (r.email && student.email && r.email.toLowerCase() === student.email.toLowerCase())
        );
        return {
          id: m.id,
          uuid: m.uuid,
          topic: m.topic,
          start_time: m.start_time,
          duration: m.duration,
          status: m.status,
          joinUrl: registration?.joinUrl || m.join_url || `https://zoom.us/j/${m.id}`,
          registered: Boolean(registration),
          batchNames: shared.map((id) => batchName.get(id)).filter(Boolean),
        };
      })
      .sort((a, b) => new Date(a.start_time || 0) - new Date(b.start_time || 0));

    // Past: exact-instance attendance from Zoom's participant report.
    //
    // The full roster build needs one Zoom call per past session and cannot
    // finish inside a Workers invocation (~50-subrequest cap), which is why
    // production used to show real attendees as Absent. Fetch only this
    // student's sessions, reuse the per-instance cache, and mark anything not
    // fetched yet as "pending" instead of Absent.
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const reportMeetings = [];
    for (const chunk of chunkRange(from, to)) {
      const data = await listReportMeetings({ from: chunk.from, to: chunk.to, pageSize: 300 });
      reportMeetings.push(...(data.meetings || []));
    }

    const sessions = reportMeetings
      .filter((m) => mine(m.id))
      .sort((a, b) => new Date(b.start_time || 0) - new Date(a.start_time || 0));

    const uncached = [];
    const seen = new Set();
    for (const m of sessions) {
      const key = participantKey(m);
      if (seen.has(key) || readParticipantCache(key)) continue;
      seen.add(key);
      if (uncached.length < ATTENDANCE_FETCH_BUDGET) uncached.push(m);
    }
    await mapLimit(uncached, 4, async (m) => {
      try {
        await fetchParticipantsFor(m);
      } catch {
        /* leave this instance pending; the next visit retries */
      }
    });

    const participantsByKey = new Map();
    for (const m of sessions) {
      const key = participantKey(m);
      const rows = readParticipantCache(key);
      if (rows) participantsByKey.set(key, rows);
    }
    const attended = attendanceFromParticipants(sessions, student, participantsByKey);

    const past = sessions.map((s) => {
      const key = participantKey(s);
      const known = participantsByKey.has(key);
      const uuid = s.uuid ? String(s.uuid) : '';
      const instance = `${s.id}|${s.start_time}`;
      const minutes = (uuid ? attended.byUuid.get(uuid) : undefined) ?? attended.byInstance.get(instance) ?? 0;
      const joined = Boolean((uuid && attended.byUuid.has(uuid)) || attended.byInstance.has(instance));
      return {
        id: s.id,
        uuid: s.uuid,
        topic: s.topic,
        start_time: s.start_time,
        duration: s.duration,
        participants: s.participants_count ?? s.participants ?? null,
        joined: known ? joined : null,
        attendance: known ? (joined ? 'joined' : 'absent') : 'pending',
        minutes,
      };
    });

    res.json({
      student: {
        id: student.id,
        name: student.name,
        email: student.email,
        batches: (student.batches || []).map((id) => batchName.get(id)).filter(Boolean),
      },
      upcoming,
      past,
      stats: {
        upcoming: upcoming.length,
        attended: past.filter((s) => s.attendance === 'joined').length,
        missed: past.filter((s) => s.attendance === 'absent').length,
        pending: past.filter((s) => s.attendance === 'pending').length,
        minutes: past.reduce((sum, s) => sum + (s.minutes || 0), 0),
      },
      rosterWindowDays: days,
      generatedAt: new Date().toISOString(),
    });
  })
);

/* --------------------------- passthrough ------------------------- */
/* GET /api/zoom/<any zoom v2 path>?query  — e.g. /api/zoom/devices/123/commands */

app.use(
  '/api/zoom',
  wrap(async (req, res) => {
    const data = await zoom(req.url.split('?')[0], {
      method: req.method,
      body: req.body,
      query: Object.fromEntries(new URLSearchParams(req.url.split('?')[1] || '')),
    });
    if (data === null) return res.status(204).end();
    res.json(data);
  })
);

/* --------------------------- 404 for /api ------------------------- */

app.use('/api', (req, res) => {
  res.status(404).json({ error: { message: `No API route for ${req.method} ${req.originalUrl}` } });
});

/* ------------------------ error handler -------------------------- */

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[api] error:', err.message);
  res.status(status).json({ error: { message: err.message, detail: err.detail } });
});

/* --------------- serve the built SPA when it exists --------------- */
/* The Worker serves the SPA through Workers Assets; local Node passes dist. */

if (staticDir) {
  app.use(express.static(staticDir));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(staticDir, 'index.html'));
  });
}

return app;
}
