/**
 * Render smoke tests: every page mounts, the role switcher flips between the
 * Admin and Participant experiences, and the LMS flows (student CRUD, batch
 * enrolment, attendance auditing, Q&A log) show the data the proxy returns.
 * `fetch` is mocked so the suite runs offline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App.jsx';
import { ToastProvider } from '../components/ToastProvider.jsx';

const MEETINGS = {
  meetings: [
    {
      id: 8924019284,
      topic: 'Price Action & Support/Resistance Mastery',
      start_time: '2030-10-14T17:30:00Z',
      duration: 90,
      status: 'waiting',
      password: 'apex123',
      join_url: 'https://zoom.us/j/8924019284?pwd=abc',
    },
  ],
};

const RECORDINGS = {
  meetings: [
    {
      id: 3349281102,
      topic: 'Order Flow & DOM Footprint Charts Workshop',
      start_time: '2026-10-09T19:00:00Z',
      recording_count: 2,
      total_size: 5_000_000,
      recording_files: [
        {
          id: 'f1',
          file_type: 'MP4',
          file_size: 4_000_000,
          recording_start: '2026-10-09T19:00:00Z',
          play_url: 'https://zoom.us/rec/share/1',
          download_url: 'https://zoom.us/rec/download/1',
        },
      ],
    },
  ],
};

const USERS = {
  total_records: 2,
  users: [
    { id: 'u1', first_name: 'Liam', last_name: 'Chen', email: 'liam@example.com', type: 1, status: 'active', timezone: 'Asia/Kolkata', created_at: '2026-01-05T10:00:00Z' },
    { id: 'u2', first_name: 'Elena', last_name: 'Rostova', email: 'elena@example.com', type: 2, status: 'active', timezone: 'Europe/London', created_at: '2026-02-11T10:00:00Z' },
  ],
};

/* ------------------------------- LMS seeds ------------------------------- */

const STUDENTS = [
  { id: 'stu-1', name: 'Priya Sharma', email: 'priya@example.com', batches: ['bat-1'], batchNames: ['Batch A'], notes: '' },
  { id: 'stu-2', name: 'Arjun Mehta', email: 'arjun@example.com', batches: ['bat-1'], batchNames: ['Batch A'], notes: '' },
];

const BATCHES = [
  { id: 'bat-1', name: 'Batch A', description: 'Morning cohort', memberCount: 2 },
  { id: 'bat-2', name: 'Batch B', description: 'Evening cohort', memberCount: 0 },
];

const ENROLL_RESULT = {
  meetingId: 9911223344,
  topic: 'Batch Sync Class',
  batchIds: ['bat-1'],
  batches: ['Batch A'],
  expected: 2,
  registered: 2,
  skippedNoEmail: [],
  failed: [],
  warnings: [],
  joinUrls: [
    { name: 'Priya Sharma', email: 'priya@example.com', joinUrl: 'https://zoom.us/j/1?reg=1' },
    { name: 'Arjun Mehta', email: 'arjun@example.com', joinUrl: 'https://zoom.us/j/1?reg=2' },
  ],
};

const ATTENDANCE = {
  meetingId: 8891941924,
  meetingKey: 'jpar7LdRRNaVkNC9I5CzQg==',
  assigned: true,
  batchIds: ['bat-1'],
  batchNames: ['Batch A'],
  enrolledCount: 2,
  joined: [
    {
      studentId: 'stu-1',
      name: 'Priya Sharma',
      email: 'priya@example.com',
      durationSeconds: 2700, // formatSeconds -> "45m"
      joins: 1,
      firstJoin: '2026-10-12T09:12:24Z',
      lastLeave: '2026-10-12T09:57:24Z',
      matchedBy: 'email',
    },
  ],
  absent: [{ studentId: 'stu-2', name: 'Arjun Mehta', email: 'arjun@example.com' }],
  guests: [{ name: 'Adam Smith', email: 'adam@example.com', durationSeconds: 600, joins: 1 }],
  participantError: null,
  generatedAt: '2026-10-12T10:00:00Z',
};

const MY_CLASSES = {
  student: { id: 'stu-1', name: 'Priya Sharma', email: 'priya@example.com', batches: ['Batch A'] },
  upcoming: [
    {
      id: 8924019284,
      uuid: 'm1',
      topic: 'Batch Sync 101',
      start_time: '2030-10-14T17:30:00Z',
      duration: 90,
      status: 'waiting',
      joinUrl: 'https://zoom.us/j/8924019284?reg=priya',
      registered: true,
      batchNames: ['Batch A'],
    },
  ],
  past: [
    {
      id: 8891941924,
      uuid: 'jpar7LdRRNaVkNC9I5CzQg==',
      topic: 'Candlesticks 101',
      start_time: '2026-10-06T12:35:06Z',
      duration: 60,
      participants: 12,
      joined: true,
      minutes: 45,
    },
  ],
  stats: { upcoming: 1, attended: 1, missed: 0, minutes: 45 },
  rosterWindowDays: 30,
  generatedAt: '2026-10-12T10:00:00Z',
};

const SEED_QUESTIONS = [
  {
    id: 'q-1',
    at: '2026-10-12T09:00:00Z',
    question: 'How do I set a stop loss?',
    answer: 'Risk 1% per trade and keep R:R above 1:2.',
    askedBy: 'Priya Sharma',
    role: 'participant',
    source: 'chatbot',
  },
];

