import { describe, expect, it } from 'vitest';

import { deriveCaptured, extractTextFromContent, type ToolRecord } from '../src/derive';
import type { ContractIdentity } from '../src/evidence';

const identity: ContractIdentity = {
  contractId: 'c-1',
  revision: 0,
  contractContentHash: 'aaa',
  basisHash: 'bbb',
  sessionId: 's-1'
};

function record(partial: Partial<ToolRecord> & { name: string; callId?: string }): ToolRecord {
  return {
    callId: partial.callId ?? 'call-1',
    arguments: partial.arguments ?? {},
    isError: partial.isError ?? false,
    ...partial
  };
}

describe('deriveCaptured (v9: unbound, no acId)', () => {
  it('derives command_output carrying contractIdentity and NO acId', () => {
    const captured = deriveCaptured(
      record({
        name: 'bash',
        arguments: { command: 'node build.js' },
        value: { exitCode: 0, stdout: 'ok' }
      }),
      { contractIdentity: identity }
    );
    expect(captured).not.toBeNull();
    expect(captured!.evidenceType).toBe('command_output');
    expect(captured!.payload.exitCode).toBe(0);
    expect('acId' in captured!).toBe(false);
    expect('selectorRef' in captured!).toBe(false);
    expect(captured!.contractIdentity).toEqual(identity);
    expect(captured!.normalizedArgsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('marks failed calls with failed: true and exitCode 1', () => {
    const captured = deriveCaptured(
      record({ name: 'bash', arguments: { command: 'exit 1' }, isError: true }),
      { contractIdentity: identity }
    );
    expect(captured!.failed).toBe(true);
    expect(captured!.payload.exitCode).toBe(1);
  });

  it('prefers test_run for test-like commands', () => {
    const captured = deriveCaptured(
      record({
        name: 'bash',
        arguments: { command: 'vitest run' },
        value: { exitCode: 1, stdout: 'Test Files 1 failed (1)\nTests  2 failed (3)' }
      }),
      { contractIdentity: identity }
    );
    expect(captured!.evidenceType).toBe('test_run');
    expect(captured!.payload.failCount).toBeGreaterThan(0);
  });

  it('derives file_diff from a write tool', () => {
    const captured = deriveCaptured(
      record({ name: 'write_file', arguments: { path: 'src/a.ts' }, value: { bytes: 42 } }),
      { contractIdentity: identity }
    );
    expect(captured!.evidenceType).toBe('file_diff');
    expect(captured!.payload.path).toBe('src/a.ts');
  });

  it('derives file_exists from an exists/stat tool', () => {
    const captured = deriveCaptured(
      record({ name: 'file_exists', arguments: { path: 'out/build.zip' }, value: { exists: true } }),
      { contractIdentity: identity }
    );
    expect(captured!.evidenceType).toBe('file_exists');
    expect(captured!.payload.exists).toBe(true);
  });

  it('derives quote_with_location from a read tool', () => {
    const captured = deriveCaptured(
      record({ name: 'read_file', arguments: { path: 'src/a.ts' }, content: [{ type: 'text', text: 'export const x = 1;' }] }),
      { contractIdentity: identity }
    );
    expect(captured!.evidenceType).toBe('quote_with_location');
    expect(captured!.payload.path).toBe('src/a.ts');
  });

  it('S1-2 真机修复: read with file_path arg keeps path and prefers clean value text', () => {
    const captured = deriveCaptured(
      record({
        name: 'read',
        arguments: { file_path: 'artifact.txt' },
        value: { path: 'artifact.txt', text: 'DONE' },
        content: [{ type: 'text', text: '<path>artifact.txt</path>\n<content>\n1: DONE\n</content>' }]
      }),
      { contractIdentity: identity }
    );
    expect(captured!.evidenceType).toBe('quote_with_location');
    expect(captured!.payload.path).toBe('artifact.txt');
    expect(captured!.payload.quote).toBe('DONE');
  });

  it('returns null for uncapturable tools (not in capture list)', () => {
    const captured = deriveCaptured(record({ name: 'ask_user_question' }), { contractIdentity: identity });
    expect(captured).toBeNull();
  });

  it('S3: control-plane tools (update_goal / verification tools) produce no evidence', () => {
    expect(deriveCaptured(record({ name: 'update_goal', arguments: { action: 'complete' } }), { contractIdentity: identity })).toBeNull();
    expect(deriveCaptured(record({ name: 'set_verification_plan', arguments: {} }), { contractIdentity: identity })).toBeNull();
    expect(deriveCaptured(record({ name: 'get_verification_plan', arguments: {} }), { contractIdentity: identity })).toBeNull();
    expect(deriveCaptured(record({ name: 'pro_review', arguments: {} }), { contractIdentity: identity })).toBeNull();
    expect(deriveCaptured(record({ name: 'create_goal', arguments: {} }), { contractIdentity: identity })).toBeNull();
  });

  it('normalizes args with default-expandable shape (path lexical)', () => {
    const captured = deriveCaptured(
      record({ name: 'write_file', arguments: { path: './src/../src/a.ts' } }),
      { contractIdentity: identity }
    );
    expect(captured!.normalizedArgs.path).toBe('src/a.ts');
  });

  it('exposes real write canonical content via `after` so file_diff is exactly checkable (v9.1)', () => {
    const captured = deriveCaptured(
      record({
        name: 'write',
        arguments: { path: 'artifact.txt', content: 'DONE\n' },
        value: { path: 'artifact.txt', operation: 'write', after: 'DONE\n', before: '' }
      }),
      { contractIdentity: identity }
    );
    expect(captured!.evidenceType).toBe('file_diff');
    expect(captured!.payload.content).toBe('DONE\n');
    expect('bytes' in captured!.payload).toBe(false);
  });
});

describe('extractTextFromContent', () => {
  it('extracts text from ContentBlock arrays', () => {
    const text = extractTextFromContent([
      { type: 'text', text: 'hello ' },
      { type: 'text', text: 'world' }
    ]);
    expect(text).toBe('hello\nworld');
  });

  it('passes strings through', () => {
    expect(extractTextFromContent('plain')).toBe('plain');
  });
});
