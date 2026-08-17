import { describe, expect, it } from 'vitest';
import type { Constraint } from '@bpc-oss/dsh-evidence';

import { DEFAULT_CHECKERS, enforceConstraints, isMachineCheckableConstraintCheck } from '../src/constraints';

describe('constraints', () => {
  it('detects machine-checkable syntax', () => {
    expect(isMachineCheckableConstraintCheck('path:src/legacy')).toBe(true);
    expect(isMachineCheckableConstraintCheck('network:')).toBe(true);
    expect(isMachineCheckableConstraintCheck('do not touch legacy')).toBe(false);
  });

  it('fails when a forbidden path was touched', () => {
    const constraint: Constraint = { id: 'C1', desc: 'no legacy', check: 'path:src/legacy' };
    const results = enforceConstraints([constraint], { touchedPaths: ['src/legacy/util.ts'] }, DEFAULT_CHECKERS);
    expect(results[0]!.result).toBe('fail');
    expect(results[0]!.detail).toContain('src/legacy');
  });

  it('passes when the forbidden path was not touched', () => {
    const constraint: Constraint = { id: 'C1', desc: 'no legacy', check: 'path:src/legacy' };
    const results = enforceConstraints([constraint], { touchedPaths: ['src/main.ts'] }, DEFAULT_CHECKERS);
    expect(results[0]!.result).toBe('pass');
  });

  it('fails when network calls happened under network: constraint', () => {
    const constraint: Constraint = { id: 'C1', desc: 'no network', check: 'network:' };
    const results = enforceConstraints([constraint], { touchedPaths: [], networkCalls: ['https://x.dev'] }, DEFAULT_CHECKERS);
    expect(results[0]!.result).toBe('fail');
  });

  it('needs human for unsupported check syntax', () => {
    const constraint: Constraint = { id: 'C1', desc: 'be careful', check: 'be careful' };
    const results = enforceConstraints([constraint], { touchedPaths: [] }, DEFAULT_CHECKERS);
    expect(results[0]!.result).toBe('need_human');
  });
});
