import { useMemo, useState } from 'react';
import {
  Activity as ActivityIcon,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarRange,
  Check,
  ClipboardList,
  Copy,
  ListChecks,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../hooks/useApi.js';
import Modal from '../components/Modal.jsx';
import AttendanceModal from '../components/AttendanceModal.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import { Badge, EmptyState, ErrorNotice, Panel, Spinner } from '../components/ui.jsx';
import {
  formatDateTime,
  formatDuration,
  formatMeetingId,
  formatSeconds,
  formatTime,
} from '../lib/format.js';

const DAY = 86_400_000;

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

export default function Activity() {
  const [range, setRange] = useState({ from: isoDay(Date.now() - 30 * DAY), to: isoDay(Date.now()) });
  const [selected, setSelected] = useState(null);
  const [attendanceFor, setAttendanceFor] = useState(null);
  const [sortDir, setSortDir] = useState('desc');

  const report = useApi(
    () => api.get(`/reports/meetings?from=${range.from}&to=${range.to}&page_size=300`),
    [range.from, range.to]
  );

  const rows = useMemo(() => {
    const data = report.data;
    if (!data) return [];
    const list = Array.isArray(data.meetings) ? data.meetings : [];
    const direction = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => direction * (new Date(a.start_time || 0) - new Date(b.start_time || 0)));
  }, [report.data, sortDir]);

  const totalMinutes = rows.reduce((sum, m) => sum + (Number(m.duration) || 0), 0);
  const scopeMissing = /does not contain scopes/i.test(report.error || '');

  const setDay = (key, value) => setRange((r) => ({ ...r, [key]: value }));

  return (
    <div className="space-y-6">
      <Panel className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="mb-1 text-sm font-bold text-white">Meeting Activity (past instances)</h3>
          <p className="text-xs text-slate-400">
            Every session held on this account in the selected window — the same chronological view as
            Zoom's own meeting history, powered by{' '}
            <code className="text-slate-300">GET /report/users/me/meetings</code>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2">
            <CalendarRange size={14} className="text-accent-cyan" />
            <input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) => setDay('from', e.target.value)}
              className="bg-transparent text-xs text-white focus:outline-none [color-scheme:dark]"
            />
            <span className="text-xs text-slate-500">→</span>
            <input
              type="date"
              value={range.to}
              min={range.from}
              onChange={(e) => setDay('to', e.target.value)}
              className="bg-transparent text-xs text-white focus:outline-none [color-scheme:dark]"
            />
          </div>
          <button
            onClick={report.refresh}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
          >
            <RefreshCw size={12} className={report.loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Tile label="Sessions in range" value={report.loading ? '…' : rows.length} tone="text-accent-emerald" />
        <Tile
          label="Total meeting time"
          value={report.loading ? '…' : `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`}
          tone="text-accent-blue"
        />
        <Tile
          label="Date window"
          value={`${range.from.slice(5)} → ${range.to.slice(5)}`}
          tone="text-accent-cyan"
        />
      </div>

      {report.loading ? (
        <Spinner label="Loading meeting report from Zoom…" />
      ) : report.error ? (
        <>
          <ErrorNotice
            title={scopeMissing ? 'Scope not granted yet' : 'Zoom report failed'}
            error={report.error}
            onRetry={report.refresh}
          />
          {scopeMissing ? (
            <Panel className="p-5 text-xs leading-relaxed text-slate-400">
              <p className="mb-2 font-semibold text-white">One-time setup in Zoom Marketplace</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>
                  Open <span className="text-slate-300">Marketplace → Developed Apps → SBC-LMS</span>
                </li>
                <li>
                  Add the scope <code className="text-accent-emerald">report:read:user:admin</code>{' '}
                  (optionally also{' '}
                  <code className="text-accent-emerald">report:read:list_meeting_participants:admin</code>)
                </li>
                <li>Save, then restart the API (<code>npm run dev:api</code>) to mint a fresh token.</li>
              </ol>
            </Panel>
          ) : null}
        </>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ActivityIcon}
          title="No meetings in this window"
          hint="Widen the date range (Zoom allows a maximum 1-month window per request) or start a session on your Personal Meeting Room."
        />
      ) : (
        <Panel className="overflow-x-auto p-6">
          <table className="w-full min-w-[720px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th
                  className="py-3 font-semibold"
                  aria-sort={sortDir === 'asc' ? 'ascending' : 'descending'}
                >
                  <button
                    type="button"
                    onClick={() => setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))}
                    title={`Sort by date ${sortDir === 'asc' ? 'newest first' : 'oldest first'}`}
                    className="inline-flex items-center gap-1.5 rounded text-left transition hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-emerald/60"
                  >
                    When
                    {sortDir === 'asc' ? (
                      <ArrowUp size={11} aria-hidden="true" />
                    ) : (
                      <ArrowDown size={11} aria-hidden="true" />
                    )}
                  </button>
                </th>
                <th className="py-3 font-semibold">Meeting</th>
                <th className="py-3 font-semibold">Meeting ID</th>
                <th className="py-3 font-semibold">Duration</th>
                <th className="py-3 font-semibold">Participants</th>
                <th className="py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rows.map((m, i) => (
                <tr key={m.uuid || `${m.id}-${m.start_time}-${i}`} className="transition hover:bg-slate-800/40">
                  <td className="py-3.5">
                    <p className="font-semibold text-white">{formatDateTime(m.start_time)}</p>
                    {m.end_time ? (
                      <p className="text-[10px] text-slate-500">
                        {formatTime(m.start_time)} – {formatTime(m.end_time)}
                      </p>
                    ) : null}
                  </td>
                  <td className="py-3.5 text-slate-300">{m.topic || '—'}</td>
                  <td className="py-3.5 font-mono text-slate-300">{formatMeetingId(m.id)}</td>
                  <td className="py-3.5 text-slate-300">{formatDuration(m.duration)}</td>
                  <td className="py-3.5">
                    <Badge className="border border-blue-500/20 bg-blue-500/10 text-blue-400">
                      <Users size={10} /> {m.participants_count ?? m.participants ?? '—'}
                    </Badge>
                  </td>
                  <td className="py-3.5 text-right">
                    <span className="inline-flex items-center gap-1.5">
                      <button
                        onClick={() => setAttendanceFor(m)}
                        title="Expected vs joined — with duration"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-[11px] font-bold text-slate-200 transition hover:bg-slate-700"
                      >
                        <ClipboardList size={11} /> Attendance
                      </button>
                      <button
                        onClick={() => setSelected(m)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-[11px] font-bold text-slate-200 transition hover:bg-slate-700"
                      >
                        <ListChecks size={11} /> Attendees
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <ParticipantsModal
        key={selected ? selected.uuid || selected.id : 'closed'}
        meeting={selected}
        expectedCount={selected?.participants_count ?? selected?.participants}
        onClose={() => setSelected(null)}
      />

      {/* Who was expected vs who joined, with duration */}
      {attendanceFor ? (
        <AttendanceModal
          key={attendanceFor.uuid || attendanceFor.id}
          meeting={attendanceFor}
          onClose={() => setAttendanceFor(null)}
        />
      ) : null}
    </div>
  );
}

