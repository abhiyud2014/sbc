/**
 * Quick-prompt rotation for the AI Knowledge Bot.
 *
 * The bot has 180+ answers, so showing the same six starter questions forever
 * hides most of the bank. We draw six questions from the live knowledge list
 * (including mentor-promoted answers) and let the student reshuffle them.
 * While the list is loading — or if the server has fewer than six usable
 * questions — the curated starters keep the panel useful.
 */

export const STARTER_PROMPTS = [
  'What is stop loss and how should I size my position?',
  'How much capital do I need to start trading?',
  'Is forex trading legal in India?',
  'How does RSI work and what is divergence?',
  'How is F&O income taxed in India?',
  'What is a pip and how is pip value calculated?',
];

const MIN_QUESTION_LENGTH = 12;
const MAX_QUESTION_LENGTH = 120;

/**
 * Return up to `count` unique questions from `list` in random order.
 * Falls back to `fallback` when the bank is not ready or too small.
 */
export const pickQuickPrompts = (list, count = 6, fallback = STARTER_PROMPTS) => {
  const questions = [];
  const seen = new Set();

  for (const entry of Array.isArray(list) ? list : []) {
    const question = String(entry?.question || '').trim();
    if (question.length < MIN_QUESTION_LENGTH || question.length > MAX_QUESTION_LENGTH) continue;

    const key = question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    questions.push(question);
  }

  if (questions.length < count) return fallback.slice(0, count);

  // Fisher-Yates shuffle — the caller decides when to draw a fresh set.
  for (let i = questions.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [questions[i], questions[j]] = [questions[j], questions[i]];
  }
  return questions.slice(0, count);
};
