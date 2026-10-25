import { useMemo, useState } from 'react';
import {
  Search,
  Users,
  Download,
  RefreshCw,
  CalendarClock,
  Clock,
  TrendingUp,
  ChevronDown,
  Plus,
  Pencil,
  Trash2,
  UserPlus,
  Layers,
  KeyRound,
  LogOut,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, usePending } from '../hooks/useApi.js';
import { Badge, EmptyState, ErrorNotice, Panel, Spinner } from '../components/ui.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import { formatDateTime, initials } from '../lib/format.js';

const TABS = [
  { id: 'enrolled', label: 'Enrolled' },
  { id: 'batches', label: 'Batches' },
  { id: 'attendance', label: 'Attendance' },
];

/**
 * Admin's student management hub:
 *   Enrolled  — CRUD for the LMS enrolment list (what Zoom registers)
 *   Batches   — cohorts/groups; picking batches is how you enrol a meeting
 *   Attendance— the roster built from REAL Zoom participant data
 */
export default function Students() {
  const [tab, setTab] = useState('enrolled');

  return (
    <div className="space-y-6">
      <Panel className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="mb-1 text-sm font-bold text-white">Students, Batches &amp; Attendance</h3>
          <p className="text-xs text-slate-400">
            Enrol students into the LMS, organise them into batches for one-click meeting enrolment, then
            audit who actually attended each session.
          </p>
        </div>
        <div
          className="flex rounded-xl border border-slate-700 bg-slate-900 p-1"
          role="tablist"
          aria-label="Student management views"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                tab === t.id ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Panel>

      {tab === 'enrolled' ? <EnrolledTab /> : tab === 'batches' ? <BatchesTab /> : <AttendanceTab />}
    </div>
  );
}

/* ==================================================================== */
/* Enrolled students (CRUD)                                             */
/* ==================================================================== */

