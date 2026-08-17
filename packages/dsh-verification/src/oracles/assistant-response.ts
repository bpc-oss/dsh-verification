import type { AcceptanceCriterion, Evidence } from '@bpc-oss/dsh-evidence';

import type { Oracle, VerdictBody } from '../oracle';

type AssistantResponsePayload = {
  text?: unknown;
};

/** T3 留痕裁判：逐项核对场景的兜底——助手确有针对该 AC 的真实回应文本（移植）。 */
export class AssistantResponseOracle implements Oracle {
  readonly tier = 'T3' as const;
  readonly name = 'assistant-response';

  canJudge(ac: AcceptanceCriterion, evidence: Evidence[]): boolean {
    return ac.oracleHint === 'review' && evidence.some((entry) => entry.evidenceType === 'assistant_response');
  }

  async judge(ac: AcceptanceCriterion, evidence: Evidence[]): Promise<VerdictBody> {
    const responseEvidence = evidence.find((entry) => entry.evidenceType === 'assistant_response');
    const payload = (responseEvidence?.payload ?? {}) as AssistantResponsePayload;
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    const pass = text.length > 0;

    return {
      claimId: responseEvidence?.callId ?? ac.id,
      acId: ac.id,
      oracleTier: 'T3',
      result: pass ? 'pass' : 'fail',
      detail: pass ? undefined : 'assistant response evidence is empty'
    };
  }
}