const ROUTES = [
  ['/api/health', { ok: true, configured: true, account: { id: 'u0', email: 'head@apex.io', name: 'Dr. Alex Vance' }, tokenExpiresIn: 1800 }],
  ['/api/meetings', MEETINGS],
  ['/api/recordings', RECORDINGS],
  ['/api/users', USERS],
  ['/api/webinars', { total_records: 3, webinars: [] }],
  ['/api/reports/meetings', {
    from: '2026-09-12',
    to: '2026-10-12',
    total_records: 1,
    meetings: [
      {
        id: 8891941924,
        uuid: 'jpar7LdRRNaVkNC9I5CzQg==',
        topic: "SBC Traders's Personal Meeting Room",
        start_time: '2026-10-12T09:12:24Z',
        end_time: '2026-10-12T09:13:14Z',
        duration: 1,
        participants: 1,
      },
    ],
  }],
  ['/api/past-meetings/', {
    total_records: 4,
    participants: [
      { id: 'p1', name: 'Zoe Brown', user_email: 'zoe@example.com', duration: 30, join_time: '2026-10-06T12:35:06Z', leave_time: '2026-10-06T12:40:06Z' },
      { id: 'p2', name: 'Arman Nayak', user_email: 'arman@example.com', duration: 45, join_time: '2026-10-06T12:35:06Z', leave_time: '2026-10-06T13:00:06Z' },
      { id: 'p3', name: 'Adam Smith', user_email: 'adam@example.com', duration: 60, join_time: '2026-10-06T12:36:06Z', leave_time: '2026-10-06T13:00:06Z' },
      // Rejoin: Zoe dropped and came back -> Zoom logs a second row for her
      { id: 'p4', name: 'Zoe Brown', user_email: 'zoe@example.com', duration: 10, join_time: '2026-10-06T13:05:06Z', leave_time: '2026-10-06T13:15:06Z' },
    ],
  }],
  ['/api/config', { configured: true, authType: 'Server-to-Server OAuth' }],
  ['/api/roster', {
    generatedAt: '2026-10-12T10:00:00Z',
    windowDays: 30,
    sessionsAnalyzed: 3,
    joinRecords: 4,
    totalStudents: 2,
    cached: false,
    students: [
      {
        key: 'zoe@example.com',
        name: 'Zoe Brown',
        email: 'zoe@example.com',
        sessions: 2,
        joins: 3,
        totalMinutes: 40,
        longestMinutes: 30,
        avgMinutes: 20,
        firstAttended: '2026-10-01T12:00:00Z',
        lastAttended: '2026-10-06T12:35:06Z',
        meetings: [
          { id: 1, uuid: 'u1', topic: 'Candlesticks 101', start_time: '2026-10-06T12:35:06Z', minutes: 30 },
          { id: 2, uuid: 'u2', topic: 'Risk Management', start_time: '2026-10-01T12:00:00Z', minutes: 10 },
        ],
      },
      {
        key: 'arman@example.com',
        name: 'Arman Nayak',
        email: 'arman@example.com',
        sessions: 1,
        joins: 1,
        totalMinutes: 45,
        longestMinutes: 45,
        avgMinutes: 45,
        firstAttended: '2026-10-06T12:35:06Z',
        lastAttended: '2026-10-06T12:35:06Z',
        meetings: [{ id: 1, uuid: 'u1', topic: 'Candlesticks 101', start_time: '2026-10-06T12:35:06Z', minutes: 45 }],
      },
    ],
  }],
  ['/api/coverage', {
    windowDays: 14,
    from: '2026-09-28',
    to: '2026-10-12',
    total: 2,
    recorded: 1,
    missingCount: 1,
    sessions: [
      { id: 1, uuid: 'u1', topic: 'Candlesticks 101', start_time: '2026-10-06T12:35:06Z', duration: 60, participants: 12, recorded: true },
      { id: 2, uuid: 'u2', topic: 'Risk Management', start_time: '2026-10-01T12:00:00Z', duration: 45, participants: 8, recorded: false },
    ],
  }],
];

/** Module-level capture of the mutating calls the tests assert on. */
let mock;

