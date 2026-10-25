import { useEffect, useMemo, useState } from 'react';
import {
  Video,
  Plus,
  CalendarClock,
  Link2,
  Trash2,
  Pencil,
  UserPlus,
  ExternalLink,
  Copy,
  ListChecks,
  Clock,
  Users,
  ClipboardList,
  Layers,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, usePending } from '../hooks/useApi.js';
import Modal from '../components/Modal.jsx';
import AttendanceModal from '../components/AttendanceModal.jsx';
import { Badge, EmptyState, ErrorNotice, Panel, Spinner, CopyButton } from '../components/ui.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import {
  formatDateTime,
  formatDuration,
  formatMeetingId,
  toDateTimeLocal,
  toZoomStartTime,
} from '../lib/format.js';

const EMPTY_FORM = {
  topic: '',
  start_time: '',
  duration: 60,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  agenda: '',
  registration: true,
  batchIds: [],
};

/** A meeting counts as "past" once start_time + duration has elapsed. */
const isPastMeeting = (m) =>
  m.status === 'finished' ||
  new Date(m.start_time).getTime() + (Number(m.duration) || 0) * 60_000 <= Date.now();

export default function Sessions({ scheduleSignal = 0, onOpenBroadcast }) {
  const { showToast } = useToast();
  const [status, setStatus] = useState('upcoming');
  const [editing, setEditing] = useState(null); // meeting object being edited
  const [creating, setCreating] = useState(false);
  const [registrantsFor, setRegistrantsFor] = useState(null);
  const [enrollFor, setEnrollFor] = useState(null);
  const [attendanceFor, setAttendanceFor] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  // Zoom filters on `type`: scheduled | live | upcoming | previous
  const meetings = useApi(() => api.get(`/meetings?type=${status}&page_size=100`), [status]);
  // Batches drive enrolment chips; targets show which batches each card has.
  const batches = useApi(() => api.get('/batches'));
  const targets = useApi(() => api.get('/targets'));

  const batchList = batches.data?.batches || [];
  const targetMap = targets.data?.targets || {};
  const batchNameById = useMemo(() => new Map(batchList.map((b) => [b.id, b.name])), [batchList]);
  const batchNamesFor = (meetingId) => {
    const target = targetMap[String(meetingId)];
    if (!target) return [];
    return (target.batchIds || []).map((id) => batchNameById.get(id)).filter(Boolean);
  };

  // Topbar "Schedule Zoom" button opens the create modal.
  useEffect(() => {
    if (scheduleSignal > 0) {
      setForm(EMPTY_FORM);
      setCreating(true);
    }
  }, [scheduleSignal]);

  const list = useMemo(() => {
    // Upcoming stays soonest-first. Previous/All read newest-first so the
    // session that just finished is always at the top of the grid.
    const direction = status === 'upcoming' ? 1 : -1;
    return [...(meetings.data?.meetings || [])].sort(
      (a, b) => direction * (new Date(a.start_time || 0) - new Date(b.start_time || 0))
    );
  }, [meetings.data, status]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setCreating(true);
  };

  const openEdit = (meeting) => {
    setEditing(meeting);
    setForm({
      topic: meeting.topic || '',
      start_time: toDateTimeLocal(meeting.start_time),
      duration: meeting.duration || 60,
      timezone: meeting.timezone || EMPTY_FORM.timezone,
      agenda: meeting.agenda || '',
      registration: false,
    });
  };

  const [saving, runSave] = usePending();

  const submitCreate = async (e) => {
    e.preventDefault();
    // Enrolment is mandatory: a session with no batch has no expected
    // audience, no registrations, and cannot be audited for attendance.
    if (!form.batchIds?.length) {
      showToast(
        'Select at least one batch to enrol before scheduling the session.',
        'Batch required',
        'error'
      );
      return false;
    }
    const ok = await runSave(async () => {
      try {
        const created = await api.post('/meetings', {
          topic: form.topic,
          type: 2,
          start_time: toZoomStartTime(form.start_time),
          duration: Number(form.duration) || 60,
          timezone: form.timezone,
          agenda: form.agenda || undefined,
          settings: form.registration
            ? { registration_type: 1, approval_type: 0, host_video: true, participant_video: true }
            : undefined,
        });

        const topic = created.topic || form.topic;
        let recap = null; // enrolment summary for the success toast
        let enrollError = null;

        // Auto-enrol: assign the picked batches and register every student
        // with a personalised join link (server enables registration if needed).
        if (form.batchIds?.length && created.id) {
          try {
            const enrolled = await api.post(`/meetings/${created.id}/enroll`, {
              batchIds: form.batchIds,
            });
            const parts = [
              `${enrolled.registered} student${enrolled.registered === 1 ? '' : 's'} registered`,
            ];
            if (enrolled.skippedNoEmail?.length)
              parts.push(`${enrolled.skippedNoEmail.length} skipped (no email)`);
            if (enrolled.failed?.length) parts.push(`${enrolled.failed.length} failed`);
            recap = parts.join(' · ');
            if (enrolled.warnings?.length)
              showToast(enrolled.warnings.join(' '), 'Registration note', 'info');
            targets.refresh();
          } catch (err) {
            enrollError = err;
          }
        }

        if (created.join_url) await navigator.clipboard?.writeText(created.join_url).catch(() => {});
        setCreating(false);
        meetings.refresh();

        if (enrollError) {
          showToast(
            `“${topic}” was created, but enrolment failed: ${enrollError.message}`,
            'Enrolment failed',
            'error'
          );
        } else {
          showToast(
            recap ? `“${topic}” created — ${recap}.` : `“${topic}” created — join link copied-ready.`,
            recap ? 'Session scheduled & enrolled' : 'Meeting created'
          );
        }
        return true;
      } catch (err) {
        showToast(err.message, 'Zoom rejected the meeting', 'error');
        return false;
      }
    });
    return ok;
  };

  const submitEdit = async (e) => {
    e.preventDefault();
    await runSave(async () => {
      try {
        await api.patch(`/meetings/${editing.id}`, {
          topic: form.topic,
          start_time: toZoomStartTime(form.start_time),
          duration: Number(form.duration) || 60,
          timezone: form.timezone,
          agenda: form.agenda || undefined,
        });
        showToast(`“${form.topic}” updated on Zoom.`, 'Meeting updated');
        setEditing(null);
        meetings.refresh();
      } catch (err) {
        showToast(err.message, 'Update failed', 'error');
      }
    });
  };

  const deleteMeeting = async () => {
    const target = confirmDelete;
    await runSave(async () => {
      try {
        await api.del(`/meetings/${target.id}`);
        showToast(`“${target.topic}” was deleted from Zoom.`, 'Meeting deleted', 'info');
        setConfirmDelete(null);
        meetings.refresh();
      } catch (err) {
        showToast(err.message, 'Delete failed', 'error');
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <Panel className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="mb-1 text-sm font-bold text-white">Zoom Workplace Pro Integration</h3>
          <p className="text-xs text-slate-400">
            Real meetings from <code className="text-slate-300">GET /users/me/meetings</code> — create,
            edit, delete and register students through the local API proxy.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-xl border border-slate-700 bg-slate-900 p-1">
            {[
              { id: 'upcoming', label: 'Upcoming' },
              { id: 'previous', label: 'Previous' },
              { id: 'scheduled', label: 'All' },
            ].map((s) => (
              <button
                key={s.id}
                onClick={() => setStatus(s.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  status === s.id ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 rounded-xl bg-accent-emerald px-4 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-600"
          >
            <Plus size={14} /> Schedule Zoom Session
          </button>
          <button
            onClick={onOpenBroadcast}
            className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
          >
            Broadcast
          </button>
        </div>
      </Panel>

      {/* Grid */}
      {meetings.loading ? (
        <Spinner label="Loading meetings from Zoom…" />
      ) : meetings.error ? (
        <ErrorNotice error={meetings.error} onRetry={meetings.refresh} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Video}
          title={
            status === 'upcoming'
              ? 'No upcoming meetings'
              : status === 'previous'
                ? 'No past meetings'
                : 'No scheduled meetings'
          }
          hint="Create a session with the button above — Zoom will generate the meeting ID, passcode and join URL for you."
          action={
            <button
              onClick={openCreate}
              className="mt-4 rounded-xl bg-accent-emerald px-4 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-600"
            >
              Schedule Zoom Session
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {list.map((m) => (
            <MeetingCard
              key={m.id}
              meeting={m}
              batchNames={batchNamesFor(m.id)}
              onEdit={() => openEdit(m)}
              onRegistrants={() => setRegistrantsFor(m)}
              onEnroll={() => setEnrollFor(m)}
              onAttendance={isPastMeeting(m) ? () => setAttendanceFor(m) : null}
              onDelete={() => setConfirmDelete(m)}
              onCopied={() => showToast('Join link copied to clipboard.', 'Copied')}
            />
          ))}
        </div>
      )}

      {/* Create modal */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Schedule New Zoom Pro Session"
        icon={Video}
        footer={
          <>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="create-meeting"
              disabled={saving}
              className="rounded-lg bg-accent-emerald px-5 py-2 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-600 disabled:opacity-60"
            >
              {saving ? 'Creating on Zoom…' : 'Create & Get Join Link'}
            </button>
          </>
        }
      >
        <MeetingForm
          form={form}
          setForm={setForm}
          onSubmit={submitCreate}
          id="create-meeting"
          batches={batchList}
          batchesLoading={batches.loading}
          requireBatches
        />
      </Modal>

      {/* Edit modal */}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Update Meeting"
        icon={Pencil}
        footer={
          <>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="edit-meeting"
              disabled={saving}
              className="rounded-lg bg-accent-blue px-5 py-2 text-xs font-bold text-white transition hover:bg-blue-600 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </>
        }
      >
        <MeetingForm form={form} setForm={setForm} onSubmit={submitEdit} id="edit-meeting" hideRegistration />
      </Modal>

      {/* Registrants */}
      <RegistrantsModal meeting={registrantsFor} onClose={() => setRegistrantsFor(null)} />

      {/* Enrol batches (retroactive or planned) */}
      <EnrollModal
        key={enrollFor ? enrollFor.id : 'closed'}
        meeting={enrollFor}
        onClose={() => setEnrollFor(null)}
        onDone={() => {
          meetings.refresh();
          targets.refresh();
        }}
      />

      {/* Attendance audit (past sessions only) */}
      {attendanceFor ? (
        <AttendanceModal
          key={attendanceFor.uuid || attendanceFor.id}
          meeting={attendanceFor}
          onClose={() => setAttendanceFor(null)}
        />
      ) : null}

      {/* Delete confirm */}
      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete this meeting?"
        icon={Trash2}
        size="max-w-md"
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmDelete(null)}
              className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-700"
            >
              Keep it
            </button>
            <button
              onClick={deleteMeeting}
              disabled={saving}
              className="rounded-lg bg-accent-red px-5 py-2 text-xs font-bold text-white transition hover:bg-red-600 disabled:opacity-60"
            >
              {saving ? 'Deleting…' : 'Delete permanently'}
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-slate-300">
          “{confirmDelete?.topic}” will be removed from your Zoom account
          {confirmDelete?.registrants_url ? ' and its registrants will lose access' : ''}. This cannot be
          undone.
        </p>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function MeetingCard({ meeting: m, batchNames = [], onEdit, onRegistrants, onEnroll, onAttendance, onDelete, onCopied }) {
  const past = m.status === 'finished' || new Date(m.start_time) < Date.now();
  return (
    <div className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-card-bg p-6 shadow-xl transition hover:border-slate-700">
      <div>
        <div className="mb-3 flex items-start justify-between gap-2">
          <Badge
            className={
              past
                ? 'border border-slate-600 bg-slate-700/30 text-slate-300'
                : 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
            }
          >
            {m.status === 'waiting' ? 'Waiting room' : past ? 'Past session' : 'Scheduled'}
          </Badge>
          <span className="flex items-center gap-1 text-xs text-slate-400">
            <Clock size={11} /> {formatDuration(m.duration)}
          </span>
        </div>

        <h4 className="mb-1 text-base font-bold text-white">{m.topic}</h4>
        <p className="mb-4 flex items-center gap-1 text-xs text-slate-400">
          <CalendarClock size={12} /> {formatDateTime(m.start_time)}
        </p>

        <div className="space-y-1.5 rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-[11px]">
          <p className="flex items-center justify-between gap-2">
            <span className="text-slate-500">Meeting ID</span>
            <span className="font-mono text-slate-200">{formatMeetingId(m.id)}</span>
          </p>
          <p className="flex items-center justify-between gap-2">
            <span className="text-slate-500">Passcode</span>
            <span className="font-mono text-slate-200">{m.password || m.encrypted_password || '—'}</span>
          </p>
        </div>

        {batchNames.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {batchNames.map((name) => (
              <Badge key={name} className="border border-blue-500/20 bg-blue-500/10 text-blue-400">
                <Layers size={10} /> {name}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-4">
        <div className="flex gap-1.5">
          <IconAction onClick={onEdit} title="Edit">
            <Pencil size={12} />
          </IconAction>
          <IconAction onClick={onRegistrants} title="Registrants">
            <ListChecks size={12} />
          </IconAction>
          <IconAction onClick={onEnroll} title="Enrol batches">
            <Users size={12} />
          </IconAction>
          {onAttendance ? (
            <IconAction onClick={onAttendance} title="Attendance">
              <ClipboardList size={12} />
            </IconAction>
          ) : null}
          <IconAction onClick={onDelete} title="Delete" danger>
            <Trash2 size={12} />
          </IconAction>
          <CopyButton
            value={m.join_url || ''}
            label={<Copy size={12} />}
            onCopied={onCopied}
            className="grid h-7 w-7 place-items-center rounded-lg bg-slate-800 text-slate-400 transition hover:bg-slate-700 hover:text-white"
          />
        </div>

        <a
          href={m.join_url || `https://zoom.us/j/${m.id}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-lg bg-accent-emerald px-3.5 py-1.5 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-600"
        >
          <Video size={12} /> Join <ExternalLink size={10} />
        </a>
      </div>
    </div>
  );
}

function IconAction({ children, onClick, title, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`grid h-7 w-7 place-items-center rounded-lg bg-slate-800 transition hover:bg-slate-700 ${
        danger ? 'text-slate-400 hover:text-accent-red' : 'text-slate-400 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function MeetingForm({
  form,
  setForm,
  onSubmit,
  id,
  hideRegistration,
  batches = null,
  batchesLoading = false,
  requireBatches = false,
}) {
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const input =
    'w-full rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-white focus:border-accent-emerald focus:outline-none';
  const label = 'mb-1 block text-xs font-medium text-slate-300';
  const selectedBatches = form.batchIds || [];
  const missingBatches = requireBatches && selectedBatches.length === 0;

  return (
    <form id={id} onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className={label} htmlFor={`${id}-topic`}>
          Session Title
        </label>
        <input
          id={`${id}-topic`}
          type="text"
          required
          value={form.topic}
          onChange={(e) => set({ topic: e.target.value })}
          placeholder="e.g. Advanced Order Flow & DOM Tactics"
          className={input}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor={`${id}-time`}>
            Date &amp; Time
          </label>
          <input
            id={`${id}-time`}
            type="datetime-local"
            required
            value={form.start_time}
            onChange={(e) => set({ start_time: e.target.value })}
            className={input}
          />
        </div>
        <div>
          <label className={label} htmlFor={`${id}-duration`}>
            Duration (minutes)
          </label>
          <input
            id={`${id}-duration`}
            type="number"
            min="10"
            max="480"
            step="5"
            required
            value={form.duration}
            onChange={(e) => set({ duration: e.target.value })}
            className={input}
          />
        </div>
      </div>

      <div>
        <label className={label} htmlFor={`${id}-tz`}>
          Timezone
        </label>
        <input
          id={`${id}-tz`}
          type="text"
          value={form.timezone}
          onChange={(e) => set({ timezone: e.target.value })}
          className={input}
        />
      </div>

      <div>
        <label className={label} htmlFor={`${id}-agenda`}>
          Brief Description (agenda)
        </label>
        <textarea
          id={`${id}-agenda`}
          rows="3"
          value={form.agenda}
          onChange={(e) => set({ agenda: e.target.value })}
          placeholder="Key topics covered in this webinar…"
          className={input}
        />
      </div>

      {!hideRegistration ? (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          <input
            type="checkbox"
            checked={form.registration}
            onChange={(e) => set({ registration: e.target.checked })}
            className="mt-0.5 h-4 w-4 accent-emerald-500"
          />
          <span className="text-xs text-slate-300">
            <span className="font-semibold text-white">Enable registration</span> — required to collect
            student sign-ups (<code className="text-slate-400">registration_type: 1</code>, auto-approve).
          </span>
        </label>
      ) : null}

      {requireBatches || (batches && batches.length) ? (
        <div>
          <span className={label}>
            Enrol batches
            {requireBatches ? <span className="ml-0.5 text-accent-red">*</span> : null}
          </span>

          {batches && batches.length ? (
            <>
              <div
                role="group"
                aria-label="Enrol batches"
                aria-required={requireBatches ? 'true' : undefined}
                aria-invalid={missingBatches ? 'true' : undefined}
                className="flex flex-wrap gap-2"
              >
                {batches.map((b) => {
                  const active = selectedBatches.includes(b.id);
                  return (
                    <button
                      type="button"
                      key={b.id}
                      onClick={() =>
                        set({
                          batchIds: active
                            ? selectedBatches.filter((x) => x !== b.id)
                            : [...selectedBatches, b.id],
                        })
                      }
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
                })}
              </div>
              <p
                className={`mt-1.5 text-[11px] ${
                  missingBatches ? 'text-accent-red' : 'text-slate-500'
                }`}
              >
                {missingBatches
                  ? 'Required — select at least one batch to enrol before scheduling the session.'
                  : 'Picking a batch registers every student in it after the meeting is created — each gets a personalised join link (Zoom registration is enabled automatically for scheduled sessions).'}
              </p>
            </>
          ) : batchesLoading ? (
            <p className="text-[11px] text-slate-500">Loading batches…</p>
          ) : (
            <p className="text-[11px] text-amber-400">
              No batches exist yet. Create a batch under Students &amp; Batches before scheduling a
              session — every meeting must be enrolled to at least one batch.
            </p>
          )}
        </div>
      ) : null}
    </form>
  );
}

/* ------------------------------------------------------------------ */

function RegistrantsModal({ meeting, onClose }) {
  const { showToast } = useToast();
  const open = Boolean(meeting);
  const registrants = useApi(
    () => (meeting ? api.get(`/meetings/${meeting.id}/registrants?page_size=300`) : Promise.resolve(null)),
    [meeting?.id],
    { immediate: open }
  );
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '' });
  const [adding, runAdd] = usePending();

  const submit = async (e) => {
    e.preventDefault();
    await runAdd(async () => {
      try {
        const res = await api.post(`/meetings/${meeting.id}/registrants`, form);
        showToast(
          res?.join_url
            ? `${form.first_name} registered — personal join link generated.`
            : `${form.first_name} added to the registrant list.`,
          'Registrant added'
        );
        setForm({ first_name: '', last_name: '', email: '' });
        registrants.refresh();
      } catch (err) {
        showToast(err.message, 'Registration failed', 'error');
      }
    });
  };

  const rows = registrants.data?.registrants || [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={meeting ? `Registrants — ${meeting.topic}` : 'Registrants'}
      icon={UserPlus}
      size="max-w-2xl"
    >
      <form onSubmit={submit} className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <input
          required
          placeholder="First name"
          value={form.first_name}
          onChange={(e) => setForm({ ...form, first_name: e.target.value })}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white focus:border-accent-emerald focus:outline-none"
        />
        <input
          required
          placeholder="Last name"
          value={form.last_name}
          onChange={(e) => setForm({ ...form, last_name: e.target.value })}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white focus:border-accent-emerald focus:outline-none"
        />
        <input
          required
          type="email"
          placeholder="student@email.com"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white focus:border-accent-emerald focus:outline-none"
        />
        <div className="sm:col-span-3">
          <button
            type="submit"
            disabled={adding}
            className="w-full rounded-xl bg-accent-emerald px-4 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-emerald-600 disabled:opacity-60 sm:w-auto"
          >
            {adding ? 'Registering…' : 'Add registrant'}
          </button>
        </div>
      </form>

      {registrants.loading ? (
        <Spinner label="Loading registrants…" />
      ) : registrants.error ? (
        <ErrorNotice
          title="Cannot list registrants"
          error={registrants.error}
          onRetry={registrants.refresh}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title="No registrants yet"
          hint="Add a student above. The meeting must have registration enabled — edit the meeting and tick “Enable registration” if Zoom returns an error."
        />
      ) : (
        <ul className="divide-y divide-slate-800/60">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">
                  {[r.first_name, r.last_name].filter(Boolean).join(' ')}
                </p>
                <p className="truncate text-[11px] text-slate-400">{r.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  className={
                    r.status === 'approved'
                      ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                      : 'border border-amber-500/20 bg-amber-500/10 text-amber-400'
                  }
                >
                  {r.status || 'pending'}
                </Badge>
                {r.join_url ? (
                  <a
                    href={r.join_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-[11px] font-bold text-slate-200 transition hover:bg-slate-700"
                  >
                    <Link2 size={11} /> Personal link
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Assign batches to a meeting — POST /api/meetings/:id/enroll.
 *
 * Registers every student in the picked batches (personalised Zoom join
 * links, registration auto-enabled for scheduled meetings) and records the
 * batch assignment so attendance can be audited later. Safe to re-run:
 * existing registrants are skipped server-side (Zoom is idempotent).
 */
function EnrollModal({ meeting, onClose, onDone }) {
  const { showToast } = useToast();
  const open = Boolean(meeting);
  const batches = useApi(() => api.get('/batches'), [], { immediate: open });
  const [selected, setSelected] = useState([]);
  const [saving, run] = usePending();

  const list = batches.data?.batches || [];

  const toggle = (id) =>
    setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const submit = () =>
    run(async () => {
      try {
        const r = await api.post(`/meetings/${meeting.id}/enroll`, { batchIds: selected });
        const parts = [`${r.registered} registered`];
        if (r.skippedNoEmail?.length) parts.push(`${r.skippedNoEmail.length} skipped (no email)`);
        if (r.failed?.length) parts.push(`${r.failed.length} failed`);
        showToast(
          `${r.batches?.join(', ') || 'Batches'} → ${parts.join(' · ')}`,
          'Batch enrolment complete'
        );
        if (r.warnings?.length) showToast(r.warnings.join(' '), 'Registration note', 'info');
        onDone?.();
        onClose?.();
      } catch (err) {
        showToast(err.message, 'Enrolment failed', 'error');
      }
    });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={meeting ? `Enrol batches — ${meeting.topic}` : 'Enrol batches'}
      icon={Users}
      size="max-w-lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-700"
          >
            Close
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || selected.length === 0}
            className="rounded-lg bg-accent-emerald px-5 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-600 disabled:opacity-60"
          >
            {saving ? 'Registering…' : 'Register students'}
          </button>
        </>
      }
    >
      {batches.loading ? (
        <Spinner label="Loading batches…" />
      ) : batches.error ? (
        <ErrorNotice error={batches.error} onRetry={batches.refresh} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No batches yet"
          hint="Create a batch under Students & Batches, assign students to it, then come back — everyone in it gets registered in one click."
        />
      ) : (
        <>
          <p className="mb-3 text-xs text-slate-400">
            Pick the batches to assign to this session. Every student with an email gets registered on
            Zoom with a personalised join link; attendance tracks everyone assigned to the meeting.
          </p>
          <div className="space-y-2">
            {list.map((b) => {
              const active = selected.includes(b.id);
              return (
                <button
                  type="button"
                  key={b.id}
                  onClick={() => toggle(b.id)}
                  aria-pressed={active}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-left transition ${
                    active
                      ? 'border-accent-emerald/40 bg-accent-emerald/10'
                      : 'border-slate-800 bg-slate-900/60 hover:bg-slate-900'
                  }`}
                >
                  <span className="min-w-0">
                    <span
                      className={`block truncate text-sm font-semibold ${
                        active ? 'text-accent-emerald' : 'text-white'
                      }`}
                    >
                      {b.name}
                    </span>
                    {b.description ? (
                      <span className="block truncate text-[11px] text-slate-500">{b.description}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-slate-300">
                    {b.memberCount} student{b.memberCount === 1 ? '' : 's'}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            Scheduled meetings get registration enabled automatically. The Personal Meeting Room doesn't
            support Zoom registration — students there join with the shared link instead (attendance
            still works).
          </p>
        </>
      )}
    </Modal>
  );
}
