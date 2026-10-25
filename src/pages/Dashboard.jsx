import {
  Users,
  Video,
  CirclePlay,
  CalendarClock,
  ArrowUpRight,
  Radio,
  Globe,
  GraduationCap,
  Clock,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../hooks/useApi.js';
import { ErrorNotice, Panel, Skeleton, Spinner, StatCard, Badge } from '../components/ui.jsx';
import { formatDateTime, formatMeetingId, formatDuration } from '../lib/format.js';

export default function Dashboard({ account, onNavigate }) {
  const meetings = useApi(() => api.get('/meetings?type=upcoming'));
  const webinars = useApi(() => api.get('/webinars'));
  // Real learning metrics: who actually attended, how much class time.
  const roster = useApi(() => api.get('/roster?days=30'));
  // Recent sessions vs. what got recorded — surfaces classes students can't replay.
  const coverage = useApi(() => api.get('/coverage?days=14'));

  const list = meetings.data?.meetings || [];
  const upcoming = [...list].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  const next = upcoming[0];
  const webinarCount = webinars.data?.total_records ?? 0;

  const students = roster.data?.students || [];
  const studentCount = roster.data?.totalStudents ?? 0;
  const classMinutes = students.reduce((sum, s) => sum + s.totalMinutes, 0);
  const classHours = Math.round(classMinutes / 60);
  const activeThisWeek = students.filter(
    (s) => Date.now() - new Date(s.lastAttended).getTime() < 7 * 86_400_000
  ).length;
  const topStudent = [...students].sort((a, b) => b.totalMinutes - a.totalMinutes)[0];

  const daysUntil = next?.start_time
    ? Math.ceil((new Date(next.start_time) - Date.now()) / 86_400_000)
    : null;

  const whenText = next?.start_time
    ? daysUntil === 0
      ? 'Today'
      : daysUntil === 1
        ? 'Tomorrow'
        : `In ${daysUntil} days`
    : 'No sessions';

  return (
    <div className="space-y-6">
      {/* Connection banner ------------------------------------------------ */}
      {!account?.ok ? (
        <ErrorNotice
          title={account?.configured ? 'Zoom API not connected' : 'Zoom credentials not configured'}
          error={
            account?.message ||
            'Filling ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET in .env and restarting the API server.'
          }
          onRetry={() => window.location.reload()}
        />
      ) : (
        <Panel className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-emerald/10 text-accent-emerald">
              <Radio size={16} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white">
                Zoom account connected — {account.account?.name || 'host'}
              </p>
              <p className="truncate text-xs text-slate-400">
                Server-to-Server OAuth token cached for {account.tokenExpiresIn}s · scopes: meetings,
                registrants, recordings, users, webinars
              </p>
            </div>
          </div>
          <Badge className="border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
            Live data from api.zoom.us
          </Badge>
        </Panel>
      )}

      {/* Stat cards ------------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active Students (30d)"
          icon={Users}
          accent="bg-accent-emerald/10 text-accent-emerald"
          value={roster.loading ? '…' : roster.error ? '—' : studentCount}
          delta={roster.error ? 'roster unavailable' : `${activeThisWeek} this week`}
          deltaTone={roster.error ? 'text-amber-400' : 'text-accent-emerald'}
          hint="People who actually attended a session, not Zoom seats"
        />
        <StatCard
          label="Upcoming Sessions"
          icon={Video}
          accent="bg-accent-blue/10 text-accent-blue"
          value={meetings.loading ? '…' : upcoming.length}
          delta={whenText}
          deltaTone="text-accent-blue"
          hint={next ? `Next: ${next.topic}` : 'Schedule one from the top-right button'}
        />
        <StatCard
          label="Class Hours (30d)"
          icon={Clock}
          accent="bg-accent-cyan/10 text-accent-cyan"
          value={roster.loading ? '…' : roster.error ? '—' : `${classHours}h`}
          delta={roster.error ? '—' : `${roster.data?.sessionsAnalyzed ?? '—'} sessions`}
          deltaTone="text-accent-cyan"
          hint="Total student time in class across all sessions"
        />
        <StatCard
          label="Webinars"
          icon={Globe}
          accent="bg-accent-purple/10 text-accent-purple"
          value={webinars.loading ? '…' : webinars.error ? '—' : webinarCount}
          delta={webinars.error ? 'Plan required' : 'Webinar license'}
          deltaTone={webinars.error ? 'text-amber-400' : 'text-accent-purple'}
          hint={
            webinars.error
              ? 'This Zoom account has no webinar plan, so webinar routes are unavailable'
              : 'Panel-driven webinars for large cohorts'
          }
        />
      </div>

      {/* Spotlight + quick actions --------------------------------------- */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel className="relative overflow-hidden lg:col-span-2">
          <div className="pointer-events-none absolute right-0 top-0 h-64 w-64 rounded-full bg-accent-emerald/5 blur-3xl" />
          <div className="flex flex-col justify-between gap-6 p-6">
            <div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <span className="live-glow inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-accent-emerald">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-accent-emerald" />
                  Upcoming Zoom Pro Session
                </span>
                <span className="text-xs text-slate-400">
                  <CalendarClock size={12} className="mr-1 inline" />
                  {next?.start_time ? `${formatDateTime(next.start_time)} · ${whenText}` : 'Nothing scheduled'}
                </span>
              </div>

              {meetings.loading ? (
                <Skeleton rows={3} />
              ) : next ? (
                <>
                  <h3 className="mb-2 text-xl font-bold text-white">{next.topic}</h3>
                  <p className="mb-4 text-xs leading-relaxed text-slate-300">
                    Meeting ID <span className="font-mono text-accent-blue">{formatMeetingId(next.id)}</span> ·{' '}
                    {formatDuration(next.duration)} · hosted on your Zoom Pro licence. Students click
                    through to zoom.us — no extra SDK app required.
                  </p>
                </>
              ) : (
                <p className="text-sm text-slate-400">
                  No upcoming meetings on this Zoom account yet. Use “Schedule Zoom” to create your first
                  real session.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-800 pt-4">
              <span className="text-xs text-slate-300">
                {topStudent
                  ? `Most engaged: ${topStudent.name} — ${topStudent.sessions} sessions, ${Math.round(topStudent.totalMinutes / 60)}h`
                  : roster.loading
                    ? 'Loading attendance…'
                    : 'No attendance recorded yet'}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => onNavigate('sessions')}
                  className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-200 transition hover:bg-slate-700"
                >
                  Manage sessions <ArrowUpRight size={13} />
                </button>
                {next?.join_url ? (
                  <a
                    href={next.join_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-xl bg-accent-emerald px-5 py-2.5 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-600"
                  >
                    <Video size={13} /> Launch Zoom
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </Panel>

        <Panel className="p-6">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-white">
            <GraduationCap size={16} className="text-accent-cyan" /> Quick Institution Tools
          </h3>
          <div className="space-y-2.5">
            <QuickAction label="Schedule a Zoom class" icon={Video} tone="text-accent-emerald" onClick={() => onNavigate('sessions')} />
            <QuickAction label="Browse cloud recordings" icon={CirclePlay} tone="text-accent-blue" onClick={() => onNavigate('recordings')} />
            <QuickAction label="Student roster" icon={Users} tone="text-accent-purple" onClick={() => onNavigate('students')} />
            <QuickAction label="Reference hub" icon={GraduationCap} tone="text-accent-cyan" onClick={() => onNavigate('resources')} />
          </div>

          <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-[11px] text-slate-500">
            <p className="font-semibold text-slate-400">Credential status</p>
            <p className="mt-1">
              Account ID / Client ID are stored server-side in <code>.env</code> and never sent to this
              browser.
            </p>
          </div>
        </Panel>
      </div>

      {/* Upcoming list ----------------------------------------------------- */}
      <Panel className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Next sessions on your account</h3>
          <button
            onClick={() => onNavigate('sessions')}
            className="text-xs font-semibold text-accent-blue hover:underline"
          >
            View all
          </button>
        </div>

        {meetings.loading ? (
          <Spinner label="Loading meetings from Zoom…" />
        ) : meetings.error ? (
          <ErrorNotice error={meetings.error} onRetry={meetings.refresh} />
        ) : upcoming.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-500">No upcoming meetings found.</p>
        ) : (
          <ul className="divide-y divide-slate-800/60">
            {upcoming.slice(0, 6).map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{m.topic}</p>
                  <p className="text-[11px] text-slate-400">
                    {formatDateTime(m.start_time)} · ID{' '}
                    <span className="font-mono text-slate-300">{formatMeetingId(m.id)}</span>
                  </p>
                </div>
                <a
                  href={m.join_url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 transition hover:bg-slate-700"
                >
                  Join
                </a>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* Recording coverage ---------------------------------------------- */}
      <Panel className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white">Replay coverage</h3>
            <p className="text-[11px] text-slate-400">
              Sessions from the last {coverage.data?.windowDays ?? 14} days and whether students can
              replay them.
            </p>
          </div>
          <button
            onClick={() => onNavigate('recordings')}
            className="text-xs font-semibold text-accent-blue hover:underline"
          >
            Open recordings
          </button>
        </div>

        {coverage.loading ? (
          <Spinner label="Checking which sessions were recorded…" />
        ) : coverage.error ? (
          <ErrorNotice error={coverage.error} onRetry={coverage.refresh} />
        ) : coverage.data?.total === 0 ? (
          <p className="py-6 text-center text-xs text-slate-500">
            No sessions in this window.
          </p>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3 text-xs">
              <span className="text-slate-300">
                <strong className="text-accent-emerald">{coverage.data.recorded}</strong> recorded
              </span>
              <span className="text-slate-300">
                <strong className={coverage.data.missingCount ? 'text-amber-400' : 'text-slate-400'}>
                  {coverage.data.missingCount}
                </strong> without a replay
              </span>
              {coverage.data.total ? (
                <div className="ml-auto flex h-2 w-40 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full bg-accent-emerald"
                    style={{ width: `${(coverage.data.recorded / coverage.data.total) * 100}%` }}
                  />
                </div>
              ) : null}
            </div>

            <ul className="max-h-72 divide-y divide-slate-800/60 overflow-y-auto pr-1">
              {coverage.data.sessions.map((s) => (
                <li key={s.uuid || s.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-slate-200">{s.topic || 'Session'}</p>
                    <p className="truncate text-[10px] text-slate-500">
                      {formatDateTime(s.start_time)} · {formatDuration(s.duration)} ·{' '}
                      {s.participants ?? 0} attended
                    </p>
                  </div>
                  {s.recorded ? (
                    <span className="shrink-0 rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-accent-emerald">
                      Recorded
                    </span>
                  ) : (
                    <span className="shrink-0 rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                      No replay
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    </div>
  );
}

function QuickAction({ label, icon: Icon, tone, onClick }) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900/80 p-3 text-xs font-medium text-slate-200 transition hover:bg-slate-800"
    >
      <span className="flex items-center gap-2.5">
        <Icon size={14} className={tone} />
        {label}
      </span>
      <ArrowUpRight size={12} className="text-slate-500 transition group-hover:text-white" />
    </button>
  );
}
