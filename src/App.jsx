import { useEffect, useMemo, useState } from 'react';
import Sidebar, { navForRole } from './components/Sidebar.jsx';
import Topbar from './components/Topbar.jsx';
import { Spinner } from './components/ui.jsx';
import { useApi } from './hooks/useApi.js';
import { api, getToken, setToken } from './lib/api.js';
import Login from './pages/Login.jsx';

import Dashboard from './pages/Dashboard.jsx';
import Sessions from './pages/Sessions.jsx';
import Activity from './pages/Activity.jsx';
import Recordings from './pages/Recordings.jsx';
import Students from './pages/Students.jsx';
import MyClasses from './pages/MyClasses.jsx';
import Questions from './pages/Questions.jsx';
import Resources from './pages/Resources.jsx';
import Chatbot from './pages/Chatbot.jsx';
import Broadcast from './components/Broadcast.jsx';

const TITLES = {
  dashboard: {
    title: 'Dashboard Overview',
    subtitle: 'Institution key metrics, upcoming Zoom sessions & live activity.',
  },
  myclasses: {
    title: 'My Classes',
    subtitle: 'Sessions assigned to your batches, personalised join links and attendance.',
  },
  sessions: {
    title: 'Zoom Sessions & Calendar',
    subtitle: 'Create, edit and share real Zoom meetings, registrants and join links.',
  },
  activity: {
    title: 'Meeting Activity',
    subtitle: 'Every past session instance on the account — the same history Zoom lists under Attachments.',
  },
  recordings: {
    title: 'Cloud Recordings',
    subtitle: 'Recordings synced from your Zoom Pro account, ready to share with cohorts.',
  },
  students: {
    title: 'Students & Batches',
    subtitle: 'Enrol students, group them into batches, then audit who actually attended.',
  },
  questions: {
    title: 'Q&A Audit Log',
    subtitle: 'Every question asked in the AI bot and inside Zoom sessions — with attribution.',
  },
  resources: {
    title: 'Reference Hub & Materials',
    subtitle: 'Curated trading guides, cheat sheets, indicators, and playbooks.',
  },
  chatbot: {
    title: 'AI Knowledge-Base & Live Chat',
    subtitle: 'Dual-mode assistant for real-time webinars and self-paced study.',
  },
};

const readStoredPreview = () => localStorage.getItem('sbc.viewer') || '';

