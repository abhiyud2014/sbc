/**
 * Scope guard for the AI Knowledge Bot.
 *
 * The bot is a trading study assistant plus a thin help layer for the LMS
 * itself. Without a gate it answered anything: “where can I get the zoom
 * recording passkey” hit a broad `/recording/` pattern and the bot confidently
 * recommended a beginner video. A confidence floor cannot catch that — the
 * match clears the floor but the question is not about trading at all.
 *
 * So every question is classified before retrieval:
 *
 *   1. `app-help`  — “where is X in this app”. Answered from the UI the thing
 *                    actually lives in (Cloud Recordings, My Classes, …).
 *   2. `trading`   — the knowledge bank and static answers may answer it.
 *   3. `out-of-scope` — refused. It never reaches the matcher, so an unrelated
 *                    question can no longer pick up a lucky token overlap.
 *
 * Trading questions must contain at least one market-domain word. A single
 * ambiguous everyday word ("capital", "price") is only trusted when the
 * knowledge bank has a confident answer for it; otherwise the question is
 * refused instead of being force-matched.
 */
import { matchEntryScored } from './knowledgeMatch.js';

export const OUT_OF_SCOPE =
  'That question is outside what I can help with. I answer trading questions — market basics, risk and position sizing, indicators, F&O, forex, charges and taxes — and questions about using SBC-LMS, such as class links, recordings and passcodes. Try a quick prompt below, or ask your mentor in the next session.';

/**
 * App-help intents, checked in order. The first match wins, which is why the
 * recording-passcode intent sits above the generic meeting one: “zoom
 * recording passkey” is about a recording, not about joining a live class.
 */
export const APP_HELP = [
  {
    id: 'recording-passcode',
    match: /\b(?:recording|recorded|replay|video)s?\b.{0,60}\b(?:pass\s*key|pass\s*code|password|pin)\b|\b(?:pass\s*key|pass\s*code)\b.{0,60}\b(?:recording|recorded|replay)\b/i,
    answer:
      'Recording passcodes are under Cloud Recordings in the sidebar. Find the session card and look for the “Recording passcode: …” badge below its files. Enter that passcode when Zoom asks for it on the playback or Share page. If a card shows no passcode, the recording does not need one; if Zoom still asks, contact your mentor.',
  },
  {
    id: 'recordings-location',
    match: /\b(?:where|how|find|locate|access|watch|see|open|download)\b.{0,60}\b(?:recording|recordings|replay|replays|recorded)\b|\b(?:recording|recordings|replay|replays)\b.{0,60}\b(?:where|find|locate|access|watch|page|tab|section|download)\b/i,
    answer:
      'Recordings are under Cloud Recordings in the sidebar. The page shows the last 90 days by default — use the 30 days / 90 days / 1 year buttons to widen the window. Each session card has Play and Download buttons, a Share page link, and the recording passcode when Zoom returns one. Playback links are signed by Zoom and expire, so open them from this page.',
  },
  {
    id: 'class-join-link',
    match: /\b(?:join|link|url|invite|enter|attend)\b.{0,60}\b(?:class|classes|session|sessions|meeting|meetings|webinar|webinars)\b|\b(?:class|classes|session|sessions|meeting|meetings|webinar|webinars)\b.{0,60}\b(?:join|link|url|invite|attend)\b/i,
    answer:
      'Open My Classes → Upcoming classes. Use the Personal link if the card has one; otherwise use the Shared link. Click Join class on the day of the session, or copy the link. Mentors see the same meetings, with meeting IDs and passcodes, under Zoom Sessions.',
  },
  {
    id: 'class-schedule',
    match: /\b(?:when|what time|schedule|timing|today|tomorrow|where)\b.{0,60}\b(?:class|classes|session|sessions|live)\b|\b(?:class|classes|session|sessions)\b.{0,60}\b(?:schedule|timing|time|today|tomorrow|start)\b/i,
    answer:
      'Open My Classes → Upcoming classes. Each card shows the date, time, duration, meeting ID and batch, with a Join class button on class day. Past sessions and your attendance are on the same page under Past classes.',
  },
  {
    id: 'meeting-passcode',
    match: /\b(?:meeting|zoom|class|session|live)\b.{0,40}\b(?:pass\s*code|password|pass\s*key)\b|\b(?:pass\s*code|pass\s*key)\b.{0,40}\b(?:meeting|zoom|class|session|live)\b/i,
    answer:
      'Live-class passcodes are shown to mentors on the Zoom Sessions card. Students usually do not need one: the Personal link or Shared link on My Classes → Upcoming classes carries the passcode. If Zoom still asks, request it from your mentor — do not post passcodes in group chats.',
  },
  {
    id: 'zoom-sessions',
    match: /\bzoom\b.{0,40}\b(?:session|sessions|meeting|meetings|webinar|webinars)\b|\b(?:session|meeting|webinar)\b.{0,20}\b(?:id|passcode|link)\b/i,
    answer:
      'Live classes run on Zoom. Mentors create and manage them under Zoom Sessions; students join from My Classes → Upcoming classes. Each card shows the date, time, meeting ID and a Personal link or Shared link.',
  },
  {
    id: 'where-to-start',
    match: /\bwhere (?:should|do|can) i (?:start|begin)\b|\bhow (?:do|should) i (?:start|begin)\b|\bwhat should i (?:watch|study|learn|do) first\b|\bwhich (?:recording|course|module)\b.{0,40}\b(?:first|start)\b/i,
    answer:
      'Start with “Price Action & Support/Resistance Mastery” (Beginner), then “Risk Management 101: Position Sizing”. Recordings appear under Cloud Recordings once a session has finished and synced from Zoom; the same topics are covered in the live sessions listed under My Classes.',
  },
  {
    id: 'greeting',
    match: /^(?:hi|hello|hey|namaste|good (?:morning|afternoon|evening))\b[\s!,.]*$/i,
    answer:
      'Hello! Ask me about trading concepts — risk, position sizing, indicators, F&O, forex, taxes and charges — or about using SBC-LMS, such as class links, recordings and passcodes.',
  },
  {
    id: 'thanks',
    match: /^(?:thanks|thank you|thx|ok|okay|got it|great)[\s!.,]*$/i,
    answer: 'You are welcome. Ask another question whenever you are ready.',
  },
];

