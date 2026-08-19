import { describe, expect, it } from 'vitest';
import type { AcceptanceCriterion, ContractIdentity, Evidence } from '@bpc-oss/dsh-evidence';

import { FileDiffOracle, CommandExitOracle } from '../src/oracles/deterministic';

const identity: ContractIdentity = { contractId: 'c-1', revision: 0, contractContentHash: 'cc', basisHash: 'bb', sessionId: 's-1' };

function evidence(evidenceType: Evidence['evidenceType'], payload: Record<string, unknown>): Evidence {
  return {
    callId: 'call-1',
    toolIdentity: 'write',
    schemaVersion: 1,
    normalizedArgs: {},
    normalizedArgsHash: 'h',
    evidenceType,
    payload,
    producedBy: 'tool',
    failed: false,
    contractIdentity: identity,
    acId: 'AC1',
    selectorRef: 'c-1:0:AC1'
  };
}

const ac = {
  id: 'AC1',
  desc: 'artifact.txt contains exactly DONE',
  oracleHint: 'file'
} as AcceptanceCriterion;

describe('FileDiffOracle (v9.1 real-runtime shapes)', () => {
  it('accepts a real write canonical value (no bytes) when it carries content', async () => {
    const oracle = new FileDiffOracle();
    const list = [evidence('file_diff', { path: 'artifact.txt', content: 'DONE', diff: '2c1\n< \n---\n> DONE\n' })];
    expect(oracle.canJudge(ac, list)).toBe(true);
    const verdict = await oracle.judge(ac, list);
    expect(verdict.result).toBe('pass');
  });

  it('accepts a payload with only a path + diff when desc does not demand exact text (mutation proved by artifact)', async () => {
    const oracle = new FileDiffOracle();
    const looseAc = { id: 'AC1', desc: 'artifact.txt changed vs baseline', oracleHint: 'file' } as AcceptanceCriterion;
    const verdict = await oracle.judge(looseAc, [evidence('file_diff', { path: 'artifact.txt', diff: '1c1\n< old\n---\n> DONE\n' })]);
    expect(verdict.result).toBe('pass');
  });

  it('still fails exact-text demand (no content to compare) even with diff proof', async () => {
    const oracle = new FileDiffOracle();
    const verdict = await oracle.judge(ac, [evidence('file_diff', { path: 'artifact.txt', diff: '1c1\n< old\n---\n> DONE\n' })]);
    expect(verdict.result).toBe('fail');
  });

  it('rejects a payload with no path', async () => {
    const oracle = new FileDiffOracle();
    const verdict = await oracle.judge(ac, [evidence('file_diff', { content: 'DONE' })]);
    expect(verdict.result).toBe('fail');
  });

  it('rejects a payload with no substance (no bytes/diff/content) even with a path', async () => {
    const oracle = new FileDiffOracle();
    const verdict = await oracle.judge(ac, [evidence('file_diff', { path: 'artifact.txt' })]);
    expect(verdict.result).toBe('fail');
  });

  it('judges a read quote (quote_with_location) as valid file evidence', async () => {
    const oracle = new FileDiffOracle();
    const list = [evidence('quote_with_location', { path: 'artifact.txt', quote: 'DONE' })];
    expect(oracle.canJudge(ac, list)).toBe(true);
    const verdict = await oracle.judge(ac, list);
    expect(verdict.result).toBe('pass');
  });

  it('fails exact-text mismatch when desc demands an exact text and content is available', async () => {
    const oracle = new FileDiffOracle();
    const strictAc = { id: 'AC1', desc: 'artifact.txt must contain exactly NOPE', oracleHint: 'file' } as AcceptanceCriterion;
    const verdict = await oracle.judge(strictAc, [evidence('file_diff', { path: 'artifact.txt', content: 'DONE' })]);
    expect(verdict.result).toBe('fail');
  });

  it('S2-1: "contains the word X" demands the content actually contains X (positive)', async () => {
    const oracle = new FileDiffOracle();
    const containsAc = { id: 'AC1', desc: 'artifact.txt contains the word DONE', oracleHint: 'file' } as AcceptanceCriterion;
    const verdict = await oracle.judge(containsAc, [evidence('file_diff', { path: 'artifact.txt', content: 'prefix DONE suffix' })]);
    expect(verdict.result).toBe('pass');
  });

  it('S2-1: "contains the word X" FAILS when the file content lacks X (no loose pass on any content)', async () => {
    const oracle = new FileDiffOracle();
    const containsAc = { id: 'AC1', desc: 'artifact.txt contains the word DONE', oracleHint: 'file' } as AcceptanceCriterion;
    const verdict = await oracle.judge(containsAc, [evidence('file_diff', { path: 'artifact.txt', content: 'completely unrelated' })]);
    expect(verdict.result).toBe('fail');
  });

  it('S2-1: "contains the word X" via read quote (quote_with_location) still checked', async () => {
    const oracle = new FileDiffOracle();
    const containsAc = { id: 'AC1', desc: 'artifact.txt contains the word DONE', oracleHint: 'file' } as AcceptanceCriterion;
    const verdict = await oracle.judge(containsAc, [evidence('quote_with_location', { path: 'artifact.txt', quote: 'line 1 = NOPE' })]);
    expect(verdict.result).toBe('fail');
  });

  it('S3-2: quoted multi-word phrase is enforced (positive)', async () => {
    const oracle = new FileDiffOracle();
    const phrase = { id: 'AC1', desc: 'report contains "hello world"', oracleHint: 'file' } as AcceptanceCriterion;
    const verdict = await oracle.judge(phrase, [evidence('file_diff', { path: 'report.txt', content: 'say hello world now' })]);
    expect(verdict.result).toBe('pass');
  });

  it('S3-2: quoted multi-word phrase is enforced (negative)', async () => {
    const oracle = new FileDiffOracle();
    const phrase = { id: 'AC1', desc: 'report contains the text "hello world"', oracleHint: 'file' } as AcceptanceCriterion;
    const verdict = await oracle.judge(phrase, [evidence('file_diff', { path: 'report.txt', content: 'only goodbye' })]);
    expect(verdict.result).toBe('fail');
  });

  it('canJudge is true for command_output file-proxy evidence (v9.4: pwsh Set-Content/Test-Path)', () => {
    const oracle = new FileDiffOracle();
    expect(oracle.canJudge(ac, [evidence('command_output', { exitCode: 0, stdout: 'DONE' })])).toBe(true);
  });

  it('a failed run (error payload) with no substance fails', async () => {
    const oracle = new FileDiffOracle();
    const verdict = await oracle.judge(ac, [evidence('file_diff', { path: 'missing.txt', error: true })]);
    expect(verdict.result).toBe('fail');
  });
});

describe('CommandExitOracle sanity (unchanged contract)', () => {
  it('still requires numeric exitCode 0', async () => {
    const oracle = new CommandExitOracle();
    const verdict = await oracle.judge(ac, [evidence('command_output', { exitCode: 1, stdout: 'DONE' })]);
    expect(verdict.result).toBe('fail');
  });
});
