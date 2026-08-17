import { z } from 'zod';
import type { AcceptanceCriterion, Evidence } from '@bpc-oss/dsh-evidence';

import type { Oracle, VerdictBody } from '../oracle';

type TestRunPayload = {
  exitCode?: unknown;
  failCount?: unknown;
  passCount?: unknown;
  output?: unknown;
};

/** T0 裁判：真实测试运行（test_run 证据：退出码 0 且 failCount === 0）。 */
export class TestRunOracle implements Oracle {
  readonly tier = 'T0' as const;
  readonly name = 'test-run';

  canJudge(ac: AcceptanceCriterion, evidence: Evidence[]): boolean {
    return evidence.some((entry) => entry.evidenceType === 'test_run');
  }

  async judge(ac: AcceptanceCriterion, evidence: Evidence[]): Promise<VerdictBody> {
    const testEvidences = evidence.filter((entry) => entry.evidenceType === 'test_run');
    const firstBad = testEvidences.find((entry) => {
      const payload = (entry.payload ?? {}) as TestRunPayload;
      if (payload.exitCode !== 0) {
        return true;
      }
      return typeof payload.failCount === 'number' && payload.failCount > 0;
    });
    const pass = testEvidences.length > 0 && firstBad === undefined;

    return {
      claimId: testEvidences[0]?.callId ?? ac.id,
      acId: ac.id,
      oracleTier: 'T0',
      result: pass ? 'pass' : 'fail',
      detail: pass
        ? undefined
        : `test run indicates failure: ${JSON.stringify(firstBad?.payload ?? {})}`
    };
  }
}

type SchemaValidPayload = {
  valid?: unknown;
};

/** T0 裁判：schema 校验证据（schema_valid）。 */
export class SchemaValidOracle implements Oracle {
  readonly tier = 'T0' as const;
  readonly name = 'schema-valid';

  canJudge(ac: AcceptanceCriterion, evidence: Evidence[]): boolean {
    return evidence.some((entry) => entry.evidenceType === 'schema_valid');
  }

  async judge(ac: AcceptanceCriterion, evidence: Evidence[]): Promise<VerdictBody> {
    const schemaEvidences = evidence.filter((entry) => entry.evidenceType === 'schema_valid');
    const firstBad = schemaEvidences.find((entry) => {
      const payload = (entry.payload ?? {}) as SchemaValidPayload;
      return payload.valid !== true;
    });
    const pass = schemaEvidences.length > 0 && firstBad === undefined;

    return {
      claimId: schemaEvidences[0]?.callId ?? ac.id,
      acId: ac.id,
      oracleTier: 'T0',
      result: pass ? 'pass' : 'fail',
      detail: pass ? undefined : `schema validation failed: ${JSON.stringify(firstBad?.payload ?? {})}`
    };
  }
}

/** T3 留痕裁判：file 类 AC 至少存在一条文件证据（反偷懒：逐项处理必须留痕）。 */
export class CoverageOracle implements Oracle {
  readonly tier = 'T3' as const;
  readonly name = 'coverage';

  canJudge(ac: AcceptanceCriterion, evidence: Evidence[]): boolean {
    return (
      ac.oracleHint === 'file' &&
      evidence.some((entry) => entry.evidenceType === 'file_diff' || entry.evidenceType === 'file_exists')
    );
  }

  async judge(ac: AcceptanceCriterion, evidence: Evidence[]): Promise<VerdictBody> {
    const fileEvidences = evidence.filter(
      (entry) => entry.evidenceType === 'file_diff' || entry.evidenceType === 'file_exists'
    );
    const pass = fileEvidences.length > 0;

    return {
      claimId: fileEvidences[0]?.callId ?? ac.id,
      acId: ac.id,
      oracleTier: 'T3',
      result: pass ? 'pass' : 'fail',
      detail: pass ? undefined : 'no file evidence recorded for this acceptance criterion'
    };
  }
}