function mockFetch() {
  // In-memory copies of the server's JSON stores so CRUD in the tests behaves
  // like the real endpoints instead of returning a fixed list.
  mock = {
    urls: [],
    enrollCalls: [],
    meetingPosts: [],
    questionPosts: [],
    targetPuts: [],
    questionPatches: [],
    chatPuts: [],
    passwordChanges: [],
    classPasswordWrites: [],
    studentPasswordWrites: [],
  };
  let classPassword = ''; // admin-managed shared password (GET/PUT /api/class-password)
  let materials = [
    { id: 'mat-1', title: 'Zoom Meeting Controls', category: 'Beginner', type: 'Reference Guide', url: 'https://support.zoom.us/hc/en-us', description: 'Host controls.' },
    { id: 'mat-2', title: 'Candlestick Patterns', category: 'Intermediate', type: 'Concept Guide', url: 'https://www.investopedia.com/terms/c/candlestick.asp', description: 'Read the candles.' },
  ];
  let students = STUDENTS.map((s) => ({ ...s, batches: [...s.batches] }));
  let questions = SEED_QUESTIONS.map((q) => ({ ...q }));
  let knowledge = [];
  let targets = {};
  let meetings = MEETINGS.meetings.map((m) => ({ ...m }));
  let chats = {}; // key -> messages (server-side chat history)

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input, init = {}) => {
      const url = String(input);
      mock.urls.push(url);
      const method = (init.method || 'GET').toUpperCase();
      const payload = init.body ? JSON.parse(init.body) : null;
      let body = null;

      if (url.includes('/api/auth/me')) {
        // Boots as Admin whenever the seeded test token is present.
        body = { role: 'admin', user: { name: '', email: '' } };
      } else if (url.includes('/api/auth/change-password')) {
        // Student self-service: current password must match, then personal override.
        if (payload?.currentPassword !== 'class-pass-1') {
          return {
            ok: false,
            status: 400,
            text: async () => JSON.stringify({ error: { message: 'Your current password is incorrect.' } }),
          };
        }
        mock.passwordChanges.push(payload?.newPassword);
        body = { ok: true, hasPersonalPassword: true };
      } else if (url.includes('/api/auth/login')) {
        if (payload?.role === 'admin' && String(payload?.pin || '') !== '625158') {
          return {
            ok: false,
            status: 401,
            text: async () => JSON.stringify({ error: { message: 'Incorrect admin PIN.' } }),
          };
        }
        let user;
        if (payload?.role === 'admin') {
          user = { name: '', email: '' };
        } else {
          const found = STUDENTS.find((s) => s.email === String(payload?.email || '').toLowerCase());
          if (!found || String(payload?.password || '') !== 'class-pass-1') {
            return {
              ok: false,
              status: 401,
              text: async () => JSON.stringify({ error: { message: 'Email or password is incorrect.' } }),
            };
          }
          user = { ...found };
        }
        body = { token: 'test-token', role: payload?.role, user };
      } else if (url.includes('/api/auth/logout')) {
        body = { ok: true };
      } else if (url.includes('/api/class-password')) {
        if (method === 'PUT') {
          classPassword = String(payload?.password || '');
          mock.classPasswordWrites.push(classPassword);
        }
        body = { configured: Boolean(classPassword) };
      } else if (url.includes('/api/chats')) {
        // Server-side chat history: PUT stores, GET returns (or [] when new).
        const key = decodeURIComponent(url.split('/api/chats/')[1] || '');
        if (method === 'PUT') {
          chats[key] = (payload?.messages || []).slice(-60);
          mock.chatPuts.push({ key, count: chats[key].length });
          body = { messages: chats[key] };
        } else {
          body = { messages: chats[key] || [] };
        }
      } else if (url.includes('/api/materials')) {
        if (method === 'POST') {
          const created = { id: `mat-${materials.length + 1}`, ...payload };
          materials = [created, ...materials];
          body = created;
        } else if (method === 'PATCH') {
          const id = url.split('/').pop();
          materials = materials.map((m) => (m.id === id ? { ...m, ...payload } : m));
          body = materials.find((m) => m.id === id);
        } else if (method === 'DELETE') {
          const id = url.split('/').pop();
          materials = materials.filter((m) => m.id !== id);
          body = null;
        } else {
          body = { materials };
        }
      } else if (url.includes('/enroll')) {
        // POST /api/meetings/:id/enroll — record the call + the assignment.
        const parts = url.split('?')[0].split('/').filter(Boolean);
        const meetingId = parts[parts.length - 2];
        mock.enrollCalls.push({ url, payload });
        targets = {
          ...targets,
          [meetingId]: {
            meetingId,
            batchIds: payload?.batchIds || [],
            updatedAt: '2026-10-12T10:00:00Z',
          },
        };
        body = ENROLL_RESULT;
      } else if (url.includes('/attendance')) {
        body = ATTENDANCE;
      } else if (url.includes('/targets')) {
        if (method === 'PUT') {
          const parts = url.split('?')[0].split('/').filter(Boolean);
          const meetingId = parts[parts.length - 2];
          mock.targetPuts.push({ meetingId, payload });
          if (payload?.batchIds?.length) {
            targets = { ...targets, [meetingId]: { meetingId, batchIds: payload.batchIds, updatedAt: '2026-10-12T10:00:00Z' } };
          } else {
            delete targets[meetingId];
          }
          body = { meetingId, batchIds: payload?.batchIds || [] };
        } else {
          body = { targets };
        }
      } else if (/\/api\/students\/[^/]+\/password/.test(url)) {
        // Per-student password override: { password } sets, { password: '' } clears.
        const id = url.split('/api/students/')[1].split('/password')[0];
        const hasPersonalPassword = Boolean(payload?.password);
        mock.studentPasswordWrites.push({ id, password: payload?.password });
        body = { id, hasPersonalPassword };
      } else if (url.includes('/api/students')) {
        if (method === 'POST') {
          const created = {
            id: `stu-${students.length + 1}`,
            createdAt: '2026-10-12T10:00:00Z',
            notes: '',
            ...payload,
          };
          created.batchNames = (created.batches || [])
            .map((id) => BATCHES.find((b) => b.id === id)?.name)
            .filter(Boolean);
          students = [...students, created];
          body = created;
        } else if (method === 'PATCH') {
          const id = url.split('/').pop();
          students = students.map((s) => (s.id === id ? { ...s, ...payload } : s));
          body = students.find((s) => s.id === id);
        } else if (method === 'DELETE') {
          const id = url.split('/').pop();
          students = students.filter((s) => s.id !== id);
          body = null;
        } else {
          body = { students };
        }
      } else if (url.includes('/api/batches')) {
        body = { batches: BATCHES };
      } else if (url.includes('/api/questions')) {
        if (method === 'PATCH') {
          const id = url.split('/').pop();
          questions = questions.map((q) =>
            q.id === id
              ? {
                  ...q,
                  aiAnswer: q.aiAnswer ?? q.answer ?? '',
                  answer: payload?.answer ?? '',
                  editedBy: 'Admin',
                  editedAt: new Date().toISOString(),
                }
              : q
          );
          mock.questionPatches.push({ id, answer: payload?.answer });
          // Like the real server: edited answers join GET /api/knowledge first.
          const entry = questions.find((q) => q.id === id);
          knowledge = [
            { id: `qa-${id}`, question: entry.question, answer: entry.answer, source: 'qa-edit' },
            ...knowledge.filter((k) => k.question.toLowerCase() !== entry.question.toLowerCase()),
          ];
          body = entry;
        } else if (method === 'POST' && url.includes('/promote')) {
          const exists = knowledge.some(
            (k) => k.question.toLowerCase() === String(payload?.question || '').toLowerCase()
          );
          if (!exists) {
            knowledge = [
              { id: `kb-${knowledge.length + 1}`, question: payload.question, answer: payload.answer, createdAt: '2026-10-12T10:00:00Z' },
              ...knowledge,
            ];
          }
          body = { knowledge };
        } else if (method === 'POST') {
          const entry = { id: `q-${questions.length + 1}`, at: new Date().toISOString(), ...payload };
          mock.questionPosts.push(payload);
          questions = [entry, ...questions];
          body = entry;
        } else {
          body = { questions, zoomMeta: null, generatedAt: '2026-10-12T10:00:00Z' };
        }
      } else if (url.includes('/api/knowledge')) {
        body = { knowledge };
      } else if (url.includes('/api/my-classes')) {
        body = MY_CLASSES;
      } else if (url.includes('/api/meetings')) {
        // POST /api/meetings creates a real meeting that then appears in the list.
        if (method === 'POST' && url.split('?')[0] === '/api/meetings') {
          mock.meetingPosts.push(payload);
          const created = {
            id: 9911223344,
            topic: payload?.topic,
            start_time: payload?.start_time,
            duration: payload?.duration,
            status: 'waiting',
            password: 'x7k2',
            join_url: 'https://zoom.us/j/9911223344?pwd=x7k2',
          };
          meetings = [{ ...created }, ...meetings];
          body = created;
        } else {
          body = { meetings };
        }
      } else {
        const hit = ROUTES.find(([path]) => url.includes(path));
        body = hit ? hit[1] : {};
      }

      return {
        ok: true,
        status: 200,
        text: async () => (body === null ? '' : JSON.stringify(body)),
      };
    })
  );
}

