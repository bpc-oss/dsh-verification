import { describe, expect, it } from 'vitest';

import { runStructuredConsensus } from '../src/intent-consensus';

describe('runStructuredConsensus', () => {
  it('picks the majority candidate', async () => {
    const result = await runStructuredConsensus({
      consensusCount: 3,
      generate: async () => ({ content: JSON.stringify({ a: 1, b: 'x' }) }),
      parse: (content) => JSON.parse(content) as { a: number; b: string }
    });
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.value).toEqual({ a: 1, b: 'x' });
    }
  });

  it('treats canonically-equal JSON as one candidate', async () => {
    const contents = [
      JSON.stringify({ a: 1, b: 'x' }),
      JSON.stringify({ b: 'x', a: 1 }), // 键序不同，规范化后相同
      JSON.stringify({ a: 1, b: 'x' })
    ];
    const result = await runStructuredConsensus({
      consensusCount: 3,
      generate: async () => ({ content: contents.shift()! }),
      parse: (content) => JSON.parse(content) as { a: number; b: string }
    });
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.value).toEqual({ a: 1, b: 'x' });
    }
  });

  it('returns all_invalid when every generation fails to parse', async () => {
    const result = await runStructuredConsensus({
      consensusCount: 2,
      generate: async () => ({ content: 'not json' }),
      parse: (content) => {
        throw new Error(`bad: ${content}`);
      }
    });
    expect(result.kind).toBe('all_invalid');
    if (result.kind === 'all_invalid') {
      expect(result.error.message).toContain('bad');
    }
  });

  it('skips invalid generations when at least one parses', async () => {
    let call = 0;
    const result = await runStructuredConsensus({
      consensusCount: 3,
      generate: async () => {
        call += 1;
        return { content: call === 2 ? 'broken' : JSON.stringify({ ok: true }) };
      },
      parse: (content) => JSON.parse(content) as { ok: boolean }
    });
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.value).toEqual({ ok: true });
    }
  });

  it('keeps reasoning content of the winner', async () => {
    const result = await runStructuredConsensus({
      consensusCount: 2,
      generate: async () => ({ content: '{"v":1}', reasoningContent: 'think hard' }),
      parse: (content) => JSON.parse(content) as { v: number }
    });
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.reasoningContent).toBe('think hard');
    }
  });
});
