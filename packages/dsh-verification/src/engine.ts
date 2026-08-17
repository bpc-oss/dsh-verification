import type { AcceptanceCriterion, ContractIdentity, Evidence, Verdict } from '@bpc-oss/dsh-evidence';

import type { Oracle } from './oracle';
import { stampVerdict, tierRank } from './oracle';

/**
 * 验证引擎（v9）：只接受 bound evidence（acId 精确匹配）；
 * 按裁判硬度从硬到软选择，并把 contractIdentity 统一盖章进裁决。
 */
export class VerificationEngine {
  constructor(private readonly oracles: Oracle[]) {}

  async verify(ac: AcceptanceCriterion, evidence: Evidence[], contractIdentity: ContractIdentity): Promise<Verdict> {
    const boundEvidence = evidence.filter((entry) => entry.acId === ac.id);
    const usableOracles = this.oracles
      .filter((oracle) => oracle.canJudge(ac, boundEvidence))
      .sort((a, b) => tierRank(a.tier) - tierRank(b.tier));

    if (usableOracles.length === 0) {
      throw new Error(`no oracle can judge AC ${ac.id}`);
    }

    return stampVerdict(await usableOracles[0]!.judge(ac, boundEvidence), contractIdentity);
  }
}
