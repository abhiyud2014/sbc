import { useState } from 'react';
import { Menu, Plus, Megaphone, ChevronDown, LogOut, ShieldCheck, UserRound, Users, KeyRound } from 'lucide-react';
import { initials } from '../lib/format.js';
import { api } from '../lib/api.js';
import { usePending } from '../hooks/useApi.js';
import { useToast } from './ToastProvider.jsx';
import Modal from './Modal.jsx';

/**
 * Top bar — page title, quick actions and the ACCOUNT MENU.
 *
 *   • Admin (Host) session — the menu doubles as a "view the app as" preview
 *     switcher (look at the platform as any enrolled student) plus Sign out.
 *   • Participant session  — the role comes from sign-in, so there is nothing
 *     to switch; the menu shows the signed-in student, a Change password
 *     action (self-service → personal password) and Sign out.
 */
export default function Topbar({
  title,
  subtitle,
  onMenu,
  onSchedule,
  onBroadcast,
  account,
  role = 'admin',
  isHost = true, // session role: an admin previewing a student can still switch back
  viewer = null,
  students = [],
  onSwitchRole,
  onRefreshStudents,
  onSignOut,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { showToast } = useToast();
  const isAdmin = role === 'admin';
  const name = isAdmin ? account?.account?.name || 'Head Mentor' : viewer?.name || 'Participant';
  const email = isAdmin ? account?.account?.email || 'Zoom host account' : viewer?.email || 'no student selected';

  /* ----- student self-service password change ----- */
  const [pwOpen, setPwOpen] = useState(false);
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwError, setPwError] = useState(null);
  const [pwSaving, pwRun] = usePending();

  const closePw = () => {
    setPwOpen(false);
    setPwForm({ current: '', next: '', confirm: '' });
    setPwError(null);
  };

  const changePassword = (e) => {
    e.preventDefault();
    setPwError(null);
    if (pwForm.next.length < 6) return setPwError('Use at least 6 characters for the new password.');
    if (pwForm.next !== pwForm.confirm) return setPwError("The new passwords don't match.");
    pwRun(async () => {
      try {
        await api.post('/auth/change-password', {
          currentPassword: pwForm.current,
          newPassword: pwForm.next,
        });
        showToast('Use it the next time you sign in — it stays yours even if the class password changes.', 'Password changed');
        closePw();
      } catch (err) {
        setPwError(err.message);
      }
    });
  };

  const toggleMenu = () => {
    const next = !menuOpen;
    setMenuOpen(next);
    // The student list may have changed since the page loaded — freshen it
    // (participants don't see the switcher, so skip their 403'd refresh).
    if (next && isHost) onRefreshStudents?.();
  };

  const pick = (nextRole, studentId) => {
    onSwitchRole?.(nextRole, studentId);
    setMenuOpen(false);
  };

  const signOut = () => {
    setMenuOpen(false);
    onSignOut?.();
  };

  return (
    <header className="z-10 flex h-16 items-center justify-between border-b border-slate-800 bg-card-bg px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-4">
        <button onClick={onMenu} className="text-slate-400 hover:text-white md:hidden" aria-label="Open menu">
          <Menu size={20} />
        </button>
        <div className="min-w-0">
          <h2 className="truncate text-lg font-bold text-white">{title}</h2>
          <p className="hidden truncate text-xs text-slate-400 sm:block">{subtitle}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {isAdmin ? (
          <>
            <button
              onClick={onBroadcast}
              className="hidden items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700 sm:flex"
            >
              <Megaphone size={14} className="text-accent-blue" />
              <span>Broadcast</span>
            </button>

            <button
              onClick={onSchedule}
              className="flex items-center gap-2 rounded-lg bg-accent-emerald px-3.5 py-2 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-900/20 transition hover:bg-emerald-600"
            >
              <Plus size={14} />
              <span className="hidden sm:inline">Schedule Zoom</span>
              <span className="sm:hidden">Schedule</span>
            </button>
          </>
        ) : null}

        <div className="relative border-l border-slate-800 pl-3">
          <button
            onClick={toggleMenu}
            className="flex items-center gap-3"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Account menu"
          >
            <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-tr from-accent-blue to-indigo-600 text-sm font-bold text-white shadow">
              {initials(name)}
            </div>
            <div className="hidden text-left lg:block">
              <p className="flex items-center gap-1.5 text-xs font-bold text-white">
                {name}
                <span
                  className={`rounded px-1 py-px text-[9px] font-bold ${
                    isAdmin
                      ? 'bg-accent-emerald/15 text-accent-emerald'
                      : 'bg-accent-blue/15 text-accent-blue'
                  }`}
                >
                  {isAdmin ? 'ADMIN' : 'PARTICIPANT'}
                </span>
              </p>
              <p className="text-[10px] text-slate-400">{account?.ok || !isAdmin ? email : 'Not connected'}</p>
            </div>
            <ChevronDown size={14} className="hidden text-slate-400 lg:block" />
          </button>

          {menuOpen ? (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-40 mt-2 w-64 rounded-xl border border-slate-700 bg-card-bg p-2 shadow-2xl">
                <div className="border-b border-slate-800 px-3 py-2">
                  <p className="truncate text-xs font-bold text-white">{name}</p>
                  <p className="truncate text-[11px] text-slate-400">{email}</p>
                </div>

                <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {isHost ? 'View the app as' : 'Signed in as student'}
                </p>

                {isHost ? (
                  <>
                    <button
                      onClick={() => pick('admin', '')}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs transition hover:bg-slate-800 ${
                        isAdmin ? 'bg-slate-800 font-semibold text-white' : 'text-slate-300'
                      }`}
                    >
                      <ShieldCheck size={13} className={isAdmin ? 'text-accent-emerald' : 'text-slate-500'} />
                      Admin (Host)
                      {isAdmin ? (
                        <span className="ml-auto text-[10px] font-bold text-accent-emerald">active</span>
                      ) : null}
                    </button>

                    <p className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      <Users size={10} /> Participants
                    </p>
                    <div className="max-h-52 overflow-y-auto pr-1">
                      {students.length === 0 ? (
                        <p className="px-3 py-2 text-[11px] leading-relaxed text-slate-500">
                          No students enrolled yet — add them under Students &amp; Batches.
                        </p>
                      ) : (
                        students.map((s) => {
                          const active = viewer?.id === s.id;
                          return (
                            <button
                              key={s.id}
                              onClick={() => pick('participant', s.id)}
                              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition hover:bg-slate-800 ${
                                active ? 'bg-slate-800 font-semibold text-white' : 'text-slate-300'
                              }`}
                            >
                              <UserRound size={13} className={active ? 'text-accent-blue' : 'text-slate-500'} />
                              <span className="min-w-0">
                                <span className="block truncate">{s.name}</span>
                                <span className="block truncate text-[10px] text-slate-500">
                                  {s.batchNames?.length ? s.batchNames.join(' · ') : s.email || 'no batch'}
                                </span>
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </>
                ) : (
                  <p className="px-3 pb-1 text-[11px] leading-relaxed text-slate-500">
                    Your access comes from your student sign-in — ask your mentor if a page is missing.
                  </p>
                )}

                <div className="mt-1 border-t border-slate-800 pt-1">
                  {!isHost ? (
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        setPwError(null);
                        setPwOpen(true);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
                    >
                      <KeyRound size={13} /> Change password
                    </button>
                  ) : null}
                  <button
                    onClick={signOut}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
                  >
                    <LogOut size={13} /> Sign out
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* Student self-service password change (participant sessions only) */}
      <Modal
        open={pwOpen}
        onClose={closePw}
        title="Change your password"
        icon={KeyRound}
        size="max-w-md"
        footer={
          <>
            <button
              type="button"
              onClick={closePw}
              className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="change-pw-form"
              disabled={pwSaving}
              className="rounded-lg bg-accent-emerald px-5 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-600 disabled:opacity-60"
            >
              {pwSaving ? 'Saving…' : 'Change password'}
            </button>
          </>
        }
      >
        <form id="change-pw-form" onSubmit={changePassword} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300" htmlFor="pw-current">
              Current password
            </label>
            <input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              required
              value={pwForm.current}
              onChange={(e) => setPwForm((f) => ({ ...f, current: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-white focus:border-accent-emerald focus:outline-none"
              placeholder="••••••"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300" htmlFor="pw-new">
              New password
            </label>
            <input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={pwForm.next}
              onChange={(e) => setPwForm((f) => ({ ...f, next: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-white focus:border-accent-emerald focus:outline-none"
              placeholder="At least 6 characters"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300" htmlFor="pw-confirm">
              Confirm new password
            </label>
            <input
              id="pw-confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={pwForm.confirm}
              onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-white focus:border-accent-emerald focus:outline-none"
              placeholder="Repeat the new password"
            />
          </div>
          {pwError ? (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {pwError}
            </p>
          ) : null}
          <p className="text-[11px] leading-relaxed text-slate-500">
            Your new password becomes <span className="text-slate-400">personal to you</span> — it keeps
            working even if your mentor rotates the shared class password.
          </p>
        </form>
      </Modal>
    </header>
  );
}
