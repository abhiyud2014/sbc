import { useMemo, useState } from 'react';
import { Megaphone, Copy, Mail, Check, Users, CalendarClock, Send } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, usePending } from '../hooks/useApi.js';
import Modal from './Modal.jsx';
import { Spinner, ErrorNotice } from './ui.jsx';
import { useToast } from './ToastProvider.jsx';
import { formatDateTime } from '../lib/format.js';

/**
 * Broadcast — compose an announcement to your students.
 *
 * Recipients come from the real attendance roster (everyone who has attended a
 * session), optionally narrowed to the students of one specific session.
 *
 * Two delivery paths:
 *   • “Publish to all students” stores the message in-app. Every enrolled
 *     student gets it once — the message centre pops up at their next sign-in
 *     and the unread badge clears when they dismiss it.
 *   • Email/copy stays provider-free: it copies the message and opens your
 *     mail client with the addresses in BCC.
 *
 * The composer renders even when the roster fails to load, so an in-app
 * announcement can always be published (it does not need the roster).
 */
export default function Broadcast({ open, onClose }) {
  const { showToast } = useToast();
  const [days, setDays] = useState(90);
  const [scope, setScope] = useState('all'); // 'all' | meeting uuid
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [copied, setCopied] = useState(false);
  const [published, setPublished] = useState(false);
  const [publishing, publishRun] = usePending();

  const roster = useApi(() => (open ? api.get(`/roster?days=${days}`) : Promise.resolve(null)), [open, days], {
    immediate: Boolean(open),
  });

  const students = roster.data?.students || [];
  const meetings = useMemo(() => {
    const seen = new Map();
    for (const s of students) {
      for (const m of s.meetings || []) {
        const key = m.uuid || m.id;
        if (!seen.has(key)) seen.set(key, { ...m, attendees: 0 });
        seen.get(key).attendees += 1;
      }
    }
    return [...seen.values()].sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
  }, [students]);

  const recipients = useMemo(() => {
    const withEmail = scope === 'all'
      ? students
      : students.filter((s) => (s.meetings || []).some((m) => (m.uuid || m.id) === scope));
    return [...new Set(withEmail.map((s) => s.email).filter(Boolean))];
  }, [students, scope]);

  const scopeLabel =
    scope === 'all'
      ? `all ${recipients.length} students with an email on file`
      : `attendees of “${meetings.find((m) => (m.uuid || m.id) === scope)?.topic || 'that session'}”`;

  const fullText = subject && body ? `Subject: ${subject}\n\n${body}\n\n— Sent from SBC-LMS` : body || '';

  const copy = async () => {
    if (!fullText) {
      showToast('Write a message first.', 'Nothing to copy', 'info');
      return;
    }
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      showToast(`Announcement copied (${recipients.length} recipients in scope).`, 'Copied');
    } catch {
      showToast('Clipboard blocked — select the text and copy manually.', 'Copy failed', 'error');
    }
  };

  const copyEmails = async () => {
    if (!recipients.length) {
      showToast('No recipients have an email address on file.', 'No emails', 'info');
      return;
    }
    try {
      await navigator.clipboard.writeText(recipients.join('; '));
      showToast(`${recipients.length} addresses copied.`, 'Recipients copied');
    } catch {
      showToast('Clipboard blocked by the browser.', 'Copy failed', 'error');
    }
  };

  const openMail = () => {
    if (!recipients.length) {
      showToast('No recipients have an email address on file.', 'No emails', 'info');
      return;
    }
    // BCC everyone so student addresses stay private from each other.
    const url =
      `mailto:?bcc=${encodeURIComponent(recipients.join(','))}` +
      `&subject=${encodeURIComponent(subject || 'Announcement from SBC-LMS')}` +
      `&body=${encodeURIComponent(body || '')}`;
    window.location.href = url;
    showToast(`Opening your mail client with ${recipients.length} addresses in BCC.`, 'Mail client');
  };

  // In-app publish: all enrolled students, independent of the email roster.
  const publish = () => {
    if (!body.trim()) {
      showToast('Write a message before publishing.', 'Nothing to publish', 'info');
      return;
    }
    publishRun(async () => {
      try {
        await api.post('/announcements', { subject: subject.trim(), body: body.trim() });
        setPublished(true);
        setTimeout(() => setPublished(false), 1800);
        showToast(
          'Every student gets it once — it pops up at their next sign-in and clears when they dismiss it.',
          'Published to all students'
        );
      } catch (err) {
        showToast(err.message, 'Could not publish', 'error');
      }
    });
  };

  const label = 'mb-1 block text-xs font-medium text-slate-300';
  const input =
    'w-full rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-white focus:border-accent-emerald focus:outline-none';

  return (
    <Modal open={open} onClose={onClose} title="Broadcast an announcement" icon={Megaphone} size="max-w-2xl">
      <div className="space-y-4">
        {roster.loading ? (
          <Spinner label="Loading your student roster…" />
        ) : roster.error ? (
          <ErrorNotice
            error={roster.error}
            onRetry={roster.refresh}
            title="Could not load the email roster — in-app publishing still works"
          />
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="bc-days">Look back</label>
              <select
                id="bc-days"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className={input}
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
                <option value={365}>Last year</option>
              </select>
            </div>

            <div>
              <label className={label} htmlFor="bc-scope">Audience</label>
              <select
                id="bc-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className={input}
              >
                <option value="all">All students ({students.length} seen)</option>
                {meetings.slice(0, 25).map((m) => (
                  <option key={m.uuid || m.id} value={m.uuid || m.id}>
                    {m.topic || 'Session'} — {formatDateTime(m.start_time, { dateStyle: 'short' })}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3.5 py-2.5 text-[11px] text-slate-400">
            <Users size={13} className="text-accent-emerald" />
            <span>
              Sending to <strong className="text-white">{recipients.length}</strong> {scopeLabel}
            </span>
            {recipients.length < students.filter((s) => s.email).length && scope !== 'all' ? (
              <span className="text-amber-400">(subset of all students)</span>
            ) : null}
          </div>

          <div>
            <label className={label} htmlFor="bc-subject">Subject</label>
            <input
              id="bc-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Saturday class moved to 4 PM"
              className={input}
            />
          </div>

          <div>
            <label className={label} htmlFor="bc-body">Message</label>
            <textarea
              id="bc-body"
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={'Hi team,\n\nThis Saturday’s session starts at 4 PM. Bring your risk sheet.\n\n— SBC Traders'}
              className={input}
            />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <CalendarClock size={11} /> Preview
            </p>
            {fullText ? (
              <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-300">
                {fullText}
              </pre>
            ) : (
              <p className="text-xs italic text-slate-600">Nothing written yet.</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-4">
            <button
              onClick={publish}
              disabled={publishing || !body.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-accent-emerald px-4 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-emerald-600 disabled:opacity-50"
            >
              {published ? <Check size={13} /> : <Send size={13} />}
              {publishing
                ? 'Publishing…'
                : published
                  ? 'Published to all students'
                  : 'Publish to all students'}
            </button>
            <button
              onClick={openMail}
              disabled={!recipients.length}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700 disabled:opacity-50"
            >
              <Mail size={13} /> Open in mail client (BCC)
            </button>
            <button
              onClick={copy}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
            >
              {copied ? <Check size={13} className="text-accent-emerald" /> : <Copy size={13} />} Copy message
            </button>
            <button
              onClick={copyEmails}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
            >
              <Copy size={13} /> Copy addresses
            </button>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-500">
            <strong className="text-slate-400">Publish to all students</strong> puts the message in the
            student message centre — it pops up once at their next sign-in and the red unread badge clears
            when they dismiss it. Email delivery stays in your own mail client, so addresses are never sent
            from this app.
          </p>
        </div>
    </Modal>
  );
}