export default function App() {
  // Session (light auth): null until a token has been validated server-side.
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);
  // Admin-only "view as" preview student (NOT a role — participants are
  // locked to the role their sign-in session grants).
  const [previewId, setPreviewId] = useState(readStoredPreview);
  const [tab, setTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [scheduleSignal, setScheduleSignal] = useState(0);
  const [broadcastOpen, setBroadcastOpen] = useState(false);

  // Validate any stored token with the server (catches expiry/revocation).
  useEffect(() => {
    let alive = true;
    if (!getToken()) {
      setBooting(false);
      return undefined;
    }
    api
      .get('/auth/me')
      .then((s) => alive && setSession(s))
      .catch(() => {
        /* the 401 handler in api.js already dropped the token */
      })
      .finally(() => alive && setBooting(false));
    return () => {
      alive = false;
    };
  }, []);

  // Session expired / revoked while using the app → back to sign-in.
  useEffect(() => {
    const onSignout = () => setSession(null);
    window.addEventListener('sbc:signout', onSignout);
    return () => window.removeEventListener('sbc:signout', onSignout);
  }, []);

  const signOut = async () => {
    try {
      await api.post('/auth/logout', {});
    } catch {
      /* token already invalid — nothing to revoke */
    }
    setToken('');
    setSession(null);
  };

  const isAdminSession = session?.role === 'admin';

  // Poll Zoom for the signed-in host account (drives the sidebar status pill).
  const health = useApi(() => api.get('/health'), [], { immediate: Boolean(session) });
  useEffect(() => {
    if (!session) return undefined;
    const id = setInterval(() => health.refresh(), 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Enrolled students drive the admin's "view as" switcher (freshened when
  // its menu opens). Participants never call this (403 by design).
  const students = useApi(() => api.get('/students'), [], { immediate: Boolean(session) });
  const studentList = useMemo(() => students.data?.students || [], [students.data]);

  useEffect(() => {
    localStorage.setItem('sbc.viewer', previewId);
  }, [previewId]);

  // A role switch can leave the current tab out of reach — fall back to the
  // role's landing page (admin: dashboard, participant: my classes).
  const role = !session
    ? 'admin'
    : isAdminSession
      ? previewId
        ? 'participant'
        : 'admin'
      : 'participant';

  useEffect(() => {
    if (!session) return;
    const allowed = navForRole(role).map((item) => item.id);
    if (!allowed.includes(tab)) setTab(role === 'participant' ? 'myclasses' : 'dashboard');
  }, [session, role, tab]);

  const viewer = !session
    ? null
    : isAdminSession
      ? studentList.find((s) => s.id === previewId) || null
      : session.user || null;

  // Admin-only preview: sign in as someone else is impossible, so guard it.
  const switchRole = (nextRole, studentId = '') => {
    if (!isAdminSession) return;
    setPreviewId(nextRole === 'participant' ? studentId : '');
  };

  // Identity handed to pages that attribute actions (chatbot questions…).
  const identity =
    role === 'admin'
      ? { role: 'admin', name: health.data?.account?.name || 'Head Mentor', email: health.data?.account?.email || '' }
      : viewer
        ? { role: 'participant', name: viewer.name, email: viewer.email, id: viewer.id }
        : { role: 'participant', name: 'Participant', email: '' };

  const openSchedule = () => {
    if (tab !== 'sessions') setTab('sessions');
    setScheduleSignal((n) => n + 1);
  };

  const meta = TITLES[tab] || TITLES.dashboard;

  // Light auth gate: no session → sign-in screen (App still mounted so the
  // auth/me + sign-out listeners above keep working).
  if (booting) {
    return (
      <div className="grid min-h-screen place-items-center bg-dark-bg">
        <Spinner label="Checking your session…" />
      </div>
    );
  }
  if (!session) {
    return (
      <Login
        onSignIn={(s) => {
          setToken(s.token);
          setSession(s);
        }}
      />
    );
  }

  let page = null;
  if (tab === 'dashboard') page = <Dashboard account={health.data} onNavigate={setTab} />;
  else if (tab === 'myclasses') page = <MyClasses student={viewer} onNavigate={setTab} />;
  else if (tab === 'sessions')
    page = <Sessions scheduleSignal={scheduleSignal} onOpenBroadcast={() => setBroadcastOpen(true)} />;
  else if (tab === 'activity') page = <Activity />;
  else if (tab === 'recordings') page = <Recordings />;
  else if (tab === 'students') page = <Students />;
  else if (tab === 'questions') page = <Questions />;
  else if (tab === 'resources') page = <Resources canEdit={role === 'admin'} />;
  else if (tab === 'chatbot') page = <Chatbot viewer={identity} />;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        active={tab}
        onNavigate={setTab}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        account={health.data}
        role={role}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar
          title={meta.title}
          subtitle={meta.subtitle}
          onMenu={() => setSidebarOpen(true)}
          onSchedule={openSchedule}
          onBroadcast={() => setBroadcastOpen(true)}
          account={health.data}
          role={role}
          isHost={Boolean(isAdminSession)}
          viewer={viewer}
          students={studentList}
          onSwitchRole={switchRole}
          onRefreshStudents={students.refresh}
          onSignOut={signOut}
        />

        <main key={tab} className="fade-in flex-1 overflow-y-auto bg-dark-bg p-4 sm:p-6">
          {page}
        </main>

        <footer className="border-t border-slate-800 bg-card-bg px-4 py-2 text-[10px] text-slate-500 sm:px-6">
          {navForRole(role).length} modules · Zoom Server-to-Server OAuth ·{' '}
          {health.data?.ok ? 'API connected' : health.error ? 'API unreachable' : 'checking API…'}
        </footer>
      </div>

      <Broadcast open={broadcastOpen} onClose={() => setBroadcastOpen(false)} />
    </div>
  );
}
