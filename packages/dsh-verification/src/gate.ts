import type { GateResult, TaskContract, Verdict } from '@bpc-oss/dsh-evidence';

import type { ConstraintResult } from './constraints';

/**
 * 完成闸门：任务不得显示"完成"，除非每条验收标准都有 pass 裁决、
 * 每条禁令后置校验通过、任何 need_human 项都已获人类确认。
 * 移植自 Bobby `conscience/gate.ts`。
 */
export class CompletionGate {
  evaluate(contract: TaskContract, verdicts: Map<string, Verdict>, constraints: ConstraintResult[]): GateResult {
    const reasons: string[] = [];
    let failed = false;
    let blocked = false;

    for (const ac of contract.acceptanceCriteria) {
      const verdict = verdicts.get(ac.id);
      if (!verdict) {
        failed = true;
        reasons.push(`Missing verdict for AC ${ac.id}`);
        continue;
      }

      if (verdict.result === 'fail') {
        failed = true;
        reasons.push(`AC ${ac.id} failed: ${verdict.detail ?? 'no details provided'}`);
      } else if (verdict.result === 'need_human') {
        blocked = true;
        reasons.push(`AC ${ac.id} needs human confirmation`);
      }
    }

    for (const constraint of constraints) {
      if (constraint.result === 'fail') {
        failed = true;
        reasons.push(`Constraint ${constraint.id} failed: ${constraint.detail ?? 'no details provided'}`);
      } else if (constraint.result === 'need_human') {
        blocked = true;
        reasons.push(`Constraint ${constraint.id} needs human confirmation`);
      }
    }

    return {
      status: failed ? 'failed' : blocked ? 'blocked' : 'done',
      reasons
    };
  }
}
