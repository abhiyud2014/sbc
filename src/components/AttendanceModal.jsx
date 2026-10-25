import { useEffect, useState } from 'react';
import { ClipboardList, RefreshCw, UserCheck, UserX, Users } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, usePending } from '../hooks/useApi.js';
import Modal from './Modal.jsx';
import { Badge, EmptyState, ErrorNotice, Spinner } from './ui.jsx';
import { useToast } from './ToastProvider.jsx';
import { formatDateTime, formatMeetingId, formatSeconds, formatTime } from '../lib/format.js';

/**
 * Per-session attendance audit — who was EXPECTED (the batches assigned to
 * the meeting) versus who actually JOINED, with time spent, plus anyone who
 * joined who wasn't on the list.
 *
 * Data: GET /api/meetings/:id/attendance?uuid=<instance uuid>
 * The modal also lets you assign batches retroactively (records the
 * expectation without touching Zoom registrants).
 */
export default function AttendanceModal({ meeting, onClose }) {
  const { showToast } = useToast();
  const open = Boolean(meeting);
  const meetingKey = meeting ? `${meeting.id}:${meeting.uuid || ''}:${meeting.start_time || ''}` : '';

  const attendance = useApi(
    () => {
      if (!meeting) return Promise.resolve(null);
      const query = new URLSearchParams({
        ...(meeting.uuid ? { uuid: meeting.uuid } : {}),
        ...(meeting.start_time ? { start_time: meeting.start_time } : {}),
      }).toString();
      return api.get(`/meetings/${meeting.id}/attendance${query ? `?${query}` : ''}`);
    },
    [meetingKey],
    { immediate: open }
  );
  const batches = useApi(() => api.get('/batches'), [], { immediate: open });

  const [assigning, setAssigning] = useState(false);
  const [selected, setSelected] = useState([]);
  const [saving, runSave] = usePending();

  // Seed the assignment editor from whatever is currently assigned.
  useEffect(() => {
    if (attendance.data) {
      setSelected(attendance.data.batchIds || []);
      setAssigning(false);
    }
  }, [attendance.data]);

  const data = attendance.data;
  const batchList = batches.data?.batches || [];

  const toggleBatch = (id) =>
    setSelected((ids) => (ids.includes(id) ? ids.filter((b) => b !== id) : [...ids, id]));

  const saveAssignment = () =>
    runSave(async () => {
      try {
        await api.put(`/meetings/${meeting.id}/targets`, { batchIds: selected });
        showToast(
          selected.length
            ? `Batches assigned — attendance now compares against ${selected.length} batch(es).`
            : 'Batch assignment cleared for this session.',
          'Targets saved'
        );
        attendance.refresh();
      } catch (err) {
        showToast(err.message, 'Could not save assignment', 'error');
      }
    });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={meeting ? `Attendance — ${meeting.topic || formatMeetingId(meeting.id)}` : 'Attendance'}
      icon={ClipboardList}
      size="max-w-3xl"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <span>
          {meeting
            ? `${formatDateTime(meeting.start_time)} · ID ${formatMeetingId(meeting.id)}${
                meeting.uuid ? ' · instance tracked by UUID' : ''
              }`
            : ''}
        </span>
        <button
          onClick={attendance.refresh}
          title="Re-fetch attendance from Zoom"
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-slate-700"
        >
          <RefreshCw size={11} className={attendance.loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Batch assignment ------------------------------------------------ */}
      <div className="mb-4 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Expected (assigned batches)
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-1.5">
              {data?.assigned ? (
                data.batchNames.map((name) => (
                  <Badge key={name} className="border border-blue-500/20 bg-blue-500/10 text-blue-400">
                    {name}
                  </Badge>
                ))
              ) : (
                <span className="text-[11px] text-slate-500">
                  No batches assigned — join/duration is shown, but “unable to join” can't be computed
                  yet.
                </span>
              )}
            </p>
          </div>
          <button
            onClick={() => setAssigning((v) => !v)}
            className="shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-[11px] font-bold text-slate-200 transition hover:bg-slate-700"
          >
            {assigning ? 'Close' : data?.assigned ? 'Edit batches' : 'Assign batches'}
          </button>
        </div>

        {assigning ? (
          <div className="mt-3 border-t border-slate-800 pt-3">
            <div className="flex flex-wrap gap-2">
              {batchList.length === 0 ? (
                <p className="text-[11px] text-slate-500">
                  No batches exist yet — create them under Students &amp; Batches.
                </p>
              ) : (
                batchList.map((b) => {
                  const active = selected.includes(b.id);
                  return (
                    <button
                      type="button"
                      key={b.id}
                      onClick={() => toggleBatch(b.id)}
                      aria-pressed={active}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        active
                          ? 'border-accent-emerald/40 bg-accent-emerald/15 text-accent-emerald'
                          : 'border-slate-700 bg-slate-900 text-slate-400 hover:bg-slate-800'
                      }`}
                    >
                      {b.name} <span className="opacity-60">· {b.memberCount}</span>
                    </button>
                  );
                })
              )}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setAssigning(false)}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={saveAssignment}
                disabled={saving}
                className="rounded-lg bg-accent-emerald px-3.5 py-1.5 text-[11px] font-bold text-slate-950 transition hover:bg-emerald-600 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save assignment'}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {attendance.loading ? (
        <Spinner label="Loading attendance from Zoom…" />
      ) : data?.participantError ? (
        <ErrorNotice
          title="No participant records for this session yet"
          error={data.participantError}
          onRetry={attendance.refresh}
        />
      ) : attendance.error ? (
        <ErrorNotice error={attendance.error} onRetry={attendance.refresh} />
      ) : data ? (
        <>
          {/* Tiles */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Expected" value={data.enrolledCount} tone="text-accent-blue" />
            <Tile label="Joined" value={data.joined.length} tone="text-accent-emerald" />
            <Tile label="Unable to join" value={data.absent.length} tone="text-accent-red" />
            <Tile label="Other guests" value={data.guests.length} tone="text-accent-cyan" />
          </div>

          {/* Joined */}
          <section className="mb-4">
            <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <UserCheck size={12} className="text-accent-emerald" /> Joined with duration
            </h4>
            {data.joined.length === 0 ? (
              <p className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2.5 text-[11px] text-slate-500">
                Nobody from the assigned batches joined this session.
              </p>
            ) : (
              <ul className="divide-y divide-slate-800/60">
                {data.joined.map((p) => (
                  <li key={p.studentId || p.email || p.name} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">
                        {p.name}
                        {p.matchedBy === 'name' ? (
                          <span
                            className="ml-1.5 rounded bg-amber-500/15 px-1 py-px text-[9px] font-bold text-amber-400"
                            title="Matched by name — Zoom had no email for this join"
                          >
                            by name
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-[11px] text-slate-400">{p.email || '—'}</p>
                    </div>
                    <div className="shrink-0 text-right text-[11px]">
                      <p className="text-sm font-bold text-accent-emerald">{formatSeconds(p.durationSeconds)}</p>
                      <p className="text-slate-500">
                        {p.joins > 1 ? `${p.joins} joins · ` : ''}
                        {formatTime(p.firstJoin)}–{formatTime(p.lastLeave)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Absent */}
          <section className="mb-4">
            <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <UserX size={12} className="text-accent-red" /> Unable to join (assigned but absent)
            </h4>
            {!data.assigned ? (
              <p className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2.5 text-[11px] text-slate-500">
                Assign batches above to see who missed this class.
              </p>
            ) : data.absent.length === 0 ? (
              <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5 text-[11px] text-emerald-300">
                Everyone expected showed up.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {data.absent.map((p) => (
                  <li
                    key={p.studentId || p.email || p.name}
                    className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5"
                  >
                    <p className="text-xs font-semibold text-red-300">{p.name}</p>
                    <p className="text-[10px] text-red-400/70">{p.email || 'no email on file'}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Guests */}
          {data.guests.length > 0 ? (
            <section>
              <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <Users size={12} className="text-accent-cyan" /> Joined but not in an assigned batch
              </h4>
              <ul className="max-h-40 divide-y divide-slate-800/60 overflow-y-auto pr-1">
                {data.guests.map((p, i) => (
                  <li key={`${p.email || p.name}-${i}`} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-200">{p.name}</p>
                      <p className="truncate text-[10px] text-slate-500">{p.email || 'guest (no email)'}</p>
                    </div>
                    <span className="shrink-0 text-[11px] font-semibold text-slate-400">
                      {formatSeconds(p.durationSeconds)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : (
        <EmptyState icon={ClipboardList} title="No attendance data" hint="Nothing to show for this session." />
      )}
    </Modal>
  );
}

function Tile({ label, value, tone }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-extrabold ${tone}`}>{value}</p>
    </div>
  );
}
