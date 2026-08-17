import { describe, expect, it } from 'vitest';

import { formatTestFailureContext, parseTestOutput } from '../src/test-output';

describe('parseTestOutput', () => {
  it('parses a passing vitest summary', () => {
    const parsed = parseTestOutput(`
      Test Files  3 passed (3)
      Tests  12 passed (12)
    `);
    expect(parsed.passCount).toBe(12);
    expect(parsed.failCount).toBe(0);
    expect(parsed.failures).toEqual([]);
  });

  it('parses a failing vitest run with failure details', () => {
    const output = `
      FAIL tests/foo.test.ts > does the thing
        AssertionError: expected 1 to equal 2
         at /repo/tests/foo.test.ts:12:20
      Test Files  1 failed (1)
      Tests  1 failed (3)
    `;
    const parsed = parseTestOutput(output);
    expect(parsed.failCount).toBeGreaterThan(0);
    expect(parsed.failures.length).toBeGreaterThan(0);
    const failure = parsed.failures[0]!;
    expect(failure.file).toBe('tests/foo.test.ts');
    expect(failure.title).toContain('does the thing');
    expect(parsed.files).toContain('tests/foo.test.ts');
  });

  it('parses TAP-style not ok lines', () => {
    const parsed = parseTestOutput(`
      ok 1 - first
      not ok 2 - second fails
      # pass 5
      # fail 1
    `);
    expect(parsed.failCount).toBe(1);
    expect(parsed.failures.length).toBe(1);
    expect(parsed.failures[0]!.title).toContain('second fails');
  });

  it('parses FAIL header lines', () => {
    const parsed = parseTestOutput(`
      FAIL tests/bar.test.ts > broken case
      Error: boom
      Test Files 1 failed (1)
    `);
    expect(parsed.failures.length).toBeGreaterThan(0);
    expect(parsed.failures[0]!.file).toContain('tests/bar.test.ts');
    expect(parsed.failures[0]!.message).toContain('boom');
  });

  it('strips ANSI escapes', () => {
    const parsed = parseTestOutput('\u001b[31mFAIL tests/a.test.ts > x\u001b[0m\nTests  1 failed (1)');
    expect(parsed.failures[0]!.title).toContain('x');
  });
});

describe('formatTestFailureContext', () => {
  it('renders a compact pass/fail summary when nothing failed', () => {
    const text = formatTestFailureContext({ passCount: 4, failCount: 0, failures: [], files: [], errorMessages: [] });
    expect(text).toContain('pass=4');
    expect(text).toContain('fail=0');
  });

  it('renders failure lines when failures exist', () => {
    const text = formatTestFailureContext({
      passCount: 1,
      failCount: 2,
      failures: [
        { title: 'broken', file: 'tests/a.test.ts', message: 'boom' },
        { title: 'also broken', file: 'tests/b.test.ts', message: '' }
      ],
      files: ['tests/a.test.ts'],
      errorMessages: ['boom']
    });
    expect(text).toContain('tests/a.test.ts :: broken — boom');
    expect(text).toContain('tests/b.test.ts :: also broken');
  });
});