function Tile({ label, value, tone }) {
  return (
    <Panel className="p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-2 text-3xl font-extrabold ${tone}`}>{value}</p>
    </Panel>
  );
}

function ParticipantsModal({ meeting, onClose, expectedCount }) {
  const { showToast } = useToast();
  const key = meeting ? meeting.uuid || meeting.id : null;
  const participants = useApi(
    () =>
      key
        ? api.get(`/past-meetings/${encodeURIComponent(encodeURIComponent(String(key)))}/participants`)
        : Promise.resolve(null),
    [key],
    { immediate: Boolean(key) }
  );

  const [query, setQuery] = useState('');
  const [dir, setDir] = useState('asc');
  const [copied, setCopied] = useState(false);
  const [uniqueOnly, setUniqueOnly] = useState(false);

  // The proxy aggregates every Zoom page, so `all` is the complete attendance.
  const all = participants.data?.participants || [];
  const total = participants.data?.total_records ?? all.length;

  // Zoom logs one row per JOIN, so a student who reconnects appears several
  // times. Roll those back into one row per person: total time in session,
  // number of joins, first entry and last exit.
  const people = useMemo(() => {
    const byPerson = new Map();
    for (const p of all) {
      const personId = String(p.user_email || p.name || 'unknown').toLowerCase();
      const found = byPerson.get(personId);
      if (!found) {
        byPerson.set(personId, { ...p, joins: 1, duration: Number(p.duration) || 0 });
        continue;
      }
      found.joins += 1;
      found.duration += Number(p.duration) || 0;
      if (new Date(p.join_time) < new Date(found.join_time)) found.join_time = p.join_time;
      if (new Date(p.leave_time) > new Date(found.leave_time)) found.leave_time = p.leave_time;
    }
    return [...byPerson.values()];
  }, [all]);

  const rows = useMemo(() => {
    const source = uniqueOnly ? people : all;
    const q = query.trim().toLowerCase();
    const filtered = q
      ? source.filter((p) => `${p.name || ''} ${p.user_email || ''}`.toLowerCase().includes(q))
      : source.slice();
    const sorted = filtered.sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
    );
    return dir === 'asc' ? sorted : sorted.reverse();
  }, [all, people, uniqueOnly, query, dir]);

  const copyList = async () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    // Zoom reports participant duration in SECONDS — convert to minutes for
    // the spreadsheet so the column matches its header.
    const mins = (s) => Math.round((Number(s) || 0) / 60);
    const header = uniqueOnly
      ? ['Name', 'Email', 'Total minutes', 'Joins', 'First join', 'Last leave']
      : ['Name', 'Email', 'Minutes', 'Join time', 'Leave time'];
    const line = (p) =>
      uniqueOnly
        ? [p.name, p.user_email, mins(p.duration), p.joins, p.join_time, p.leave_time]
        : [p.name, p.user_email, mins(p.duration), p.join_time, p.leave_time];
    const csv = [header.join(','), ...rows.map((p) => line(p).map(esc).join(','))].join('\n');

    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(csv);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      showToast(
        `${rows.length} attendee${rows.length === 1 ? '' : 's'} copied as CSV.`,
        'Attendees copied'
      );
    } catch {
      showToast(
        'The browser blocked clipboard access — select the rows and copy manually.',
        'Copy failed',
        'error'
      );
    }
  };

  const reportMismatch = expectedCount != null && Number(expectedCount) !== Number(total);

  return (
    <Modal
      open={Boolean(meeting)}
      onClose={onClose}
      title={meeting ? `Attendees — ${meeting.topic || formatMeetingId(meeting.id)}` : 'Attendees'}
      icon={Users}
      size="max-w-2xl"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <span>
          {meeting ? `${formatDateTime(meeting.start_time)} · ID ${formatMeetingId(meeting.id)}` : ''}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <Badge className="border border-blue-500/20 bg-blue-500/10 text-blue-400">
            {total} join{total === 1 ? '' : 's'}
          </Badge>
          <Badge className="border border-slate-600/40 bg-slate-700/20 text-slate-300">
            {people.length} {people.length === 1 ? 'person' : 'people'}
          </Badge>
          {reportMismatch ? (
            <Badge className="border border-amber-500/20 bg-amber-500/10 text-amber-400">
              Report counted {expectedCount}
            </Badge>
          ) : null}
        </span>
      </div>

      {/* Toolbar: search · sort · copy */}
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-[11rem] flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or email…"
            aria-label="Search attendees"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2 pl-8 pr-3 text-xs text-white focus:border-accent-emerald focus:outline-none"
          />
        </div>

        <button
          type="button"
          onClick={() => setUniqueOnly((u) => !u)}
          title={
            uniqueOnly
              ? 'One row per person (joins rolled up)'
              : 'One row per join session, exactly as Zoom logs it'
          }
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
            uniqueOnly
              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
              : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
          }`}
        >
          <ListChecks size={12} />
          {uniqueOnly ? 'Unique people' : 'All joins'}
        </button>

        <button
          type="button"
          onClick={() => setDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
          title="Toggle name sort order"
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
        >
          <ArrowUpDown size={12} />
          {dir === 'asc' ? 'Name A→Z' : 'Name Z→A'}
        </button>

        <button
          type="button"
          onClick={copyList}
          disabled={rows.length === 0}
          title="Copy the rows shown below as CSV"
          className="flex items-center gap-1.5 rounded-lg bg-accent-emerald px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-600 disabled:opacity-50"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied!' : 'Copy list'}
        </button>
      </div>

      {participants.loading ? (
        <Spinner label="Loading participants from Zoom…" />
      ) : participants.error ? (
        <ErrorNotice error={participants.error} onRetry={participants.refresh} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={query ? 'No attendees match your search' : 'No participant records'}
          hint={
            query
              ? `Nothing matches “${query}”. Clear the search to see all ${total}.`
              : 'Zoom returned an empty list for this session.'
          }
        />
      ) : (
        <>
          <p className="mb-2 text-[11px] text-slate-500">
            Showing {rows.length} of {uniqueOnly ? `${people.length} people` : `${total} join records`}
            {query ? ` (filtered by “${query}”)` : ''} · all Zoom pages aggregated
          </p>

          <ul className="max-h-[50vh] divide-y divide-slate-800/60 overflow-y-auto pr-1">
            {rows.map((p, i) => (
              <li
                key={`${p.id || p.user_email || p.name}-${i}`}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-slate-600">
                    {i + 1}.
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-white">
                      <span className="truncate">{p.name || 'Unknown'}</span>
                      {uniqueOnly && p.joins > 1 ? (
                        <span className="shrink-0 rounded bg-amber-500/15 px-1 py-px text-[10px] font-bold text-amber-400">
                          {p.joins}×
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-[11px] text-slate-400">{p.user_email || '—'}</p>
                  </div>
                </div>
                <div className="shrink-0 text-right text-[11px] text-slate-400">
                  <p className="text-slate-300">
                    {formatSeconds(p.duration)}
                    {uniqueOnly ? <span className="text-slate-500"> total</span> : null}
                  </p>
                  <p>
                    {formatTime(p.join_time)} – {formatTime(p.leave_time)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