/**
 * Market-domain vocabulary. Written as stemmed/singular words plus the common
 * inflections so a plain word-boundary test on normalised text is enough.
 */
export const DOMAIN_TERMS = [
  'market', 'markets', 'trade', 'trades', 'trading', 'trader', 'traders',
  'stock', 'stocks', 'share', 'shares', 'equity', 'equities',
  'forex', 'currency', 'currencies', 'pip', 'pips', 'lot', 'lots',
  'leverage', 'margin', 'broker', 'brokers', 'brokerage',
  'exchange', 'exchanges', 'nse', 'bse', 'nifty', 'banknifty', 'sensex',
  'index', 'indices', 'indexes', 'option', 'options', 'future', 'futures',
  'f o', 'call', 'calls', 'put', 'puts', 'strike', 'strikes', 'expiry',
  'premium', 'premiums', 'hedge', 'hedging', 'derivative', 'derivatives',
  'commodity', 'commodities', 'gold', 'silver', 'crude', 'crypto',
  'bitcoin', 'etf', 'etfs', 'mutual fund', 'mutual funds', 'sip', 'sips',
  'ipo', 'ipos', 'dividend', 'dividends', 'buyback', 'bonus', 'price',
  'prices', 'price action', 'candle', 'candles', 'candlestick',
  'candlesticks', 'chart', 'charts', 'pattern', 'patterns', 'support',
  'resistance', 'supply', 'demand', 'trend', 'trends', 'trending',
  'breakout', 'breakdown', 'momentum', 'indicator', 'indicators', 'rsi',
  'macd', 'bollinger', 'volume', 'open interest', 'oi', 'volatility',
  'risk', 'risks', 'reward', 'stop loss', 'stoploss', 'stop', 'stops',
  'loss', 'losses', 'target', 'targets', 'entry', 'entries', 'exit',
  'exits', 'position', 'positions', 'position sizing', 'sizing',
  'drawdown', 'prop firm', 'capital', 'money', 'fund', 'funds', 'account',
  'accounts', 'profit', 'profits', 'p l', 'pnl', 'tax', 'taxes', 'taxed',
  'taxation', 'charge', 'charges', 'cost', 'costs', 'fee', 'fees', 'gst',
  'stt', 'sebi', 'rbi', 'regulation', 'regulations', 'legal', 'illegal',
  'invest', 'investing', 'investment', 'investments', 'portfolio',
  'diversification', 'psychology', 'discipline', 'journal', 'backtest',
  'backtesting', 'swing', 'intraday', 'scalp', 'scalping', 'long', 'short',
  'buy', 'sell', 'hold', 'order', 'orders', 'liquidity', 'slippage',
  'spread', 'gap', 'news', 'earnings', 'valuation', 'fundamental',
  'fundamentals', 'technical', 'analysis', 'strategy', 'strategies',
  'playbook', 'beginner', 'beginners', 'learn', 'learning', 'study',
  'lesson', 'lessons', 'course', 'courses', 'syllabus', 'webinar',
  'webinars', 'mentor', 'mentors', 'class', 'classes', 'r r', 's l',
  // Market structure, instruments and paperwork questions from the bank.
  'pre open', 'large cap', 'mid cap', 'small cap', 'rights issue', 'rights',
  'promoter', 'promoters', 'holding', 'pledging', 'pledge', 'pledges',
  'bulk deal', 'bulk deals', 'block deal', 'block deals', 'asm', 'gsm',
  'surveillance', 'mtf', 'pay in', 'pay out', 'ledger', 'contract note',
  'free float', 'auto square off', 'square off', 'r multiple', 'arbitrage',
  'trendline', 'sma', 'ema', 'divergence', 'golden cross', 'death cross',
  'supertrend', 'ichimoku', 'fibonacci', 'retracement', 'pivot',
  'pivot point', 'pivot points', 'bull flag', 'pennant', 'vix', 'india vix',
  'beta', 'correlation', 'expectancy', 'win rate', 'eps', 'p e', 'itm',
  'atm', 'otm', 'pcr', 'max pain', 'straddle', 'strangle', 'iron condor',
  'dxy', 'usd inr', 'mt4', 'mt5', 'pms', 'aif', 'regulated',
  'balance sheet', 'order book', 'circuit', 'upper circuit', 'lower circuit',
];

