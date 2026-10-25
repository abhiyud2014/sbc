/**
 * Local retrieval for the AI Knowledge-Base assistant.
 *
 * The bank has 180+ entries and students type natural questions ("is forex
 * legal in india", "how much capital do I need"), so a first-match substring
 * search is not reliable. We normalise to content words, expand common
 * trading abbreviations, apply a very light plural stemmer, then score every
 * entry by how much of the query it covers and how specific its wording is.
 * The best entry above a confidence floor wins; otherwise the caller falls
 * back to the static patterns.
 */

const STOPWORDS = new Set([
  'a', 'about', 'after', 'all', 'also', 'an', 'and', 'any', 'are', 'as', 'at', 'be',
  'because', 'been', 'before', 'being', 'best', 'between', 'but', 'by', 'can', 'could',
  'did', 'do', 'does', 'doing', 'for', 'from', 'get', 'give', 'had', 'has', 'have',
  'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'know', 'like', 'many',
  'may', 'me', 'might', 'more', 'most', 'much', 'must', 'my', 'need', 'no', 'not',
  'of', 'on', 'or', 'our', 'out', 'over', 'please', 'really', 'should', 'so', 'some',
  'tell', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they',
  'this', 'those', 'to', 'too', 'under', 'use', 'using', 'very', 'vs', 'want', 'was',
  'we', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with',
  'would', 'yes', 'you', 'your',
]);

/**
 * Abbreviations and spelling variants → the words used in the seed questions.
 * Lookup happens after stemming, so "funds" finds "fund", "investors" finds
 * "investor", and so on.
 */
const SYNONYMS = {
  sl: ['stop', 'loss'],
  stoploss: ['stop', 'loss'],
  rr: ['risk', 'reward'],
  fno: ['futures', 'options'],
  pnl: ['profit', 'loss'],
  oi: ['open', 'interest'],
  iv: ['implied', 'volatility'],
  pcr: ['put', 'call', 'ratio'],
  btst: ['buy', 'today', 'sell', 'tomorrow'],
  mtf: ['margin', 'trading', 'facility'],
  sip: ['systematic', 'investment', 'plan'],
  etf: ['exchange', 'traded', 'fund'],
  pe: ['ratio'],
  eps: ['earnings'],
  ipo: ['initial', 'public', 'offer'],
  ofs: ['offer', 'sale'],
  usdinr: ['usd', 'inr'],
  eurusd: ['eur', 'usd'],
  gbpusd: ['gbp', 'usd'],
  usdjpy: ['usd', 'jpy'],
  banknifty: ['bank', 'nifty'],
  nifty50: ['nifty'],
  trading: ['trade'],
  trending: ['trend'],
  investing: ['invest'],
  investor: ['invest'],
  capital: ['money'],
  fund: ['money'],
  cost: ['charge'],
  charged: ['charge'],
  taxed: ['tax'],
  taxation: ['tax'],
  rupee: ['inr'],
  share: ['stock'],
  equity: ['stock'],
};

const normalise = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/f\s*&\s*o/g, ' fno ')
    .replace(/p\s*&\s*l/g, ' pnl ')
    .replace(/p\s*\/\s*e/g, ' pe ')
    .replace(/r\s*:\s*r/g, ' rr ')
    .replace(/s\s*\/\s*l/g, ' sl ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Very light plural stemmer — enough for "brokers", "losses", "strategies". */
const stem = (word) => {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(sses|xes|ches|shes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('sis')) {
    return word.slice(0, -1);
  }
  return word;
};

/** Content tokens: stopwords and bare amounts are dropped, synonyms expanded. */
export const tokenize = (text) => {
  const tokens = [];
  for (const raw of normalise(text).split(' ')) {
    if (!raw || /^\d+$/.test(raw)) continue;
    const base = stem(raw);
    const parts = SYNONYMS[base] || SYNONYMS[raw] || [base];
    for (const part of parts) {
      const token = stem(part);
      if (token.length < 2 || STOPWORDS.has(token)) continue;
      tokens.push(token);
    }
  }
  return tokens;
};

/** Coverage of the query plus precision (short, specific questions win). */
const scoreEntry = (queryTokens, question) => {
  const entryTokens = tokenize(question);
  if (!entryTokens.length) return 0;

  const querySet = new Set(queryTokens);
  const entrySet = new Set(entryTokens);
  let hits = 0;
  for (const token of querySet) if (entrySet.has(token)) hits += 1;

  const coverage = hits / querySet.size;
  const precision = hits / entrySet.size;
  const queryPhrase = queryTokens.join(' ');
  const phraseBonus =
    queryPhrase && ` ${entryTokens.join(' ')} `.includes(` ${queryPhrase} `) ? 0.25 : 0;

  return coverage * 0.75 + precision * 0.25 + phraseBonus;
};

const CONFIDENCE_FLOOR = 0.42;

/**
 * Return the closest entry from `list` for `text` together with its score, or
 * null when nothing reaches `floor`. An exact question match always wins,
 * which keeps mentor-corrected answers attached to the question they were
 * written for. The scope guard uses a stricter floor for vague one-word
 * questions, so the score is exposed instead of being thrown away.
 */
export const matchEntryScored = (text, list, floor = CONFIDENCE_FLOOR) => {
  const raw = String(text || '').trim().toLowerCase();
  const entries = Array.isArray(list) ? list : [];
  if (!raw || !entries.length) return null;

  const exact = entries.find(
    (entry) => String(entry?.question || '').trim().toLowerCase() === raw
  );
  if (exact) return { entry: exact, score: 1 };

  const queryTokens = tokenize(raw);
  if (!queryTokens.length) return null;

  let best = null;
  let bestScore = 0;
  for (const entry of entries) {
    const score = scoreEntry(queryTokens, entry?.question);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best && bestScore >= floor ? { entry: best, score: bestScore } : null;
};

/** Backwards-compatible wrapper for callers that only need the entry. */
export const matchEntry = (text, list) => matchEntryScored(text, list)?.entry || null;