function EnrolledTab() {
  const { showToast } = useToast();
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState(null); // 'new' | student object | null
  const [deleting, setDeleting] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', batches: [], notes: '' });
  const [saving, run] = usePending();

  /* per-student password override */
  const [pwStudent, setPwStudent] = useState(null);
  const [pwValue, setPwValue] = useState('');
  const [pwSaving, pwRun] = usePending();
  const [sessionEnding, endSessionRun] = usePending();

  const students = useApi(() => api.get('/students'));
  const batches = useApi(() => api.get('/batches'));

  const list = students.data?.students || [];
  const batchList = batches.data?.batches || [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) =>
      `${s.name} ${s.email || ''} ${(s.batchNames || []).join(' ')}`.toLowerCase().includes(q)
    );
  }, [list, query]);

  const withEmail = list.filter((s) => s.email).length;
  const unassigned = list.filter((s) => !(s.batches || []).length).length;

  const openNew = () => {
    setForm({ name: '', email: '', batches: [], notes: '' });
    setModal('new');
  };

  const openEdit = (student) => {
    setForm({
      name: student.name || '',
      email: student.email || '',
      batches: [...(student.batches || [])],
      notes: student.notes || '',
    });
    setModal(student);
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (modal === 'new') {
        await run(() => api.post('/students', form));
        showToast(
          `${form.name} enrolled — pick their batch while scheduling to auto-register them.`,
          'Student added'
        );
      } else {
        await run(() => api.patch(`/students/${modal.id}`, form));
        showToast(`${form.name} updated.`, 'Student saved');
      }
      setModal(null);
      students.refresh();
      batches.refresh(); // member counts move between batches
    } catch (err) {
      showToast(err.message, 'Could not save student', 'error');
    }
  };

  const remove = async () => {
    try {
      await run(() => api.del(`/students/${deleting.id}`));
      showToast(`${deleting.name} removed from the enrolment list.`, 'Student removed', 'info');
      setDeleting(null);
      students.refresh();
      batches.refresh();
    } catch (err) {
      showToast(err.message, 'Could not delete', 'error');
    }
  };

  const toggleBatch = (id) =>
    setForm((f) => ({
      ...f,
      batches: f.batches.includes(id) ? f.batches.filter((b) => b !== id) : [...f.batches, id],
    }));

  const openPassword = (student) => {
    setPwStudent(student);
    setPwValue('');
  };

  const saveStudentPassword = async (e) => {
    e.preventDefault();
    try {
      await pwRun(() => api.post(`/students/${pwStudent.id}/password`, { password: pwValue }));
      showToast(
        pwStudent.hasPersonalPassword
          ? `Personal password updated for ${pwStudent.name}.`
          : `Personal password set for ${pwStudent.name} — share it with them.`,
        'Password saved'
      );
      setPwStudent(null);
      students.refresh();
    } catch (err) {
      showToast(err.message, 'Could not save password', 'error');
    }
  };

  const clearStudentPassword = async () => {
    try {
      await pwRun(() => api.post(`/students/${pwStudent.id}/password`, { password: '' }));
      showToast(`${pwStudent.name} now signs in with the class password.`, 'Personal password removed', 'info');
      setPwStudent(null);
      students.refresh();
    } catch (err) {
      showToast(err.message, 'Could not remove password', 'error');
    }
  };

  const endStudentSession = async (student) => {
    if (
      !window.confirm(
        `Sign ${student.name} out of their active device?\n\nUse this if they lost a phone/laptop or their browser is stuck on the old login.`
      )
    ) {
      return;
    }
    try {
      const result = await endSessionRun(() => api.del(`/students/${student.id}/sessions`));
      showToast(
        result?.revoked
          ? `${student.name} can now sign in on a new device.`
          : `${student.name} has no active session.`,
        result?.revoked ? 'Device signed out' : 'No active session',
        'info'
      );
    } catch (err) {
      showToast(err.message, 'Could not end session', 'error');
    }
  };

  const generatePassword = () =>
    setPwValue(`SBC${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 6)}`);

  const input =
    'w-full rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-white focus:border-accent-emerald focus:outline-none';
  const label = 'mb-1 block text-xs font-medium text-slate-300';

  return (
    <div className="space-y-6">
      <Panel className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="mb-1 text-sm font-bold text-white">Enrolled students</h4>
          <p className="text-xs text-slate-400">
            {list.length} enrolled · {withEmail} with email (required for Zoom registration &amp; sign-in) ·{' '}
            {unassigned} not in a batch yet
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email, batch…"
              className="w-56 rounded-xl border border-slate-700 bg-slate-900 py-2 pl-9 pr-3 text-xs text-white focus:border-accent-emerald focus:outline-none"
            />
          </div>
          <button
            onClick={() => {
              students.refresh();
              batches.refresh();
            }}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
          >
            <RefreshCw size={12} className={students.loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 rounded-xl bg-accent-emerald px-3.5 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-600"
          >
            <UserPlus size={12} /> Add student
          </button>
        </div>
      </Panel>

      <ClassPasswordCard />

      {students.loading ? (
        <Spinner label="Loading enrolled students…" />
      ) : students.error ? (
        <ErrorNotice error={students.error} onRetry={students.refresh} title="Could not load students" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title={list.length === 0 ? 'No students enrolled yet' : 'No students match'}
          hint={
            list.length === 0
              ? 'Add your first student — then pick their batch while scheduling a session and everyone is registered automatically.'
              : 'Try a different name, email or batch.'
          }
          action={
            list.length === 0 ? (
              <button
                onClick={openNew}
                className="mt-4 rounded-xl bg-accent-emerald px-4 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-600"
              >
                <UserPlus size={12} className="mr-1 inline" /> Add student
              </button>
            ) : null
          }
        />
      ) : (
        <Panel className="overflow-x-auto p-6">
          <table className="w-full min-w-[720px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-3 font-semibold">Student</th>
                <th className="py-3 font-semibold">Email</th>
                <th className="py-3 font-semibold">Batches</th>
                <th className="py-3 font-semibold">Enrolled</th>
                <th className="py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filtered.map((s) => (
                <tr key={s.id} className="transition hover:bg-slate-800/40">
                  <td className="py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-slate-700 bg-slate-800 text-[11px] font-bold text-slate-300">
                        {initials(s.name)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-bold text-white">{s.name}</p>
                        {s.notes ? (
                          <p className="truncate text-[10px] text-slate-500" title={s.notes}>
                            {s.notes}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 text-slate-300">
                    {s.email || <span className="text-slate-500">no email (can't register or sign in)</span>}
                  </td>
                  <td className="py-3.5">
                    <span className="flex flex-wrap gap-1">
                      {(s.batchNames || []).length ? (
                        s.batchNames.map((name) => (
                          <Badge key={name} className="border border-blue-500/20 bg-blue-500/10 text-blue-400">
                            <Layers size={9} /> {name}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-slate-500">unassigned</span>
                      )}
                    </span>
                  </td>
                  <td className="py-3.5 text-slate-400">
                    {formatDateTime(s.createdAt, { dateStyle: 'medium' })}
                  </td>
                  <td className="py-3.5 text-right">
                    <span className="flex justify-end gap-1.5">
                      <button
                        onClick={() => openEdit(s)}
                        title="Edit student"
                        className="grid h-7 w-7 place-items-center rounded-lg bg-slate-800 text-slate-400 transition hover:bg-slate-700 hover:text-white"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => openPassword(s)}
                        title={s.hasPersonalPassword ? 'Personal password set — click to change' : 'Set a personal password'}
                        className={`grid h-7 w-7 place-items-center rounded-lg bg-slate-800 transition hover:bg-slate-700 ${
                          s.hasPersonalPassword ? 'text-accent-emerald' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <KeyRound size={12} />
                      </button>
                      <button
                        onClick={() => endStudentSession(s)}
                        disabled={sessionEnding}
                        title="Sign out their active device (use if they lost it)"
                        className="grid h-7 w-7 place-items-center rounded-lg bg-slate-800 text-slate-400 transition hover:bg-slate-700 hover:text-white disabled:opacity-40"
                      >
                        <LogOut size={12} />
                      </button>
                      <button
                        onClick={() => setDeleting(s)}
                        title="Delete student"
                        className="grid h-7 w-7 place-items-center rounded-lg bg-slate-800 text-slate-400 transition hover:bg-red-500/15 hover:text-red-400"
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {/* Add / edit student */}
      <Modal
        open={Boolean(modal)}
        onClose={() => setModal(null)}
        title={modal === 'new' ? 'Add student' : 'Edit student'}
        icon={modal === 'new' ? UserPlus : Pencil}
        footer={
          <>
            <button
              type="button"
              onClick={() => setModal(null)}
              className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="student-form"
              disabled={saving}
              className="rounded-lg bg-accent-emerald px-5 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-600 disabled:opacity-60"
            >
              {saving ? 'Saving…' : modal === 'new' ? 'Add student' : 'Save changes'}
            </button>
          </>
        }
      >
        <form id="student-form" onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="stu-name">
                Name *
              </label>
              <input
                id="stu-name"
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Priya Sharma"
                className={input}
              />
            </div>
            <div>
              <label className={label} htmlFor="stu-email">
                Email
              </label>
              <input
                id="stu-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="student@email.com"
                className={input}
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Required for Zoom registration &amp; personalised join links.
              </p>
            </div>
          </div>

          <div>
            <span className={label}>Batches</span>
            {batchList.length === 0 ? (
              <p className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-[11px] text-slate-500">
                No batches yet — create them in the <strong className="text-slate-400">Batches</strong>{' '}
                tab, then assign students here.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {batchList.map((b) => {
                  const active = form.batches.includes(b.id);
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
                })}
              </div>
            )}
          </div>

          <div>
            <label className={label} htmlFor="stu-notes">
              Notes (optional)
            </label>
            <textarea
              id="stu-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Goals, schedule constraints, mentoring notes…"
              className={input}
            />
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Remove student"
        icon={Trash2}
        size="max-w-md"
      >
        <p className="text-sm leading-relaxed text-slate-300">
          Remove <span className="font-bold text-white">“{deleting?.name}”</span> from the enrolment
          list? They won't be registered for future sessions. Past attendance stays in the roster.
        </p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            onClick={() => setDeleting(null)}
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
          >
            Keep them
          </button>
          <button
            onClick={remove}
            disabled={saving}
            className="rounded-lg bg-red-500/90 px-5 py-2.5 text-xs font-bold text-white transition hover:bg-red-600 disabled:opacity-50"
          >
            {saving ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </Modal>

      {/* Per-student password override */}
      <Modal
        open={Boolean(pwStudent)}
        onClose={() => setPwStudent(null)}
        title={`Password — ${pwStudent?.name || ''}`}
        icon={KeyRound}
        size="max-w-md"
        footer={
          <>
            <button
              type="button"
              onClick={() => setPwStudent(null)}
              className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="student-pw-form"
              disabled={pwSaving || pwValue.length < 6}
              className="rounded-lg bg-accent-emerald px-5 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-600 disabled:opacity-60"
            >
              {pwSaving ? 'Saving…' : 'Save password'}
            </button>
          </>
        }
      >
        <form id="student-pw-form" onSubmit={saveStudentPassword} className="space-y-4">
          <p className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-xs leading-relaxed text-slate-400">
            {pwStudent?.hasPersonalPassword ? (
              <>
                <span className="font-semibold text-accent-emerald">Personal password set.</span> They sign
                in with <span className="text-slate-300">{pwStudent?.email || 'their email'}</span> + this
                password — the class password does not work for them.
              </>
            ) : (
              <>
                Currently signs in with the <span className="text-slate-300">class password</span> using{' '}
                <span className="text-slate-300">{pwStudent?.email || 'their email'}</span>. Setting a
                password here gives them a personal one.
              </>
            )}
          </p>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300" htmlFor="stu-pw">
              New password
            </label>
            <div className="flex gap-2">
              <input
                id="stu-pw"
                type="text"
                value={pwValue}
                onChange={(e) => setPwValue(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2.5 font-mono text-sm text-white focus:border-accent-emerald focus:outline-none"
                placeholder="At least 6 characters"
                minLength={6}
              />
              <button
                type="button"
                onClick={generatePassword}
                className="shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-3 text-xs font-semibold text-slate-300 transition hover:bg-slate-700"
              >
                Generate
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              Only the scrypt hash is stored — nobody can read it back, not even you.
            </p>
          </div>
        </form>
        {pwStudent?.hasPersonalPassword ? (
          <button
            type="button"
            onClick={clearStudentPassword}
            disabled={pwSaving}
            className="mt-4 w-full rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
          >
            Remove personal password (revert to the class password)
          </button>
        ) : null}
      </Modal>
    </div>
  );
}

/* ==================================================================== */
/* Class login password (shared credential for all students)            */
/* ==================================================================== */

function ClassPasswordCard() {
  const { showToast } = useToast();
  const status = useApi(() => api.get('/class-password'));
  const [password, setPassword] = useState('');
  const [saving, run] = usePending();
  const configured = Boolean(status.data?.configured);

  const save = async (e) => {
    e.preventDefault();
    try {
      await run(() => api.put('/class-password', { password }));
      showToast(
        configured
          ? 'Rotated — every student WITHOUT a personal password needs the new one to sign in.'
          : 'Share it privately with your class — they sign in with their email + this password.',
        'Class password saved'
      );
      setPassword('');
      status.refresh();
    } catch (err) {
      showToast(err.message, 'Could not save class password', 'error');
    }
  };

  const clear = async () => {
    const sure = window.confirm(
      'Clear the class password? Students WITHOUT a personal password won’t be able to sign in until you set a new one.'
    );
    if (!sure) return;
    try {
      await run(() => api.put('/class-password', { password: '' }));
      showToast('Personal student passwords still work.', 'Class password cleared', 'info');
      status.refresh();
    } catch (err) {
      showToast(err.message, 'Could not clear the class password', 'error');
    }
  };

  return (
    <Panel className="p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-xl">
          <h4 className="mb-1 flex flex-wrap items-center gap-2 text-sm font-bold text-white">
            <KeyRound size={14} className="text-accent-emerald" /> Class login password
            <span
              className={`rounded px-1.5 py-px text-[10px] font-bold ${
                status.loading
                  ? 'bg-slate-800 text-slate-400'
                  : configured
                    ? 'bg-accent-emerald/15 text-accent-emerald'
                    : 'bg-amber-500/15 text-amber-400'
              }`}
            >
              {status.loading ? 'checking…' : configured ? 'SET' : 'NOT SET'}
            </span>
          </h4>
          <p className="text-xs leading-relaxed text-slate-400">
            {configured
              ? 'Students sign in with their registered email + this password. Rotate it anytime — students who set a personal password keep theirs.'
              : 'Students can’t sign in until you set one. Share it privately (never in the class chat with everyone’s emails visible).'}
          </p>
        </div>
        <form onSubmit={save} className="flex flex-wrap items-center gap-2">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={configured ? 'New password…' : 'e.g. your class code'}
            minLength={6}
            className="w-56 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs text-white focus:border-accent-emerald focus:outline-none"
          />
          <button
            type="submit"
            disabled={saving || password.length < 6}
            className="rounded-xl bg-accent-emerald px-4 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-600 disabled:opacity-50"
          >
            {saving ? 'Saving…' : configured ? 'Rotate' : 'Set password'}
          </button>
          {configured ? (
            <button
              type="button"
              onClick={clear}
              disabled={saving}
              className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
            >
              Clear
            </button>
          ) : null}
        </form>
      </div>
    </Panel>
  );
}

/* ==================================================================== */
/* Batches (CRUD)                                                       */
/* ==================================================================== */

function BatchesTab() {
  const { showToast } = useToast();
  const [modal, setModal] = useState(null); // 'new' | batch object | null
  const [deleting, setDeleting] = useState(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [saving, run] = usePending();

  const batches = useApi(() => api.get('/batches'));
  const students = useApi(() => api.get('/students'));

  const list = batches.data?.batches || [];
  const studentList = students.data?.students || [];
  const memberNames = (batchId) =>
    studentList.filter((s) => (s.batches || []).includes(batchId)).map((s) => s.name);

  const openNew = () => {
    setForm({ name: '', description: '' });
    setModal('new');
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (modal === 'new') {
        await run(() => api.post('/batches', form));
        showToast(`Batch “${form.name}” created.`, 'Batch added');
      } else {
        await run(() => api.patch(`/batches/${modal.id}`, form));
        showToast(`Batch “${form.name}” updated.`, 'Batch saved');
      }
      setModal(null);
      batches.refresh();
    } catch (err) {
      showToast(err.message, 'Could not save batch', 'error');
    }
  };

  const remove = async () => {
    try {
      await run(() => api.del(`/batches/${deleting.id}`));
      showToast(`Batch “${deleting.name}” deleted — students stay enrolled.`, 'Batch deleted', 'info');
      setDeleting(null);
      batches.refresh();
      students.refresh();
    } catch (err) {
      showToast(err.message, 'Could not delete', 'error');
    }
  };

  const input =
    'w-full rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-white focus:border-accent-emerald focus:outline-none';

  return (
    <div className="space-y-6">
      <Panel className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="mb-1 text-sm font-bold text-white">Batches (cohorts)</h4>
          <p className="text-xs text-slate-400">
            When scheduling a session, pick a batch and every student in it is registered with a
            personalised join link automatically.
          </p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-1.5 rounded-xl bg-accent-emerald px-3.5 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-600"
        >
          <Plus size={12} /> New batch
        </button>
      </Panel>

      {batches.loading ? (
        <Spinner label="Loading batches…" />
      ) : batches.error ? (
        <ErrorNotice error={batches.error} onRetry={batches.refresh} title="Could not load batches" />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No batches yet"
          hint="Create your first cohort (e.g. “Batch A — Morning”), then assign students to it from the Enrolled tab."
          action={
            <button
              onClick={openNew}
              className="mt-4 rounded-xl bg-accent-emerald px-4 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-600"
            >
              <Plus size={12} className="mr-1 inline" /> New batch
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {list.map((b) => {
            const members = memberNames(b.id);
            return (
              <div
                key={b.id}
                className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-card-bg p-6 shadow-xl transition hover:border-slate-700"
              >
                <div>
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <Badge className="border border-blue-500/20 bg-blue-500/10 text-blue-400">
                      <Layers size={10} /> {b.memberCount ?? members.length} student
                      {(b.memberCount ?? members.length) === 1 ? '' : 's'}
                    </Badge>
                    <span className="flex gap-1.5">
                      <button
                        onClick={() => {
                          setForm({ name: b.name, description: b.description || '' });
                          setModal(b);
                        }}
                        title="Edit batch"
                        className="grid h-7 w-7 place-items-center rounded-lg bg-slate-800 text-slate-400 transition hover:bg-slate-700 hover:text-white"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => setDeleting(b)}
                        title="Delete batch"
                        className="grid h-7 w-7 place-items-center rounded-lg bg-slate-800 text-slate-400 transition hover:bg-red-500/15 hover:text-red-400"
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </div>
                  <h4 className="mb-1 text-base font-bold text-white">{b.name}</h4>
                  {b.description ? (
                    <p className="text-xs leading-relaxed text-slate-400">{b.description}</p>
                  ) : null}
                </div>
                <div className="mt-4 border-t border-slate-800 pt-3">
                  {members.length ? (
                    <p className="truncate text-[11px] text-slate-500" title={members.join(', ')}>
                      {members.slice(0, 4).join(', ')}
                      {members.length > 4 ? ` +${members.length - 4} more` : ''}
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-500">No students assigned yet.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / edit batch */}
      <Modal
        open={Boolean(modal)}
        onClose={() => setModal(null)}
        title={modal === 'new' ? 'New batch' : 'Edit batch'}
        icon={modal === 'new' ? Plus : Pencil}
        footer={
          <>
            <button
              type="button"
              onClick={() => setModal(null)}
              className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="batch-form"
              disabled={saving}
              className="rounded-lg bg-accent-emerald px-5 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-600 disabled:opacity-60"
            >
              {saving ? 'Saving…' : modal === 'new' ? 'Create batch' : 'Save changes'}
            </button>
          </>
        }
      >
        <form id="batch-form" onSubmit={save} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="batch-name">
              Batch name *
            </label>
            <input
              id="batch-name"
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Batch A — Morning"
              className={input}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="batch-desc">
              Description (optional)
            </label>
            <textarea
              id="batch-desc"
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Schedule, level, mentor…"
              className={input}
            />
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete batch"
        icon={Trash2}
        size="max-w-md"
      >
        <p className="text-sm leading-relaxed text-slate-300">
          Delete <span className="font-bold text-white">“{deleting?.name}”</span>? Students stay
          enrolled — they just lose this batch assignment. The batch is also removed from any meetings
          it was assigned to.
        </p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            onClick={() => setDeleting(null)}
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
          >
            Keep it
          </button>
          <button
            onClick={remove}
            disabled={saving}
            className="rounded-lg bg-red-500/90 px-5 py-2.5 text-xs font-bold text-white transition hover:bg-red-600 disabled:opacity-50"
          >
            {saving ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

/* ==================================================================== */
/* Attendance roster (built from real Zoom participant data)            */
/* ==================================================================== */

const WINDOWS = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 365, label: 'Last year' },
];

const SORTS = [
  { id: 'totalMinutes', label: 'Most class time' },
  { id: 'sessions', label: 'Most sessions' },
  { id: 'lastAttended', label: 'Recently active' },
  { id: 'name', label: 'Name (A–Z)' },
];

/**
 * Student roster built from REAL attendance.
 *
 * Zoom's `GET /users` only lists licensed seats (on this account: the admin),
 * which is useless for an LMS. The server instead walks each past session's
 * participant list and rolls it up per person — so this shows the people who
 * actually showed up to class, how often, and for how long.
 */
function AttendanceTab() {
  const { showToast } = useToast();
  const [query, setQuery] = useState('');
  const [days, setDays] = useState(30);
  const [sort, setSort] = useState('totalMinutes');
  const [expanded, setExpanded] = useState(null);

  const roster = useApi(() => api.get(`/roster?days=${days}`), [days]);

  const students = roster.data?.students || [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? students.filter((s) => `${s.name} ${s.email}`.toLowerCase().includes(q))
      : students.slice();

    return base.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      if (sort === 'lastAttended') return new Date(b.lastAttended) - new Date(a.lastAttended);
      return (b[sort] || 0) - (a[sort] || 0);
    });
  }, [students, query, sort]);

  const withEmail = students.filter((s) => s.email).length;
  const totalHours = Math.round(students.reduce((sum, s) => sum + s.totalMinutes, 0) / 60);
  const avgPerStudent = students.length
    ? Math.round(students.reduce((sum, s) => sum + s.sessions, 0) / students.length)
    : 0;

  const exportCsv = () => {
    const header = ['Student', 'Email', 'Sessions attended', 'Total minutes', 'Average minutes', 'Longest session', 'First attended', 'Last attended'];
    const body = filtered.map((s) =>
      [s.name, s.email, s.sessions, s.totalMinutes, s.avgMinutes, s.longestMinutes, s.firstAttended, s.lastAttended]
        .map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`)
        .join(',')
    );
    const blob = new Blob([[header.join(','), ...body].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sbc-students-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`${filtered.length} students exported as CSV.`, 'Export complete');
  };

  return (
    <div className="space-y-6">
      <Panel className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="mb-1 text-sm font-bold text-white">Student Roster — built from attendance</h3>
          <p className="text-xs text-slate-400">
            Every person who actually attended a session in the window, with how often and how long.
            Zoom-licensed seats are not shown here — those are billing accounts, not students.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label="Date window"
            className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white focus:border-accent-emerald focus:outline-none"
          >
            {WINDOWS.map((w) => (
              <option key={w.days} value={w.days}>{w.label}</option>
            ))}
          </select>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            aria-label="Sort students by"
            className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white focus:border-accent-emerald focus:outline-none"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>

          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search student, email…"
              className="w-52 rounded-xl border border-slate-700 bg-slate-900 py-2 pl-9 pr-3 text-xs text-white focus:border-accent-emerald focus:outline-none"
            />
          </div>

          <button
            onClick={roster.refresh}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
            title="Re-scan attendance with Zoom (bypasses the 5-minute cache)"
          >
            <RefreshCw size={12} className={roster.loading ? 'animate-spin' : ''} /> Rescan
          </button>

          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 rounded-xl bg-accent-emerald px-3.5 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-600 disabled:opacity-50"
          >
            <Download size={12} /> Export CSV
          </button>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile label="Students seen" value={roster.loading ? '…' : students.length} tone="text-accent-emerald" sub={`${roster.data?.sessionsAnalyzed ?? '—'} sessions scanned`} />
        <SummaryTile label="Total class hours" value={roster.loading ? '…' : `${totalHours}h`} tone="text-accent-blue" sub={`${roster.data?.joinRecords ?? '—'} join records`} />
        <SummaryTile label="Avg sessions / student" value={roster.loading ? '…' : avgPerStudent} tone="text-accent-cyan" sub="distinct sessions attended" />
        <SummaryTile label="Students with email" value={roster.loading ? '…' : `${withEmail}/${students.length}`} tone="text-accent-purple" sub="rest joined as named guests" />
      </div>

      {roster.data?.cached ? (
        <p className="text-[11px] text-slate-500">
          Served from cache ({roster.data.cacheAgeSeconds}s old). Hit <strong>Rescan</strong> for a fresh scan.
        </p>
      ) : null}

      {roster.loading ? (
        <Spinner label="Scanning past sessions for attendance — this walks every session in the window…" />
      ) : roster.error ? (
        <ErrorNotice error={roster.error} onRetry={roster.refresh} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title={query ? 'No students match' : 'No attendance in this window'}
          hint={query ? 'Try a different name or email.' : 'Widen the date window, or check that sessions have participant detail.'}
        />
      ) : (
        <Panel className="overflow-x-auto p-6">
          <table className="w-full min-w-[820px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-3 font-semibold">Student</th>
                <th className="py-3 font-semibold">Email</th>
                <th className="py-3 font-semibold">Sessions</th>
                <th className="py-3 font-semibold">Total time</th>
                <th className="py-3 font-semibold">Avg / session</th>
                <th className="py-3 font-semibold">Last attended</th>
                <th className="py-3 text-right font-semibold">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filtered.map((s) => (
                <StudentRow
                  key={s.key}
                  student={s}
                  expanded={expanded === s.key}
                  onToggle={() => setExpanded(expanded === s.key ? null : s.key)}
                />
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

function StudentRow({ student: s, expanded, onToggle }) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer transition hover:bg-slate-800/40"
        aria-expanded={expanded}
      >
        <td className="py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-slate-700 bg-slate-800 text-[11px] font-bold text-slate-300">
              {initials(s.name)}
            </div>
            <span className="font-bold text-white">{s.name}</span>
            <ChevronDown size={13} className={`shrink-0 text-slate-500 transition ${expanded ? 'rotate-180' : ''}`} />
          </div>
        </td>
        <td className="py-3.5 text-slate-300">{s.email || <span className="text-slate-500">guest (no email)</span>}</td>
        <td className="py-3.5">
          <Badge className="border border-blue-500/20 bg-blue-500/10 text-blue-400">{s.sessions}</Badge>
          {s.joins > s.sessions ? (
            <span className="ml-1.5 text-[10px] text-amber-400" title={`${s.joins} total joins — some sessions were re-entered`}>
              {s.joins} joins
            </span>
          ) : null}
        </td>
        <td className="py-3.5 font-semibold text-white">{fmtHours(s.totalMinutes)}</td>
        <td className="py-3.5 text-slate-300">{fmtHours(s.avgMinutes)}</td>
        <td className="py-3.5 text-slate-400">{formatDateTime(s.lastAttended, { dateStyle: 'medium' })}</td>
        <td className="py-3.5 text-right">
          <span className="text-[11px] font-semibold text-accent-blue">{expanded ? 'Hide' : 'Sessions'}</span>
        </td>
      </tr>

      {expanded ? (
        <tr>
          <td colSpan={7} className="bg-slate-900/40 px-4 py-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {s.sessions} session{s.sessions === 1 ? '' : 's'} attended · longest {fmtHours(s.longestMinutes)} · first seen {formatDateTime(s.firstAttended, { dateStyle: 'medium' })}
            </p>
            <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
              {s.meetings.map((m, i) => (
                <li key={`${m.uuid || m.id}-${i}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-slate-200">{m.topic || 'Session'}</p>
                    <p className="truncate text-[10px] text-slate-500">{formatDateTime(m.start_time)}</p>
                  </div>
                  <span className="shrink-0 text-[11px] font-semibold text-accent-emerald">{fmtHours(m.minutes)}</span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function fmtHours(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function SummaryTile({ label, value, tone, sub }) {
  return (
    <Panel className="p-5">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
        {label === 'Total class hours' ? <Clock size={11} className="text-slate-500" /> : null}
        {label === 'Avg sessions / student' ? <TrendingUp size={11} className="text-slate-500" /> : null}
        {label === 'Students seen' ? <Users size={11} className="text-slate-500" /> : null}
        {label === 'Students with email' ? <CalendarClock size={11} className="text-slate-500" /> : null}
        {label}
      </p>
      <p className={`mt-2 text-3xl font-extrabold ${tone}`}>{value}</p>
      {sub ? <p className="mt-1 text-[11px] text-slate-500">{sub}</p> : null}
    </Panel>
  );
}
