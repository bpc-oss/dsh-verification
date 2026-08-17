import type { Constraint } from '@bpc-oss/dsh-evidence';

export interface ExecContext {
  touchedPaths: string[];
  networkCalls?: string[];
}

export interface ConstraintResult {
  id: string;
  result: 'pass' | 'fail' | 'need_human';
  detail?: string;
}

export interface ConstraintChecker {
  matches(c: Constraint): boolean;
  check(c: Constraint, ctx: ExecContext): ConstraintResult;
}

/** 当前支持的机器可检禁令语法：`path:<forbidden-prefix>`（移植）与 `network:`（扩展）。 */
export function isMachineCheckableConstraintCheck(check: string): boolean {
  return check.startsWith('path:') || check.startsWith('network:');
}

export class NoForbiddenPathChecker implements ConstraintChecker {
  matches(c: Constraint): boolean {
    return c.check.startsWith('path:');
  }

  check(c: Constraint, ctx: ExecContext): ConstraintResult {
    const prefix = c.check.slice('path:'.length);
    const hit = ctx.touchedPaths.find((path) => path.startsWith(prefix));
    return hit
      ? { id: c.id, result: 'fail', detail: `Forbidden path touched: ${hit}` }
      : { id: c.id, result: 'pass' };
  }
}

export class NoNetworkChecker implements ConstraintChecker {
  matches(c: Constraint): boolean {
    return c.check.startsWith('network:');
  }

  check(c: Constraint, ctx: ExecContext): ConstraintResult {
    const calls = ctx.networkCalls ?? [];
    return calls.length > 0
      ? { id: c.id, result: 'fail', detail: `Network calls detected: ${calls.join(', ')}` }
      : { id: c.id, result: 'pass' };
  }
}

export function enforceConstraints(
  constraints: Constraint[],
  ctx: ExecContext,
  checkers: ConstraintChecker[]
): ConstraintResult[] {
  return constraints.map((constraint) => {
    const checker = checkers.find((c) => c.matches(constraint));
    if (!checker) {
      return { id: constraint.id, result: 'need_human', detail: `No machine checker for constraint: ${constraint.check}` };
    }
    return checker.check(constraint, ctx);
  });
}

export const DEFAULT_CHECKERS: ConstraintChecker[] = [new NoForbiddenPathChecker(), new NoNetworkChecker()];
