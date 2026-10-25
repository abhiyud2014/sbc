// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { KNOWLEDGE_SEED } from '../../server/knowledge-seed.js';
import { matchEntry } from '../lib/knowledgeMatch.js';
import { pickQuickPrompts, STARTER_PROMPTS } from '../lib/quickPrompts.js';

const ask = (question) => matchEntry(question, KNOWLEDGE_SEED);

describe('knowledge matcher', () => {
  it('matches natural questions to the right topic', () => {
    expect(ask('is forex trading legal in india')?.question).toMatch(/forex trading legal in India/i);
    expect(ask('what is a pip')?.question).toMatch(/pip/i);
    expect(ask('how much capital do I need to start trading')?.question).toMatch(/start trading/i);
    expect(ask('where should I put my stop loss')?.question).toMatch(/stop loss/i);
    expect(ask('how do I calculate position size')?.question).toMatch(/position size/i);
  });

  it('understands Indian-market abbreviations', () => {
    expect(ask('how is f&o income taxed')?.question).toMatch(/F&O income taxed/i);
    expect(ask('what does oi mean')?.question).toMatch(/open interest/i);
    expect(ask('is sl mandatory')?.question).toMatch(/stop loss/i);
    expect(ask('how is intraday equity taxed')?.question).toMatch(/intraday equity trading taxed/i);
  });

  it('wins exact questions and returns null for unrelated text', () => {
    const exact = KNOWLEDGE_SEED[0];
    expect(ask(exact.question.toUpperCase())?.id).toBe(exact.id);
    expect(ask('how do I bake a chocolate cake')).toBeNull();
  });
});

describe('quick-prompt rotation', () => {
  it('draws six unique questions from the live bank', () => {
    const bank = Array.from({ length: 20 }, (_, i) => ({
      question: `How does indicator number ${i} calculate its signal?`,
    }));
    const prompts = pickQuickPrompts(bank);
    expect(prompts).toHaveLength(6);
    expect(new Set(prompts).size).toBe(6);
    for (const prompt of prompts) {
      expect(bank.some((entry) => entry.question === prompt)).toBe(true);
    }
  });

  it('falls back to the curated starters while loading or when the bank is small', () => {
    expect(pickQuickPrompts([])).toEqual(STARTER_PROMPTS);
    expect(pickQuickPrompts(null)).toEqual(STARTER_PROMPTS);
    expect(pickQuickPrompts([{ question: 'What is a pip?' }])).toEqual(STARTER_PROMPTS);
    expect(STARTER_PROMPTS).toHaveLength(6);
  });

  it('drops duplicates and unusable question lengths', () => {
    const bank = [
      { question: 'What is a pip?' },
      { question: '  what is a pip?  ' },
      { question: 'Short?' },
      { question: `A very long question about trading ${'and on '.repeat(20)}?` },
      ...Array.from({ length: 8 }, (_, i) => ({ question: `How do I use indicator ${i} correctly?` })),
    ];
    const prompts = pickQuickPrompts(bank);
    expect(prompts).toHaveLength(6);
    expect(new Set(prompts.map((p) => p.toLowerCase())).size).toBe(6);
  });
});
