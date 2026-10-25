import {
  Bot,
  BookMarked,
  CalendarClock,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  GraduationCap,
  Video,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../hooks/useApi.js';
import { Badge, EmptyState, ErrorNotice, Panel, Spinner } from '../components/ui.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import { formatDateTime, formatDuration, formatMeetingId } from '../lib/format.js';

/**
 * Participant view — "My Classes".
 *
 * Shows the sessions assigned to the student's batches (with their
 * personalised Zoom join link when they were registered) plus an honest
 * attended/absent history computed from real participant data.
 *
 *   GET /api/my-classes?studentId=…
 */
export default function MyClasses({ student, onNavigate }) {
  const { showToast } = useToast();
  const classes = useApi(
    () =>
      student
        ? api.get(`/my-classes?studentId=${encodeURIComponent(student.id)}`)
        : Promise.resolve(null),
    [student?.id],
    { immediate: Boolean(student) }
  );

  if (!student) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="No student selected"
        hint="Open the role switcher in the top-right corner (avatar → Participants) and pick a student to view the platform the way they see it."
      />
    );
  }

  const data = classes.data;
  const stats = data?.stats;
  const upcoming = data?.upcoming || [];
  const past = data?.past || [];

  const copyLink = async (url) => {
    try {
      await navigator.clipboard?.writeText(url);
      showToast('Join link copied to clipboard.', 'Copied');
    } catch {
      showToast('The browser blocked clipboard access.', 'Copy failed', 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Student header */}
      <Panel className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-tr from-accent-blue to-indigo-600 text-sm font-bold text-white shadow">
            {student.name
              .split(/\s+/)
              .map((p) => p[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()}
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-white">{student.name}</h3>
            <p className="truncate text-xs text-slate-400">{student.email || 'no email on file'}</p>
            <p className="mt-1 flex flex-wrap gap-1.5">
              {(data?.student?.batches || []).length ? (
                data.student.batches.map((name) => (
                  <Badge key={name} className="border border-blue-500/20 bg-blue-500/10 text-blue-400">
                    {name}
                  </Badge>
                ))
              ) : (
                <Badge className="border border-amber-500/20 bg-amber-500/10 text-amber-400">
                  Not in a batch yet
                </Badge>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onNavigate?.('resources')}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
          >
            <BookMarked size={13} className="text-accent-cyan" /> References
          </button>
          <button
            onClick={() => onNavigate?.('chatbot')}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
          >
            <Bot size={13} className="text-accent-purple" /> Ask the AI bot
          </button>
        </div>
      </Panel>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
        <Stat label="Upcoming classes" value={classes.loading ? '…' : stats?.upcoming ?? '—'} tone="text-accent-emerald" icon={CalendarClock} />
        <Stat label="Attended" value={classes.loading ? '…' : stats?.attended ?? '—'} tone="text-accent-blue" icon={CheckCircle2} />
        <Stat label="Missed" value={classes.loading ? '…' : stats?.missed ?? '—'} tone="text-accent-red" icon={XCircle} />
        <Stat
          label="Class time"
          value={classes.loading ? '…' : stats ? formatDuration(stats.minutes) : '—'}
          tone="text-accent-cyan"
          icon={Clock}
        />
      </div>

      {classes.loading ? (
        <Spinner label="Loading your classes…" />
      ) : classes.error ? (
        <ErrorNotice title="Could not load your classes" error={classes.error} onRetry={classes.refresh} />
      ) : (
        <>
          {/* Upcoming */}
          <section>
            <h3 className="mb-3 text-sm font-bold text-white">Upcoming classes</h3>
            {upcoming.length === 0 ? (
              <EmptyState
                icon={Video}
                title="No upcoming classes for your batches yet"
                hint="When your mentor schedules a session and assigns your batch, it appears here with your personal join link."
              />
            ) : (
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                {upcoming.map((m) => (
                  <Panel key={m.id} className="flex flex-col justify-between p-5">
                    <div>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <Badge className="border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
                          <CalendarClock size={10} /> {formatDateTime(m.start_time)}
                        </Badge>
                        <Badge
                          className={
                            m.registered
                              ? 'border border-accent-blue/30 bg-accent-blue/10 text-accent-blue'
                              : 'border border-slate-600/40 bg-slate-700/20 text-slate-300'
                          }
                        >
                          {m.registered ? 'Personal link' : 'Shared link'}
                        </Badge>
                      </div>
                      <h4 className="mb-1 text-base font-bold text-white">{m.topic}</h4>
                      <p className="text-xs text-slate-400">
                        {formatDuration(m.duration)} · ID {formatMeetingId(m.id)}
                      </p>
                      <p className="mt-1.5 flex flex-wrap gap-1.5">
                        {(m.batchNames || []).map((name) => (
                          <Badge key={name} className="border border-blue-500/20 bg-blue-500/10 text-blue-400">
                            {name}
                          </Badge>
                        ))}
                      </p>
                    </div>
                    <div className="mt-4 flex items-center gap-2 border-t border-slate-800 pt-4">
                      <a
                        href={m.joinUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 rounded-lg bg-accent-emerald px-3.5 py-2 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-600"
                      >
                        <Video size={12} /> Join class <ExternalLink size={10} />
                      </a>
                      <button
                        onClick={() => copyLink(m.joinUrl)}
                        title="Copy join link"
                        className="grid h-8 w-8 place-items-center rounded-lg bg-slate-800 text-slate-400 transition hover:bg-slate-700 hover:text-white"
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                  </Panel>
                ))}
              </div>
            )}
          </section>

          {/* Past */}
          <section>
            <h3 className="mb-3 text-sm font-bold text-white">Past classes (attendance)</h3>
            {past.length === 0 ? (
              <EmptyState
                icon={Clock}
                title="No past classes for your batches"
                hint="Attendance for your batches will show up here after the first session ends."
              />
            ) : (
              <Panel className="p-5">
                <ul className="divide-y divide-slate-800/60">
                  {past.map((m, i) => (
                    <li
                      key={`${m.uuid || m.id}-${i}`}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{m.topic || 'Session'}</p>
                        <p className="text-[11px] text-slate-400">
                          {formatDateTime(m.start_time)} · {formatDuration(m.duration)} ·{' '}
                          {m.participants ?? '—'} joined in total
                        </p>
                      </div>
                      {m.joined ? (
                        <Badge className="border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
                          <CheckCircle2 size={10} /> Joined · {formatDuration(m.minutes)}
                        </Badge>
                      ) : (
                        <Badge className="border border-red-500/20 bg-red-500/10 text-red-400">
                          <XCircle size={10} /> Absent
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone, icon: Icon }) {
  return (
    <Panel className="p-4">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        <Icon size={11} className="text-slate-500" /> {label}
      </p>
      <p className={`mt-2 text-2xl font-extrabold ${tone}`}>{value}</p>
    </Panel>
  );
}
