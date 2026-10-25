import { useMemo, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  HelpCircle,
  MessageSquare,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  Video,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, usePending } from '../hooks/useApi.js';
import { Badge, EmptyState, ErrorNotice, Panel, Spinner } from '../components/ui.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import Modal from '../components/Modal.jsx';

const WINDOWS = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
];

/**
 * Q&A audit log — every question asked, with attribution:
 *   • questions asked in the AI Knowledge Bot (source: chatbot)
 *   • Zoom's own in-session Q&A (opt-in sync, source: zoom-qa)
 *
 * The mentor can answer or CORRECT any entry ("Edit answer"): the bot keeps
 * serving the AI's original text in `aiAnswer`, while the edited answer is
 * merged into the bot's answer pool (GET /api/knowledge) so the student who
 * asked — and anyone asking the same question later — receives the mentor's
 * wording. Good answers can also be promoted wholesale into the knowledge base.
 *
 *   GET    /api/questions?days=30[&zoom=1&refresh=1]
 *   PATCH  /api/questions/:id   { answer }
 *   POST   /api/questions/promote
 */
export default function Questions() {
  const { showToast } = useToast();
  const [days, setDays] = useState(30);
  const [zoomSync, setZoomSync] = useState(false);
  const [query, setQuery] = useState('');
  const [promoting, runPromote] = usePending();
  const [editing, setEditing] = useState(null); // question being answered
  const [draft, setDraft] = useState(''); // the mentor's response
  const [savingAnswer, runSaveAnswer] = usePending();

  const questions = useApi(() => api.get(`/questions?days=${days}${zoomSync ? '&zoom=1' : ''}`), [
    days,
    zoomSync,
  ]);
  const knowledge = useApi(() => api.get('/knowledge'));

  const list = questions.data?.questions || [];
  const promoted = new Set((knowledge.data?.knowledge || []).map((k) => k.question.toLowerCase()));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((item) =>
      `${item.question} ${item.answer || ''} ${item.askedBy || ''} ${item.topic || ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [list, query]);

  const botCount = list.filter((q) => q.source !== 'zoom-qa').length;
  const zoomCount = list.length - botCount;

  const promote = async (item) => {
    try {
      await runPromote(() => api.post('/questions/promote', { question: item.question, answer: item.answer }));
      showToast('The answer is now served by the AI bot to every future student.', 'Added to knowledge base');
      knowledge.refresh();
    } catch (err) {
      showToast(err.message, 'Could not promote', 'error');
    }
  };

  const openEditor = (item) => {
    setEditing(item);
    setDraft(item.answer || '');
  };

  const saveAnswer = () =>
    runSaveAnswer(async () => {
      try {
        await api.patch(`/questions/${editing.id}`, { answer: draft.trim() });
        showToast(
          'The bot will now serve this wording — including to the student who asked.',
          'Response saved'
        );
        setEditing(null);
        questions.refresh();
        knowledge.refresh(); // edited answers join the bot's answer pool
      } catch (err) {
        showToast(err.message, 'Could not save the response', 'error');
      }
    });

  const zoomMeta = questions.data?.zoomMeta;

  return (
    <div className="space-y-6">
      <Panel className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="mb-1 text-sm font-bold text-white">Questions asked (audit log)</h3>
          <p className="text-xs text-slate-400">
            Bot questions are logged live with the asker's role. Toggle “Sync Zoom Q&A” to pull each
            session's in-meeting questions as well (walks the meeting report — cached 5 minutes).
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
              <option key={w.days} value={w.days}>
                {w.label}
              </option>
            ))}
          </select>

          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search questions…"
              className="w-52 rounded-xl border border-slate-700 bg-slate-900 py-2 pl-9 pr-3 text-xs text-white focus:border-accent-emerald focus:outline-none"
            />
          </div>

          <button
            onClick={() => setZoomSync((v) => !v)}
            title="Merge Zoom's in-session Q&A for every session in the window"
            className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition ${
              zoomSync
                ? 'border-accent-emerald/40 bg-accent-emerald/15 text-accent-emerald'
                : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
          >
            <Video size={12} /> {zoomSync ? 'Zoom Q&A: on' : 'Sync Zoom Q&A'}
          </button>

          <button
            onClick={questions.refresh}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
          >
            <RefreshCw size={12} className={questions.loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Tile label="Questions in window" value={questions.loading ? '…' : list.length} tone="text-accent-emerald" />
        <Tile label="From the AI bot" value={questions.loading ? '…' : botCount} tone="text-accent-purple" />
        <Tile label="From Zoom sessions" value={questions.loading ? '…' : zoomCount} tone="text-accent-blue" />
      </div>

      {zoomMeta ? (
        <p className="text-[11px] text-slate-500">
          Zoom Q&A scanned across {zoomMeta.sessionsScanned} session{zoomMeta.sessionsScanned === 1 ? '' : 's'}
          {zoomMeta.cached ? ' · served from the 5-minute cache' : ' · fresh pull'}. Sessions with no
          in-meeting Q&A contribute nothing.
        </p>
      ) : null}

      {questions.loading ? (
        <Spinner label="Loading the Q&A log…" />
      ) : questions.error ? (
        <ErrorNotice title="Could not load questions" error={questions.error} onRetry={questions.refresh} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={HelpCircle}
          title={list.length === 0 ? 'No questions logged yet' : 'No questions match'}
          hint={
            list.length === 0
              ? 'Every question asked in the AI Knowledge Bot lands here with the asker attached. Turn on “Sync Zoom Q&A” to include questions asked inside the sessions themselves.'
              : 'Try a different search term.'
          }
        />
      ) : (
        <ul className="space-y-4">
          {filtered.map((item) => {
            const fromZoom = item.source === 'zoom-qa';
            const canPromote = Boolean(item.answer) && !promoted.has(item.question.toLowerCase());
            return (
              <Panel key={item.id} className="p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge
                      className={
                        fromZoom
                          ? 'border border-blue-500/20 bg-blue-500/10 text-blue-400'
                          : 'border border-accent-purple/30 bg-accent-purple/10 text-accent-purple'
                      }
                    >
                      {fromZoom ? <Video size={10} /> : <Bot size={10} />}
                      {fromZoom ? 'Zoom session Q&A' : 'AI Knowledge Bot'}
                    </Badge>
                    <span className="text-[11px] text-slate-400">
                      asked by{' '}
                      <strong className="text-slate-200">{item.askedBy || 'Unknown'}</strong>
                      {item.role === 'admin' ? (
                        <span className="ml-1 rounded bg-slate-700/50 px-1 py-px text-[9px] font-bold text-slate-300">
                          admin
                        </span>
                      ) : null}
                      {item.topic ? <span className="ml-1.5 text-slate-500">· {item.topic}</span> : null}
                    </span>
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {item.at ? new Date(item.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''}
                  </span>
                </div>

                <p className="flex items-start gap-2 text-sm font-semibold text-white">
                  <MessageSquare size={14} className="mt-0.5 shrink-0 text-slate-500" />
                  {item.question}
                </p>

                {item.answer ? (
                  <p className="mt-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs leading-relaxed text-slate-300">
                    {item.answer}
                  </p>
                ) : (
                  <p className="mt-2 text-[11px] italic text-slate-500">
                    {fromZoom ? 'No recorded answer for this one yet.' : 'No answer was logged with this question.'}
                  </p>
                )}

                {item.editedAt ? (
                  <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-accent-emerald">
                    <CheckCircle2 size={12} /> Mentor response — served by the bot
                    <span className="font-normal text-slate-500">
                      · edited{' '}
                      {new Date(item.editedAt).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                  </p>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                  <button
                    onClick={() => openEditor(item)}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-slate-700"
                  >
                    <Pencil size={12} /> {item.answer ? 'Edit answer' : 'Add response'}
                  </button>
                  {item.answer ? (
                    promoted.has(item.question.toLowerCase()) ? (
                      <span className="flex items-center gap-1.5 text-[11px] font-bold text-accent-emerald">
                        <CheckCircle2 size={12} /> In the bot's knowledge base
                      </span>
                    ) : canPromote ? (
                      <button
                        onClick={() => promote(item)}
                        disabled={promoting}
                        className="flex items-center gap-1.5 rounded-lg bg-accent-emerald px-3 py-1.5 text-[11px] font-bold text-slate-950 transition hover:bg-emerald-600 disabled:opacity-60"
                      >
                        <Sparkles size={12} /> Push to AI knowledge base
                      </button>
                    ) : null
                  ) : null}
                </div>
              </Panel>
            );
          })}
        </ul>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.answer ? 'Edit the response' : 'Answer the student'}
        icon={Pencil}
        size="max-w-xl"
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
              type="button"
              onClick={saveAnswer}
              disabled={savingAnswer || !draft.trim()}
              className="rounded-lg bg-accent-emerald px-5 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-600 disabled:opacity-60"
            >
              {savingAnswer ? 'Saving…' : 'Save response'}
            </button>
          </>
        }
      >
        {editing ? (
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Student's question
              </p>
              <p className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-sm font-semibold text-white">
                {editing.question}
              </p>
            </div>

            {editing.aiAnswer && editing.aiAnswer !== draft ? (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  The bot's original answer
                </p>
                <p className="rounded-lg border border-slate-800 bg-slate-900/30 p-3 text-xs leading-relaxed text-slate-400">
                  {editing.aiAnswer}
                </p>
              </div>
            ) : null}

            <div>
              <label
                htmlFor="qa-answer"
                className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400"
              >
                Your response
              </label>
              <textarea
                id="qa-answer"
                rows={6}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Write the answer the student should receive…"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs leading-relaxed text-white placeholder-slate-500 focus:border-accent-emerald focus:outline-none"
              />
            </div>

            <p className="text-[11px] leading-relaxed text-slate-500">
              Saved as the official answer: the AI bot serves this wording to the student who asked —
              and to anyone else who asks this question — from now on.
            </p>
          </div>
        ) : null}
      </Modal>
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
