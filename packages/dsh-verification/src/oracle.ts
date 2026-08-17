import type { AcceptanceCriterion, ContractIdentity, Evidence, OracleTier, Verdict } from '@bpc-oss/dsh-evidence';

/** 裁判原始裁决（无 contractIdentity；engine 统一盖章）。 */
export type VerdictBody = Omit<Verdict, 'contractIdentity'>;

/** 裁判接口：对一条 AC + bound evidence 给出裁决（Bobby 移植）。 */
export interface Oracle {
  readonly tier: OracleTier;
  readonly name: string;

  canJudge(ac: AcceptanceCriterion, evidence: Evidence[]): boolean;
  judge(ac: AcceptanceCriterion, evidence: Evidence[]): Promise<VerdictBody>;
}

const ORDER: OracleTier[] = ['T0', 'T1', 'T2', 'T3', 'T4'];

export function tierRank(tier: OracleTier): number {
  return ORDER.indexOf(tier);
}

export function stampVerdict(body: VerdictBody, identity: ContractIdentity): Verdict {
  return { ...body, contractIdentity: identity };
}