/**
 * Domain words that are also everyday English ("capital", "price", "buy",
 * "news"). One of these alone is not proof that the question is about trading;
 * it needs a confident knowledge-base match or a second domain word. Terms not
 * listed here are treated as clearly market-specific ("pip", "nifty", "rsi").
 */
const GENERIC_TERMS = new Set([
  'market', 'markets', 'trade', 'trades', 'trading', 'trader', 'traders',
  'stock', 'stocks', 'share', 'shares', 'equity', 'equities',
  'price', 'prices', 'candle', 'candles', 'candlestick', 'candlesticks',
  'chart', 'charts', 'pattern', 'patterns', 'support', 'resistance',
  'supply', 'demand', 'trend', 'trends', 'trending', 'breakout', 'breakdown',
  'momentum', 'volume', 'risk', 'risks', 'reward', 'stop', 'stops', 'loss',
  'losses', 'target', 'targets', 'entry', 'entries', 'exit', 'exits',
  'position', 'positions', 'sizing', 'capital', 'money', 'fund', 'funds',
  'account', 'accounts', 'profit', 'profits', 'buy', 'sell', 'hold',
  'order', 'orders', 'long', 'short', 'news', 'analysis', 'technical',
  'fundamental', 'fundamentals', 'invest', 'investing', 'investment',
  'investments', 'portfolio', 'psychology', 'discipline', 'journal', 'swing',
  'intraday', 'scalp', 'scalping', 'strategy', 'strategies', 'playbook',
  'beginner', 'beginners', 'learn', 'learning', 'study', 'lesson', 'lessons',
  'course', 'courses', 'syllabus', 'webinar', 'webinars', 'mentor', 'mentors',
  'class', 'classes', 'premium', 'premiums', 'bonus', 'exchange', 'exchanges',
  'index', 'indices', 'indexes', 'call', 'calls', 'put', 'puts', 'future',
  'futures', 'tax', 'taxes', 'taxed', 'taxation', 'charge', 'charges', 'cost',
  'costs', 'fee', 'fees', 'regulation', 'regulations', 'legal', 'illegal',
  'holding', 'pledge', 'pledges', 'rights', 'spread', 'gap', 'circuit',
]);

const STRONG_TERMS = DOMAIN_TERMS.filter((term) => !GENERIC_TERMS.has(term));
const STRONG_RE = new RegExp(`\\b(?:${STRONG_TERMS.join('|')})\\b`, 'i');
const GENERIC_RE = new RegExp(`\\b(?:${[...GENERIC_TERMS].join('|')})\\b`, 'gi');
const STRICT_FLOOR = 0.6;

/** Lowercase and keep word boundaries (“Where can I…?” → “ where can i ”). */
const normaliseForScope = (text) =>
  ` ${String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

/** The first app-help intent that matches, or null when this is not app help. */
export const findAppHelp = (text) => {
  const raw = String(text || '').trim();
  if (!raw) return null;
  return APP_HELP.find((entry) => entry.match.test(raw)) || null;
};

const hasStrongSignal = (text) => STRONG_RE.test(normaliseForScope(text));
const genericSignalCount = (text) =>
  (normaliseForScope(text).match(GENERIC_RE) || []).length;

/** True when the question contains at least one market-domain word. */
export const isTradingQuestion = (text) =>
  hasStrongSignal(text) || genericSignalCount(text) > 0;

/**
 * Decide how (or whether) the bot may answer.
 *
 * `knowledge` is optional: it lets a single ambiguous word ("capital") pass
 * only when the knowledge bank has a confident answer. Without it (or when the
 * bank is unavailable) such a question is refused rather than guessed.
 *
 * @returns {{kind: 'app-help', entry: object} | {kind: 'trading'} | {kind: 'out-of-scope'}}
 */
export const classifyQuestion = (text, knowledge = []) => {
  const appHelp = findAppHelp(text);
  if (appHelp) return { kind: 'app-help', entry: appHelp };

  // A mentor who answered a logged question outranks the domain gate: the
  // correction is served the next time that question (or a close paraphrase)
  // is asked, even if the topic is not in the trading vocabulary.
  const mentorApproved = (Array.isArray(knowledge) ? knowledge : []).filter(
    (entry) => entry?.source === 'qa-edit'
  );
  const mentorHit = matchEntryScored(text, mentorApproved, STRICT_FLOOR);
  if (mentorHit) return { kind: 'trading', entry: mentorHit.entry };

  if (hasStrongSignal(text)) return { kind: 'trading' };

  const weak = genericSignalCount(text);
  if (weak >= 2) return { kind: 'trading' };
  if (weak === 1 && matchEntryScored(text, knowledge, STRICT_FLOOR)) {
    return { kind: 'trading' };
  }
  return { kind: 'out-of-scope' };
};
