// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { KNOWLEDGE_SEED } from '../../server/knowledge-seed.js';
import { matchEntry } from '../lib/knowledgeMatch.js';
import { classifyQuestion, findAppHelp, isTradingQuestion } from '../lib/assistantScope.js';
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

describe('assistant scope guard', () => {
  it('treats trading questions as in scope', () => {
    expect(isTradingQuestion('is forex trading legal in india')).toBe(true);
    expect(isTradingQuestion('how much capital do I need')).toBe(true);
    expect(isTradingQuestion('how is f&o income taxed')).toBe(true);
    expect(isTradingQuestion('where should I put my stop loss')).toBe(true);
    expect(classifyQuestion('what is a pip').kind).toBe('trading');
  });

  it('keeps every knowledge-bank question answerable', () => {
    const refused = KNOWLEDGE_SEED.filter(
      (entry) => classifyQuestion(entry.question, KNOWLEDGE_SEED).kind !== 'trading'
    );
    expect(refused.map((entry) => entry.question)).toEqual([]);
  });

  it('needs more than one ambiguous word before trusting a knowledge match', () => {
    // "capital" alone is also an everyday word: the bank decides.
    expect(classifyQuestion('how much capital do I need', KNOWLEDGE_SEED).kind).toBe('trading');
    expect(classifyQuestion('what is the capital of france', KNOWLEDGE_SEED).kind).toBe('out-of-scope');
    expect(classifyQuestion('where can I buy a phone', KNOWLEDGE_SEED).kind).toBe('out-of-scope');
  });

  it('serves a mentor-approved answer even outside the trading vocabulary', () => {
    const mentored = [
      {
        id: 'qa-1',
        question: 'where can I buy a phone',
        answer: 'Mentor answer for this exact question.',
        source: 'qa-edit',
      },
    ];
    const result = classifyQuestion('where can I buy a phone', mentored);
    expect(result.kind).toBe('trading');
    expect(result.entry?.answer).toBe('Mentor answer for this exact question.');
  });

  it('refuses unrelated questions before they reach the matcher', () => {
    expect(isTradingQuestion('how do I bake a chocolate cake')).toBe(false);
    expect(classifyQuestion('how do I bake a chocolate cake').kind).toBe('out-of-scope');
    expect(classifyQuestion('who is the prime minister of india').kind).toBe('out-of-scope');
    expect(classifyQuestion("what's the weather today").kind).toBe('out-of-scope');
  });

  it('answers app help with the real UI path instead of guessing a topic', () => {
    const passkey = classifyQuestion('where can I get the zoom recording passkey');
    expect(passkey.kind).toBe('app-help');
    expect(passkey.entry.id).toBe('recording-passcode');
    expect(passkey.entry.answer).toMatch(/Cloud Recordings/);
    expect(passkey.entry.answer).toMatch(/Recording passcode/i);

    expect(classifyQuestion('where are the recordings')?.entry?.id).toBe('recordings-location');
    expect(classifyQuestion('how do I join my class')?.entry?.id).toBe('class-join-link');
    expect(classifyQuestion('what time is the class tomorrow')?.entry?.id).toBe('class-schedule');
    expect(findAppHelp('hello')?.id).toBe('greeting');
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
