import type { Constraint, TaskContract } from '@bpc-oss/dsh-evidence';

/** 全局禁令库：把部署级禁令合入每个意图契约（Bobby `config/constraints-library.ts` 移植）。 */
export class ConstraintsLibrary {
  constructor(private readonly global: Constraint[]) {}

  applyTo(contract: TaskContract): TaskContract {
    return {
      ...contract,
      constraints: [...this.global, ...contract.constraints]
    };
  }
}
