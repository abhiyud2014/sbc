import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, BookOpen, Bolt, MessageSquare, RefreshCw, Send, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../hooks/useApi.js';
import { matchEntry } from '../lib/knowledgeMatch.js';
import { pickQuickPrompts } from '../lib/quickPrompts.js';

const KNOWLEDGE = [
  {
    match: /stop ?loss|r: ?r|risk.?to.?reward/i,
    answer:
      'Risk-to-reward = (entry − stop) vs (entry − target). A 1:2 R:R means you risk ₹100 to make ₹200. On a ₹1,00,000 account risking 1% (₹1,000) at 1:2, a single win earns ₹2,000 — you only need a 34% hit rate to break even.',
  },
  {
    match: /macd|rsi|divergence/i,
    answer:
      'Regular bearish divergence: price makes a higher high while MACD/RSI makes a lower high → momentum is fading, watch for a rejection at a supply zone. Hidden bullish divergence: price makes a higher low while the oscillator makes a lower low → trend continuation. Always confirm with structure break, never divergence alone.',
  },
  {
    match: /drawdown|prop firm|daily loss/i,
    answer:
      'Most prop firms cap daily loss at 5% of the starting balance and total drawdown at 8–10% (trailing or static). Breaching the daily limit usually ends the challenge instantly, so size positions so that stop-out distance × lot size stays under the daily budget.',
  },
  {
    match: /recording|watch first|beginner/i,
    answer:
      'Start with “Price Action & Support/Resistance Mastery” (Beginner), then “Risk Management 101: Position Sizing”. Both live under the Cloud Recordings tab once the session has finished and synced from Zoom.',
  },
  {
    match: /zoom|webinar|join|session/i,
    answer:
      'Sessions are created through the Zoom Server-to-Server API in the Zoom Sessions tab. Every meeting there has a real meeting ID, passcode and join URL — click Join to open it in the Zoom Workplace client.',
  },
];

const FALLBACK =
  'I could not find that in the local knowledge base yet. Ask about market basics, funds, charges, taxes, risk, position sizing, indicators, F&O or forex — and a mentor can promote a better answer from the Q&A Log.';

const now = () =>
  new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

const WELCOME =
  'Welcome to the SBC Traders Assistant! I am trained on our proprietary knowledge-base (Risk Rules, Technical Indicators, Zoom Webinar Archives). How can I assist your trading session today?';

// One conversation per signed-in viewer. The SERVER owns the history
// (`GET/PUT /api/chats/:key` — so it follows the student to any browser);
// localStorage only holds a cache of the last copy for instant paint.
const chatKey = (viewer) => {
  if (viewer?.role === 'admin') return 'admin';
  if (viewer?.id) return viewer.id; // stable student id — same key everywhere
  return (
    (viewer?.name || 'student')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'student'
  );
};

const cacheKey = (key) => `sbc.chat.${key}`;

const loadChat = (key) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(cacheKey(key)) || 'null');
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    /* corrupt or unavailable storage — start fresh */
  }
  return [{ sender: 'bot', text: WELCOME, time: now() }];
};

const saveChat = (key, messages) => {
  try {
    localStorage.setItem(cacheKey(key), JSON.stringify(messages.slice(-60))); // keep it bounded
  } catch {
    /* storage full/private — cache just won't persist */
  }
};

/**
 * AI Knowledge bot (local rule-based demo — swap in an LLM endpoint here).
 *
 * Answer order: mentor-edited/promoted answers (`GET /api/knowledge`) first,
 * then the built-in static KNOWLEDGE patterns. Every question is logged
 * server-side with the viewer's attribution so the admin can audit them in
 * Q&A Log: `POST /api/questions` (fire-and-forget — a logging failure never
 * blocks chat). The conversation itself is persisted SERVER-side per viewer
 * (`GET/PUT /api/chats/:key`) so it follows the student across browsers;
 * localStorage only keeps a cache for instant paint.
 */