const renderApp = () =>
  render(
    <ToastProvider>
      <App />
    </ToastProvider>
  );

describe('SBC-LMS dashboard', () => {
  beforeEach(() => {
    mockFetch();
    // Fresh session state for every test: signed in as Admin by default
    // (tests that exercise the sign-in screen remove the token first).
    localStorage.clear();
    localStorage.setItem('sbc.token', 'test-token');
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the connected Zoom account on the dashboard', async () => {
    renderApp();
    expect(await screen.findByText(/Zoom account connected/)).toBeTruthy();
    // The topic appears in the spotlight card AND the upcoming list.
    expect((await screen.findAllByText('Price Action & Support/Resistance Mastery')).length).toBeGreaterThan(0);
    // Stats come from the mocked API, not hardcoded copy.
    expect(screen.getByText('Active Students (30d)')).toBeTruthy();
    expect(screen.getByText('Class Hours (30d)')).toBeTruthy();
    // Replay coverage panel cross-references sessions against recordings.
    expect(await screen.findByText('Replay coverage')).toBeTruthy();
  });

  it('collapses the sidebar to an icon rail and remembers the choice', async () => {
    renderApp();
    const toggle = await screen.findByRole('button', { name: 'Collapse sidebar' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(toggle);

    // Persisted for the next visit, and the control now offers to expand.
    expect(localStorage.getItem('sbc.sidebar-collapsed')).toBe('1');
    expect(await screen.findByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
  });

  it('switches to Zoom Sessions and lists the meeting', async () => {
    renderApp();
    fireEvent.click(await screen.findByText('Zoom Sessions'));
    expect(await screen.findByText('Zoom Workplace Pro Integration')).toBeTruthy();
    expect(await screen.findByText('Price Action & Support/Resistance Mastery')).toBeTruthy();
    expect(await screen.findByRole('link', { name: /Join/ })).toBeTruthy();
  });

  it('opens the schedule modal from the top bar', async () => {
    renderApp();
    fireEvent.click(await screen.findByText('Zoom Sessions'));
    fireEvent.click(await screen.findByText('Schedule Zoom Session'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(await screen.findByLabelText('Session Title')).toBeTruthy();
    // Regression guard: the modal must be portalled straight onto <body>.
    // If it renders inside the scrolling <main>, a leftover transform on that
    // element traps the fixed-position modal and it becomes unscrollable-to.
    expect(dialog.parentElement.parentElement).toBe(document.body);
  });

  it('renders cloud recordings with download links', async () => {
    renderApp();
    fireEvent.click(await screen.findByText('Cloud Recordings'));
    expect(await screen.findByText('Order Flow & DOM Footprint Charts Workshop')).toBeTruthy();
    expect(await screen.findByTitle('Download')).toBeTruthy();
    // Regression guard: Zoom's recording list defaults to the current day, which
    // makes the page look empty once recordings age. Always request a window.
    const call = mock.urls.find((u) => u.includes('/api/recordings?'));
    expect(call).toBeTruthy();
    expect(call).toContain('from=');
    expect(call).toContain('to=');
  });

  it('builds the student roster from real attendance', async () => {
    renderApp();
    fireEvent.click(await screen.findByText('Students & Batches'));
    // Enrolled tab is the default view (LMS CRUD over /api/students).
    expect(await screen.findByText('Priya Sharma')).toBeTruthy();
    // The roster lives in its own tab, built from /roster (attendance), not GET /users.
    fireEvent.click(await screen.findByRole('tab', { name: 'Attendance' }));
    expect(await screen.findByText('Zoe Brown')).toBeTruthy();
    expect(await screen.findByText('zoe@example.com')).toBeTruthy();
    expect(await screen.findByText('Arman Nayak')).toBeTruthy();
    // Expanding a student reveals the sessions they attended.
    fireEvent.click(await screen.findByText('Zoe Brown'));
    expect(await screen.findByText('Candlesticks 101')).toBeTruthy();
  });

  it('renders the meeting activity report with past instances', async () => {
    renderApp();
    fireEvent.click(await screen.findByText('Meeting Activity'));
    expect(await screen.findByText("SBC Traders's Personal Meeting Room")).toBeTruthy();
    expect(await screen.findByText('Attendees')).toBeTruthy();
  });

  it('attendees popup lists everyone and supports search + sort', async () => {
    renderApp();
    fireEvent.click(await screen.findByText('Meeting Activity'));
    fireEvent.click(await screen.findByRole('button', { name: /Attendees/ }));

    // Full list present (proxy aggregates all Zoom pages) — 4 join records
    expect(await screen.findByText('Arman Nayak')).toBeTruthy();
    expect(screen.getAllByText('Zoe Brown').length).toBe(2); // she rejoined
    expect(screen.getByText('Adam Smith')).toBeTruthy();
    expect(screen.getByText(/Showing 4 of 4 join records/)).toBeTruthy();

    // Sort toggle
    fireEvent.click(screen.getByTitle('Toggle name sort order'));
    expect(screen.getByText('Name Z→A')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Toggle name sort order'));
    expect(screen.getByText('Name A→Z')).toBeTruthy();

    // Search filters the list
    fireEvent.change(screen.getByLabelText('Search attendees'), { target: { value: 'zoe' } });
    expect(screen.getAllByText('Zoe Brown').length).toBe(2);
    expect(screen.queryByText('Arman Nayak')).toBeNull();
    expect(screen.getByText(/Showing 2 of 4 join records/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search attendees'), { target: { value: '' } });

    // Unique-people rollup collapses Zoe's two joins into one row with a 2× badge
    fireEvent.click(screen.getByTitle(/One row per join/));
    expect(screen.getByText('Unique people')).toBeTruthy();
    expect(screen.getAllByText('Zoe Brown')).toHaveLength(1);
    expect(screen.getByText('2×')).toBeTruthy();
    expect(screen.getByText(/Showing 3 of 3 people/)).toBeTruthy();

    // Copy button is present and enabled while rows are visible
    expect(screen.getByTitle(/Copy the rows/)).toBeTruthy();
  });

  it('renders the reference hub from the server and the AI bot', async () => {
    renderApp();
    fireEvent.click(await screen.findByText('Reference Hub'));
    // Materials come from the server-backed store, not a hardcoded array.
    expect(await screen.findByText('Zoom Meeting Controls')).toBeTruthy();
    expect(await screen.findByText('Candlestick Patterns')).toBeTruthy();
    // Each card exposes an "Open" control that launches the material's URL.
    // Exact name so the Topbar's "Open menu" button isn't counted.
    expect((await screen.findAllByRole('button', { name: 'Open' })).length).toBe(2);

    fireEvent.click(await screen.findByText('AI Knowledge Bot'));
    expect(await screen.findByText(/Quick Trading Prompts/)).toBeTruthy();
    fireEvent.click(screen.getByText(/What is stop loss/));
    await waitFor(() => expect(screen.getByText(/Risk-to-reward/)).toBeTruthy(), { timeout: 3000 });
  });

  it('lets an admin add and delete a reference material', async () => {
    renderApp();
    fireEvent.click(await screen.findByText('Reference Hub'));
    await screen.findByText('Zoom Meeting Controls');

    // Open the add dialog and submit a new material.
    fireEvent.click(await screen.findByText('Add material'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(await screen.findByLabelText(/Title/), { target: { value: 'Fibonacci Retracement Guide' } });
    fireEvent.change(await screen.findByLabelText(/Link/), { target: { value: 'https://example.com/fib' } });
    // Scope to the dialog: the header also has an "Add material" button.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add material' }));

    // The mock returns the POST body, so the new row renders.
    expect(await screen.findByText('Fibonacci Retracement Guide')).toBeTruthy();

    // Delete it via the confirm dialog.
    const deleteButtons = await screen.findAllByTitle('Delete material');
    fireEvent.click(deleteButtons[0]);
    const confirm = await screen.findByRole('dialog');
    expect(within(confirm).getByText(/Remove/)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText(/Remove/)).toBeNull(), { timeout: 3000 });
  });

  it('adds a student to a batch and browses batches', async () => {
    renderApp();
    fireEvent.click(await screen.findByText('Students & Batches'));
    expect(await screen.findByText('Priya Sharma')).toBeTruthy();

    // Enrolled tab → add dialog, assign Batch A.
    fireEvent.click(await screen.findByText('Add student'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Neha Verma' } });
    fireEvent.change(within(dialog).getByLabelText(/^Email/), { target: { value: 'neha@example.com' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Batch A/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add student' }));

    expect(await screen.findByText('Neha Verma')).toBeTruthy();
    expect(await screen.findByText('neha@example.com')).toBeTruthy();

    // Remove her again from her own row.
    const row = (await screen.findAllByRole('row')).find((r) => r.textContent.includes('Neha Verma'));
    fireEvent.click(within(row).getByTitle('Delete student'));
    const confirm = await screen.findByRole('dialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByText('Neha Verma')).toBeNull(), { timeout: 3000 });

    // Batches tab lists cohorts with their descriptions.
    fireEvent.click(await screen.findByRole('tab', { name: 'Batches' }));
    expect(await screen.findByText('Morning cohort')).toBeTruthy();
    expect(await screen.findByText('Evening cohort')).toBeTruthy();
  });

  it('requires at least one batch before scheduling a session', async () => {
    renderApp();
    fireEvent.click(await screen.findByText('Zoom Sessions'));
    fireEvent.click(await screen.findByText('Schedule Zoom Session'));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText('Session Title'), {
      target: { value: 'Unenrolled Class' },
    });
    fireEvent.change(within(dialog).getByLabelText('Date & Time'), {
      target: { value: '2030-10-14T17:30' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create & Get Join Link' }));

    // Blocked before any Zoom call: no meeting, no enrolment, dialog still open.
    expect(await screen.findByText(/Select at least one batch to enrol/)).toBeTruthy();
    expect(within(dialog).getByText(/Required — select at least one batch/)).toBeTruthy();
    expect(mock.meetingPosts).toHaveLength(0);
    expect(mock.enrollCalls).toHaveLength(0);
    expect(screen.getByRole('dialog')).toBeTruthy();

    // Selecting a batch satisfies the requirement and clears the error.
    fireEvent.click(within(dialog).getByRole('button', { name: /Batch A/ }));
    expect(within(dialog).queryByText(/Required — select at least one batch/)).toBeNull();
  });

  it('auto-registers a batch when a session is scheduled', async () => {
    renderApp();
    fireEvent.click(await screen.findByText('Zoom Sessions'));
    fireEvent.click(await screen.findByText('Schedule Zoom Session'));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText('Session Title'), {
      target: { value: 'Batch Sync Class' },
    });
    fireEvent.change(within(dialog).getByLabelText('Date & Time'), {
      target: { value: '2030-10-14T17:30' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Batch A/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create & Get Join Link' }));

    // The enroll endpoint received the picked batch and registered everyone.
    await waitFor(() => expect(mock.enrollCalls).toHaveLength(1), { timeout: 3000 });
    expect(mock.enrollCalls[0].payload.batchIds).toEqual(['bat-1']);
    // Recap toast reports the registration outcome…
    expect(await screen.findByText(/2 students registered/)).toBeTruthy();
    // …and the meeting card now shows the assigned batch.
    expect(await screen.findByText('Batch A')).toBeTruthy();
  });

  it('audits a session: who joined with duration, who could not, and batch assignment', async () => {
    renderApp();
    fireEvent.click(await screen.findByText('Meeting Activity'));
    fireEvent.click(await screen.findByRole('button', { name: /Attendance/ }));

    const dialog = await screen.findByRole('dialog');
    // Joined with total time in session…
    expect(await within(dialog).findByText('Joined with duration')).toBeTruthy();
    expect(await within(dialog).findByText('Priya Sharma')).toBeTruthy();
    expect(within(dialog).getByText('45m')).toBeTruthy();
    // …unable to join (assigned but absent)…
    expect(within(dialog).getByText('Unable to join (assigned but absent)')).toBeTruthy();
    expect(within(dialog).getByText('Arjun Mehta')).toBeTruthy();
    // …and a guest who wasn't on the expected list.
    expect(within(dialog).getByText('Adam Smith')).toBeTruthy();

    // Assign batches retroactively (records the expectation, no Zoom calls).
    fireEvent.click(within(dialog).getByText('Edit batches'));
    fireEvent.click(within(dialog).getByRole('button', { name: /Batch B/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save assignment' }));

    expect(await screen.findByText(/Batches assigned/)).toBeTruthy();
    await waitFor(() => expect(mock.targetPuts).toHaveLength(1));
    expect(mock.targetPuts[0].payload.batchIds).toEqual(['bat-1', 'bat-2']);
  });

  it('switches to the participant view with read-only resources', async () => {
    renderApp();
    expect(await screen.findByText(/Zoom account connected/)).toBeTruthy();

    // Role switcher → view the app as an enrolled student.
    fireEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    fireEvent.click(await screen.findByRole('button', { name: /Priya Sharma/ }));

    // Participants land on My Classes: personalised link + attendance history.
    expect(await screen.findByText('Batch Sync 101')).toBeTruthy();
    expect(await screen.findByText('Personal link')).toBeTruthy();
    expect(await screen.findByText('Candlesticks 101')).toBeTruthy();
    expect(await screen.findByText(/Joined · 45 min/)).toBeTruthy();

    // Admin-only modules and quick actions disappear; shared ones remain.
    expect(screen.queryByText('Zoom Sessions')).toBeNull();
    expect(screen.queryByText('Meeting Activity')).toBeNull();
    expect(screen.queryByText('Students & Batches')).toBeNull();
    expect(screen.queryByText('Q&A Log')).toBeNull();
    expect(screen.getByText('Cloud Recordings')).toBeTruthy();
    expect(screen.queryByText('Schedule Zoom')).toBeNull();
    expect(screen.queryByText('Broadcast')).toBeNull();

    // Reference Hub is read-only for participants.
    fireEvent.click(await screen.findByText('Reference Hub'));
    expect(await screen.findByText('Zoom Meeting Controls')).toBeTruthy();
    expect(screen.queryByText('Add material')).toBeNull();
    expect(screen.queryByTitle('Delete material')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(2);
  });

  it('logs chatbot questions with attribution and promotes answers to the knowledge base', async () => {
    renderApp();
    fireEvent.click(await screen.findByText('AI Knowledge Bot'));
    fireEvent.click(await screen.findByText(/What is stop loss/));

    // Every question is POSTed to the Q&A audit log with the viewer attached.
    await waitFor(() => expect(mock.questionPosts.length).toBeGreaterThan(0), { timeout: 3000 });
    expect(mock.questionPosts[0].askedBy).toBe('Dr. Alex Vance');
    expect(mock.questionPosts[0].role).toBe('admin');

    // The admin's Q&A Log shows it alongside the seeded entry.
    fireEvent.click(await screen.findByText('Q&A Log'));
    expect(await screen.findByText(/What is stop loss/)).toBeTruthy();
    expect(await screen.findByText(/How do I set a stop loss/)).toBeTruthy();

    // Promote an answered pair into the bot's knowledge base.
    const promoteButtons = await screen.findAllByRole('button', {
      name: /Push to AI knowledge base/,
    });
    expect(promoteButtons.length).toBeGreaterThan(0);
    fireEvent.click(promoteButtons[0]);
    expect(await screen.findByText(/In the bot's knowledge base/)).toBeTruthy();
  });

  it('answers where to find a recording passcode instead of recommending a course', async () => {
    renderApp();
    fireEvent.click(await screen.findByText('AI Knowledge Bot'));

    fireEvent.change(screen.getByPlaceholderText(/Ask anything about trading/), {
      target: { value: 'where can I get the zoom recording passkey' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));

    // The real home of the passcode, not the beginner-recording pitch.
    expect(await screen.findByText(/Recording passcode:/)).toBeTruthy();
    expect(screen.getByText(/passcodes are under Cloud Recordings/)).toBeTruthy();
    expect(screen.queryByText(/Risk Management 101/)).toBeNull();
  });

  it('refuses questions that are not about trading or this app', async () => {
    renderApp();
    fireEvent.click(await screen.findByText('AI Knowledge Bot'));

    fireEvent.change(screen.getByPlaceholderText(/Ask anything about trading/), {
      target: { value: 'how do I bake a chocolate cake' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));

    expect(await screen.findByText(/outside what I can help with/i)).toBeTruthy();
    // It must not pretend the knowledge base answered it.
    expect(screen.queryByText(/could not find that in the local knowledge base/i)).toBeNull();
  });

  it('does not repeat an answer when the same question is submitted repeatedly', async () => {
    renderApp();
    fireEvent.click(await screen.findByText('AI Knowledge Bot'));

    // A rapid burst on the same quick prompt (double Enter / repeated clicks).
    const prompt = () => screen.getByRole('button', { name: /What is stop loss/ });
    fireEvent.click(prompt());
    fireEvent.click(prompt());
    fireEvent.click(prompt());
    fireEvent.click(prompt());
    fireEvent.click(prompt());

    await waitFor(() => expect(mock.questionPosts).toHaveLength(1), { timeout: 3000 });
    expect(screen.getAllByText(/single win earns/)).toHaveLength(1);
  });

  it('collapses duplicate answers saved by an older conversation', async () => {
    const asked = { sender: 'user', text: 'where can I get the zoom recording passkey', time: '4:41 pm' };
    const repeated = { sender: 'bot', text: 'Start with the beginner recording.', time: '4:41 pm' };
    localStorage.setItem(
      'sbc.chat.admin',
      JSON.stringify([
        { sender: 'bot', text: 'Welcome!', time: '9:00 AM' },
        asked, repeated, asked, repeated, asked, repeated, asked, repeated, asked, repeated,
      ])
    );

    renderApp();
    fireEvent.click(await screen.findByText('AI Knowledge Bot'));

    expect(await screen.findByText('Start with the beginner recording.')).toBeTruthy();
    expect(screen.getAllByText('Start with the beginner recording.')).toHaveLength(1);
    expect(screen.getAllByText('where can I get the zoom recording passkey')).toHaveLength(1);
  });

  it('keeps the chat conversation when navigating away and back', async () => {
    renderApp();
    fireEvent.click(await screen.findByText('AI Knowledge Bot'));
    fireEvent.click(await screen.findByText(/What is stop loss/));
    await waitFor(() => expect(mock.questionPosts.length).toBeGreaterThan(0), { timeout: 3000 });
    expect(await screen.findByText(/single win earns/)).toBeTruthy(); // the reply

    // Leave the chat and come back — the conversation must survive.
    fireEvent.click(screen.getByText('Dashboard'));
    fireEvent.click(await screen.findByText('AI Knowledge Bot'));
    expect(screen.getByText(/single win earns/)).toBeTruthy();
    expect(screen.getAllByText(/What is stop loss/).length).toBeGreaterThan(1); // prompt + sent message

    // …and it was persisted per viewer (admin vs each student).
    const saved = JSON.parse(localStorage.getItem('sbc.chat.admin') || '[]');
    expect(saved.length).toBeGreaterThanOrEqual(3);
  });

  it('syncs the conversation through the server (visible in another browser)', async () => {
    renderApp();
    fireEvent.click(await screen.findByText('AI Knowledge Bot'));
    fireEvent.click(await screen.findByText(/What is stop loss/));
    expect(await screen.findByText(/single win earns/)).toBeTruthy();

    // The conversation was mirrored to the server-side store…
    await waitFor(() => expect(mock.chatPuts.length).toBeGreaterThan(0), { timeout: 3000 });

    // …so a browser with NO local storage at all still sees it.
    localStorage.removeItem('sbc.chat.admin');
    fireEvent.click(screen.getByText('Dashboard'));
    fireEvent.click(await screen.findByText('AI Knowledge Bot'));
    expect(await screen.findByText(/single win earns/)).toBeTruthy();
    expect(screen.getAllByText(/What is stop loss/).length).toBeGreaterThan(1); // prompt + sent message
  });

  it('lets the admin correct a logged answer, served back to the student', async () => {
    renderApp();
    fireEvent.click(await screen.findByText('Q&A Log'));

    // Open the editor on a logged, answered question.
    const editButtons = await screen.findAllByRole('button', { name: /Edit answer/ });
    expect(editButtons.length).toBeGreaterThan(0);
    fireEvent.click(editButtons[0]);

    // Write the mentor's response and save it.
    fireEvent.change(await screen.findByLabelText('Your response'), {
      target: { value: 'Mentor-corrected: always risk 1% per trade.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save response/ }));

    expect(await screen.findByText(/Response saved/)).toBeTruthy();
    await waitFor(() => expect(mock.questionPatches.length).toBe(1), { timeout: 3000 });
    expect(mock.questionPatches[0].answer).toBe('Mentor-corrected: always risk 1% per trade.');

    // The row now shows the mentor response, the edited answer and the badge.
    expect(await screen.findByText(/Mentor-corrected: always risk 1% per trade\./)).toBeTruthy();
    expect(screen.getByText(/Mentor response — served by the bot/)).toBeTruthy();
  });

  it('shows the mentor-edited answer inside the asker’s own chat', async () => {
    // A stored conversation where the bot gave the old AI answer.
    localStorage.setItem(
      'sbc.chat.admin',
      JSON.stringify([
        { sender: 'bot', text: 'Welcome!', time: '9:00 AM' },
        { sender: 'user', text: 'How do I set a stop loss?', time: '9:01 AM' },
        { sender: 'bot', text: 'The old textbook answer.', time: '9:01 AM' },
      ])
    );
    renderApp();

    // The mentor corrects that answer in the Q&A Log.
    fireEvent.click(await screen.findByText('Q&A Log'));
    fireEvent.change(await screen.findByPlaceholderText('Search questions…'), {
      target: { value: 'set a stop loss' },
    });
    const editButtons = await screen.findAllByRole('button', { name: /Edit answer/ });
    expect(editButtons.length).toBe(1);
    fireEvent.click(editButtons[0]);
    fireEvent.change(await screen.findByLabelText('Your response'), {
      target: { value: 'Mentor says: risk 1% per trade, R:R above 1:2.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save response/ }));
    expect(await screen.findByText(/Response saved/)).toBeTruthy();

    // Opening the chat shows the mentor's wording where the old answer was.
    // (Sidebar nav item is a button; the Q&A row's "AI Knowledge Bot" badge is not.)
    fireEvent.click(screen.getByRole('button', { name: /AI Knowledge Bot/ }));
    expect(await screen.findByText(/Mentor says: risk 1% per trade/)).toBeTruthy();
    expect(screen.queryByText('The old textbook answer.')).toBeNull();
    expect(screen.getByText(/mentor-corrected/)).toBeTruthy();
  });

  it('requires sign-in and accepts the admin PIN', async () => {
    localStorage.removeItem('sbc.token');
    renderApp();

    // Sign-in screen, not the dashboard.
    expect(await screen.findByLabelText('Admin PIN')).toBeTruthy();
    expect(screen.queryByText('Zoom Sessions')).toBeNull();

    // Wrong PIN → inline error, still on the login screen.
    fireEvent.change(screen.getByLabelText('Admin PIN'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign in/ }));
    expect(await screen.findByText('Incorrect admin PIN.')).toBeTruthy();
    expect(screen.getByLabelText('Admin PIN')).toBeTruthy();

    // Correct PIN → dashboard for the admin session.
    fireEvent.change(screen.getByLabelText('Admin PIN'), { target: { value: '625158' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign in/ }));
    expect(await screen.findByText(/Zoom account connected/)).toBeTruthy();
    expect(screen.getByText('Zoom Sessions')).toBeTruthy();
  });

  it('signs a student in with email + password (no name dropdown)', async () => {
    localStorage.removeItem('sbc.token');
    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: /Student/ }));

    // Roster dropdown is gone — the class list is never exposed on the page.
    expect(await screen.findByLabelText('Email')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();

    // Wrong password → inline error, still on the login screen.
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'priya@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-pass' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign in/ }));
    expect(await screen.findByText('Email or password is incorrect.')).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();

    // Correct class password → participant view.
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'class-pass-1' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign in/ }));

    // Their session lands on My Classes with admin nav gone.
    expect(await screen.findByText('Batch Sync 101')).toBeTruthy();
    expect(screen.queryByText('Zoom Sessions')).toBeNull();
    expect(screen.queryByText('Students & Batches')).toBeNull();
    expect(screen.getByText('Cloud Recordings')).toBeTruthy();
  });

  it('lets a student change their password from the account menu', async () => {
    localStorage.removeItem('sbc.token');
    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: /Student/ }));
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'priya@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'class-pass-1' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign in/ }));
    expect(await screen.findByText('Batch Sync 101')).toBeTruthy();

    // Account menu (participant session only) offers Change password.
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    // Mismatched confirmation is caught client-side.
    fireEvent.change(await screen.findByLabelText('Current password'), { target: { value: 'class-pass-1' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'secret-99' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'secret-88' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText("The new passwords don't match.")).toBeTruthy();

    // Matching → server stores the personal override, toast confirms.
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'secret-99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Password changed')).toBeTruthy();
    expect(mock.passwordChanges).toContain('secret-99');
  });

  it('signs out from the account menu back to the sign-in screen', async () => {
    renderApp(); // boots as Admin (token seeded in beforeEach)
    expect(await screen.findByText(/Zoom account connected/)).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    // The session is gone: sign-in screen returns, dashboard shell unmounts.
    expect(await screen.findByLabelText('Admin PIN')).toBeTruthy();
    expect(screen.queryByText('Zoom Sessions')).toBeNull();
    expect(screen.queryByText('Broadcast')).toBeNull();
  });
});
