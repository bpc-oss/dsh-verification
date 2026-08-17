import { describe, expect, it } from 'vitest';
import type { StreamChunk } from '@deepseek-ai/dsh-llm';

import { assembleStream } from '../src/llm/call';

describe('assembleStream', () => {
  it('folds text deltas in order', () => {
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '{"verdict":' },
      { type: 'text-delta', index: 0, text: '"pass"}' },
      { type: 'block-end', index: 0, block: { type: 'text', text: '{"verdict":"pass"}' } },
      { type: 'finish', reason: 'stop' }
    ];
    const { text } = assembleStream(chunks);
    expect(text).toBe('{"verdict":"pass"}');
  });

  it('collects reasoning deltas separately', () => {
    const chunks: StreamChunk[] = [
      { type: 'reasoning-delta', index: 0, text: 'think' },
      { type: 'text-delta', index: 0, text: 'answer' },
      { type: 'finish', reason: 'stop' }
    ];
    const { text, reasoning } = assembleStream(chunks);
    expect(text).toBe('answer');
    expect(reasoning).toBe('think');
  });
});
