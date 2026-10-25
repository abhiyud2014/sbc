import { useState } from 'react';
import { GraduationCap, KeyRound, Loader2, ShieldCheck, UserRound } from 'lucide-react';
import { api } from '../lib/api.js';
import { usePending } from '../hooks/useApi.js';

/**
 * Sign-in screen (light auth — server/index.js):
 *
 *   Admin        → types the ADMIN_PIN from the project-root .env
 *   Participant  → registered EMAIL + password. The password is the shared
 *                  class password set by the admin (Students & Batches →
 *                  Class login password) until the student changes it to a
 *                  personal one. The old name dropdown is gone on purpose:
 *                  it exposed the whole class list to anyone opening the page.
 *
 * On success the server returns a bearer token; App stores it and swaps to
 * the dashboard for that session's role.
 */
export default function Login({ onSignIn }) {
  const [mode, setMode] = useState('admin'); // 'admin' | 'participant'
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [pending, run] = usePending();

  const submit = (e) => {
    e.preventDefault();
    setError(null);
    run(async () => {
      try {
        const payload =
          mode === 'admin'
            ? { role: 'admin', pin }
            : { role: 'participant', email: email.trim(), password };
        const session = await api.post('/auth/login', payload);
        onSignIn?.(session);
      } catch (err) {
        setError(err.message);
      }
    });
  };

  const modeBtn = (id, label, Icon) => (
    <button
      type="button"
      key={id}
      onClick={() => {
        setMode(id);
        setError(null);
      }}
      aria-pressed={mode === id}
      className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-bold transition ${
        mode === id
          ? 'bg-accent-emerald/15 text-accent-emerald ring-1 ring-accent-emerald/40'
          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
      }`}
    >
      <Icon size={14} /> {label}
    </button>
  );

  const input =
    'w-full rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition focus:border-accent-emerald/60';
  const label = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400';

  return (
    <div className="flex min-h-screen items-center justify-center bg-dark-bg p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-card-bg p-6 shadow-2xl">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-accent-emerald/15 text-accent-emerald">
            <GraduationCap size={22} />
          </div>
          <div>
            <h1 className="text-base font-bold text-white">SBC-LMS</h1>
            <p className="text-[11px] text-slate-400">Virtual Trading Institution · Zoom sessions</p>
          </div>
        </div>

        <div className="mb-4 flex gap-2">
          {modeBtn('admin', 'Admin (Host)', ShieldCheck)}
          {modeBtn('participant', 'Student', UserRound)}
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode === 'admin' ? (
            <div>
              <label className={label} htmlFor="login-pin">
                Admin PIN
              </label>
              <input
                id="login-pin"
                type="password"
                autoComplete="current-password"
                className={input}
                placeholder="••••••"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                required
              />
              <p className="mt-1.5 text-[11px] text-slate-500">
                Set in <code className="text-slate-400">.env</code> as{' '}
                <code className="text-slate-400">ADMIN_PIN</code>.
              </p>
            </div>
          ) : (
            <>
              <div>
                <label className={label} htmlFor="login-email">
                  Email
                </label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  className={input}
                  placeholder="you@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <p className="mt-1.5 text-[11px] text-slate-500">
                  The address your mentor registered for you.
                </p>
              </div>
              <div>
                <label className={label} htmlFor="login-password">
                  Password
                </label>
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  className={input}
                  placeholder="••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <p className="mt-1.5 text-[11px] text-slate-500">
                  Class password from your mentor. One active device/browser at a time — change your
                  password from the account menu.
                </p>
              </div>
            </>
          )}

          {error ? (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending || (mode === 'participant' && (!email.trim() || !password))}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent-emerald px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-600 disabled:opacity-60"
          >
            {pending ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Signing in…
              </>
            ) : (
              <>
                <KeyRound size={14} /> Sign in
              </>
            )}
          </button>
        </form>

        <p className="mt-4 border-t border-slate-800 pt-3 text-[10px] leading-relaxed text-slate-500">
          {mode === 'admin'
            ? 'Full access: sessions, students, attendance and the Q&A audit log.'
            : 'Your view shows assigned classes, recordings, references and the AI bot.'}
        </p>
      </div>
    </div>
  );
}
