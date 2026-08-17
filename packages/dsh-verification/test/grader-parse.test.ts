import { describe, expect, it } from 'vitest';

import { extractJsonCandidates, GraderParseError, graderCandidateContent, parseGraderJson } from '../src/grader-parse';

describe('parseGraderJson (S1-2 robust grader parsing)', () => {
  it('parses clean JSON', () => {
    expect(parseGraderJson('{"goal":"x"}')).toEqual({ goal: 'x' });
  });

  it('tolerates markdown fences around JSON', () => {
    expect(parseGraderJson('```json\n{"goal":"x"}\n```')).toEqual({ goal: 'x' });
  });

  it('tolerates prose before/after the JSON object', () => {
    expect(parseGraderJson('Here it is:\n{"goal":"x","acceptanceCriteria":[]} — done.')).toEqual({ goal: 'x', acceptanceCriteria: [] });
  });

  it('throws GraderParseError with a sample on non-JSON text', () => {
    expect(() => parseGraderJson('just natural language')).toThrowError(GraderParseError);
  });

  it('throws GraderParseError on empty input', () => {
    expect(() => parseGraderJson('   ')).toThrowError(GraderParseError);
  });

  it('prefers text over reasoning; falls back to reasoning when text is empty', () => {
    const sources = graderCandidateContent('', '{"goal":"y"}');
    expect(sources[0]?.label).toBe('reasoning');
    expect(parseGraderJson(sources[0]!.text)).toEqual({ goal: 'y' });
  });
});

describe('extractJsonCandidates (multi-draft tolerant)', () => {
  it('recovers the valid object when earlier drafts/prose precede it', () => {
    const raw = 'draft1: {"a":1}\nfinal: {"goal":"z","acceptanceCriteria":[{"id":"A","desc":"d","oracleHint":"test"}]} tail';
    const candidates = extractJsonCandidates(raw);
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates.some((c) => JSON.stringify(c) === JSON.stringify({ a: 1 }))).toBe(true);
    expect(((candidates as Array<Record<string, unknown>>).find((c) => (c as Record<string, unknown>).goal === 'z'))).toBeDefined();
  });

  it('skips malformed brace soup without crash (fails closed, no false candidate)', () => {
    const raw = 'garbage { { "a": 1 } } trailing';
    const candidates = extractJsonCandidates(raw);
    // 整块 `{ { "a": 1 } }` 不是合法 JSON；提取器返回空（不崩溃），由 schema 验证层判 all_invalid
    expect(candidates).toHaveLength(0);
  });
});