export default function Chatbot({ viewer }) {
  const [mode, setMode] = useState('session');
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [promptRound, setPromptRound] = useState(0);
  const storeKey = chatKey(viewer);
  const [messages, setMessages] = useState(() => loadChat(storeKey));
  // Stays false until the first server sync settles — guards the server copy
  // against being clobbered by a stale/empty local cache.
  const [hydrated, setHydrated] = useState(false);
  const endRef = useRef(null);

  // Re-open the right conversation when the viewer changes (admin preview).
  useEffect(() => {
    setMessages(loadChat(storeKey));
    setHydrated(false);
  }, [storeKey]);

  // The SERVER owns the history: pull it on mount so the conversation follows
  // the student to any browser/device. If the server has nothing yet, push the
  // local cache up once (migration for chats saved before server sync existed).
  useEffect(() => {
    let alive = true;
    setHydrated(false);
    api
      .get(`/chats/${encodeURIComponent(storeKey)}`)
      .then((data) => {
        if (!alive) return;
        const server = Array.isArray(data?.messages) ? data.messages : [];
        if (server.length) setMessages(server);
        else {
          const cached = loadChat(storeKey);
          if (cached.length > 1) {
            api.put(`/chats/${encodeURIComponent(storeKey)}`, { messages: cached }).catch(() => {});
          }
        }
      })
      .catch(() => {
        /* offline — keep showing the cached conversation */
      })
      .finally(() => {
        if (alive) setHydrated(true);
      });
    return () => {
      alive = false;
    };
  }, [storeKey]);

  // Cache locally for instant paint, then mirror to the server (after the
  // first sync) so every browser sees the same conversation.
  useEffect(() => {
    saveChat(storeKey, messages);
    if (!hydrated) return;
    api.put(`/chats/${encodeURIComponent(storeKey)}`, { messages }).catch(() => {});
  }, [storeKey, messages, hydrated]);

  // Answers the mentor promoted from the Q&A log take priority.
  const knowledge = useApi(() => api.get('/knowledge'), []);

  // Six questions drawn from the live bank, not a fixed copy. Re-drawn when
  // the bank arrives or the student presses Shuffle.
  const quickPrompts = useMemo(
    () => pickQuickPrompts(knowledge.data?.knowledge),
    // promptRound is the shuffle trigger; the helper itself is random.
    [knowledge.data, promptRound]
  );

  /**
   * Mentor-correction sync: when the admin answers/corrects a logged question
   * (Q&A Log → Edit answer), the asker sees it directly in their own chat —
   * the old bot bubble is rewritten to the mentor's wording and tagged
   * "mentor-corrected". Runs whenever fresh knowledge data arrives (load,
   * refresh), and is idempotent thanks to the `corrected` flag.
   */
  useEffect(() => {
    const edits = (knowledge.data?.knowledge || []).filter((k) => k.source === 'qa-edit');
    if (!edits.length) return;
    setMessages((prev) => {
      const next = [];
      let changed = false;
      for (let i = 0; i < prev.length; i += 1) {
        const msg = prev[i];
        const bot = prev[i + 1];
        if (msg.sender === 'user' && !msg.corrected && bot?.sender === 'bot') {
          const hit = matchEntry(String(msg.text || ''), edits);
          if (hit) {
            changed = true;
            next.push({ ...msg, corrected: true });
            next.push({ ...bot, text: hit.answer, source: 'mentor-approved', corrected: true });
            i += 1; // consumed the bot bubble
            continue;
          }
        }
        next.push(msg);
      }
      return changed ? next : prev;
    });
  }, [knowledge.data]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [messages, typing]);

  const askName = viewer?.name || 'Student';

  const send = (rawText) => {
    const text = (rawText ?? input).trim();
    if (!text) return;
    setMessages((m) => [...m, { sender: 'user', text, time: now() }]);
    setInput('');
    setTyping(true);

    setTimeout(() => {
      // 1) Promoted knowledge-base answers (best-scoring entry).
      const kbList = knowledge.data?.knowledge || [];
      const kbHit = matchEntry(text, kbList);

      // 2) Built-in static patterns.
      const staticHit = KNOWLEDGE.find((k) => k.match.test(text));
      const answer = kbHit ? kbHit.answer : staticHit ? staticHit.answer : FALLBACK;

      setMessages((m) => [
        ...m,
        {
          sender: 'bot',
          text: answer,
          time: now(),
          mode,
          source: kbHit
            ? kbHit.source === 'qa-edit'
              ? 'mentor-approved'
              : 'knowledge-base'
            : staticHit
              ? 'local'
              : 'fallback',
        },
      ]);
      setTyping(false);

      // Every question lands in the admin's Q&A audit log with attribution.
      api
        .post('/questions', {
          question: text,
          answer,
          askedBy: askName,
          role: viewer?.role === 'admin' ? 'admin' : 'participant',
          studentId: viewer?.role === 'admin' ? undefined : viewer?.id,
          source: 'chatbot',
        })
        .catch(() => {
          /* logging must never break the chat */
        });
    }, 550);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
      {/* Control panel */}
      <div className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-card-bg p-5 shadow-xl">
        <div>
          <div className="mb-4 flex items-center gap-3 border-b border-slate-800 pb-4">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent-purple/20 text-accent-purple">
              <Bot size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">AI Knowledge Bot</h3>
              <p className="text-[10px] text-accent-emerald">
                {knowledge.data?.knowledge?.length
                  ? `${knowledge.data.knowledge.length} answers · local knowledge base`
                  : 'Local knowledge base'}
              </p>
            </div>
          </div>

          <p className="mb-4 text-xs leading-relaxed text-slate-400">
            Select the bot operation mode depending on whether you are currently in a live Zoom webinar or
            studying off-hours.
          </p>

          <div className="mb-6 space-y-2.5">
            <ModeButton
              active={mode === 'session'}
              onClick={() => setMode('session')}
              icon={Bolt}
              tone="emerald"
              title="Session Mode (Live Q&A)"
              subtitle="Instant answers for Zoom webinars"
            />
            <ModeButton
              active={mode === 'offline'}
              onClick={() => setMode('offline')}
              icon={BookOpen}
              tone="blue"
              title="Off-Hours / Self-Paced"
              subtitle="Deep reference lookup & playbook"
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Quick Trading Prompts
              </p>
              <button
                type="button"
                onClick={() => setPromptRound((round) => round + 1)}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-slate-500 transition hover:text-accent-emerald"
                title="Show another set of questions"
                aria-label="Shuffle quick prompts"
              >
                <RefreshCw size={11} /> Shuffle
              </button>
            </div>
            <div className="space-y-1.5">
              {quickPrompts.map((p) => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  title={p}
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 p-2.5 text-left text-xs text-slate-300 transition hover:bg-slate-800"
                >
                  <span className="flex items-start gap-1.5">
                    <span className="mt-px text-[10px] text-accent-emerald">→</span>
                    <span className="line-clamp-2">{p}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 border-t border-slate-800 pt-3 text-[11px] text-slate-500">
          <p className="mb-1.5 flex items-center gap-1.5">
            <MessageSquare size={11} className="text-accent-emerald" />
            Asking as <span className="font-semibold text-slate-300">{askName}</span>
            <span className={`rounded px-1 py-px text-[9px] font-bold ${viewer?.role === 'admin' ? 'bg-accent-emerald/15 text-accent-emerald' : 'bg-accent-blue/15 text-accent-blue'}`}>
              {viewer?.role === 'admin' ? 'admin' : 'participant'}
            </span>
          </p>
          <p className="mb-1.5">
            Every question is logged for admin review in the Q&amp;A Log — good answers can be promoted
            to this bot's knowledge base.
          </p>
          <p className="text-[10px] leading-relaxed text-slate-500">
            Educational answers only, not investment advice. Confirm current rules, charges and
            tax rates with the exchange, your broker or a chartered accountant.
          </p>
        </div>
      </div>

      {/* Chat window */}
      <div className="flex h-[calc(100vh-13rem)] flex-col overflow-hidden rounded-2xl border border-slate-800 bg-card-bg shadow-xl lg:col-span-3">
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/50 p-4">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 animate-pulse rounded-full bg-accent-emerald" />
            <div>
              <h4 className="text-xs font-bold text-white">SBC Traders AI Knowledge-Base Assistant</h4>
              <p className="text-[10px] text-slate-400">
                Mode:{' '}
                <span className="font-semibold text-accent-emerald">
                  {mode === 'session' ? 'Live Webinar Q&A (Ultra-fast)' : 'Self-Paced Deep Study'}
                </span>
              </p>
            </div>
          </div>
          <button
            onClick={() =>
              setMessages([
                { sender: 'bot', text: 'Chat cleared. What would you like to study next?', time: now() },
              ])
            }
            className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-400 transition hover:text-white"
          >
            <Trash2 size={12} /> Clear
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto bg-dark-bg/50 p-4 sm:p-6">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed sm:max-w-[70%] ${
                  msg.sender === 'user'
                    ? 'rounded-br-none bg-accent-emerald font-medium text-slate-950'
                    : 'rounded-bl-none border border-slate-800 bg-card-bg text-slate-100 shadow-lg'
                }`}
              >
                {msg.sender === 'bot' ? (
                  <p className="mb-1 text-[10px] font-bold text-accent-emerald">
                    SBC Traders AI
                    {msg.corrected ? (
                      <span className="ml-2 rounded bg-accent-emerald/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-accent-emerald">
                        ✓ mentor-corrected
                      </span>
                    ) : null}
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap">{msg.text}</p>
                <p
                  className={`mt-1 text-right text-[9px] ${
                    msg.sender === 'user' ? 'text-slate-800' : 'text-slate-400'
                  }`}
                >
                  {msg.time}
                </p>
              </div>
            </div>
          ))}
          {typing ? (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-none border border-slate-800 bg-card-bg px-4 py-3 text-xs text-slate-400 shadow-lg">
                <span className="animate-pulse">SBC Traders AI is thinking…</span>
              </div>
            </div>
          ) : null}
          <div ref={endRef} />
        </div>

        <div className="border-t border-slate-800 bg-card-bg p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex items-center gap-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything about trading terminology, strategies, or risk rules…"
              className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-xs text-white focus:border-accent-emerald focus:outline-none"
            />
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-xl bg-accent-emerald px-5 py-3 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-900/20 transition hover:bg-emerald-600"
            >
              Send <Send size={13} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function ModeButton({ active, onClick, icon: Icon, tone, title, subtitle }) {
  const activeTone =
    tone === 'emerald'
      ? 'border-accent-emerald/40 bg-accent-emerald/10 text-accent-emerald'
      : 'border-accent-blue/40 bg-accent-blue/10 text-accent-blue';
  const iconTone = tone === 'emerald' ? 'text-accent-emerald' : 'text-accent-blue';

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-xl border p-3 text-left text-xs font-medium transition ${
        active ? activeTone : 'border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800'
      }`}
    >
      <span className="flex items-center gap-2.5">
        <Icon size={15} className={active ? iconTone : 'text-slate-400'} />
        <span>
          <span className="block font-bold">{title}</span>
          <span className="block text-[10px] text-slate-400">{subtitle}</span>
        </span>
      </span>
      {active ? <span className={`text-xs ${iconTone}`}>●</span> : null}
    </button>
  );
}
