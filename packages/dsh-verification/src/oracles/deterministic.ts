import type { AcceptanceCriterion, Evidence } from '@bpc-oss/dsh-evidence';

import type { Oracle, VerdictBody } from '../oracle';

type CommandOutputPayload = {
  exitCode?: unknown;
  stdout?: unknown;
};

type FileExistsPayload = {
  exists?: unknown;
};

type FileDiffPayload = {
  path?: unknown;
  bytes?: unknown;
  diff?: unknown;
  content?: unknown;
  quote?: unknown;
};

/** 从 file 证据 payload 提取可判读的实质内容（content / quote），无则 undefined。 */
function contentOf(payload: FileDiffPayload): string | undefined {
  if (typeof payload.content === 'string' && payload.content.length > 0) {
    return payload.content;
  }
  if (typeof payload.quote === 'string' && payload.quote.length > 0) {
    return payload.quote;
  }
  return undefined;
}

function extractExactText(desc: string): string | undefined {
  const quoted = desc.match(/exactly\s+(?:the\s+(?:text|string)\s+)?['"`]([^'"`]+)['"`]/i);
  if (quoted?.[1] !== undefined) {
    return quoted[1];
  }

  const bare = desc.match(/exactly\s+([A-Za-z0-9._-]+)(?=[\s).,;:]|$)/i);
  return bare?.[1];
}

/** S2-1 收紧：从 desc 提取 "contains/include(s) <text>" 的必需子串（无 exact 约束时的次强约束）。
 *  S3-2：支持带引号的多词短语（"contains 'hello world'"）；无引号退化为单词字符序列。 */
function extractContainsText(desc: string): string | undefined {
  const quoted = desc.match(/(?:contain(?:s|ing)?|include(?:s|ing)?)\s+(?:the\s+(?:word|text|string)\s+)?(["'`])([^"'`]+)\1/i);
  if (quoted?.[2] !== undefined && quoted[2].length > 0) {
    return quoted[2];
  }
  const bare = desc.match(/(?:contain(?:s|ing)?|include(?:s|ing)?)\s+(?:the\s+(?:word|text|string)\s+)?([A-Za-z0-9._-]*)/i);
  if (bare?.[1] !== undefined && bare[1].length > 0) {
    return bare[1];
  }
  return undefined;
}

function exactStdoutFailure(payload: CommandOutputPayload, expected: string | undefined): boolean {
  if (expected === undefined) {
    return false;
  }

  return payload.stdout !== expected;
}

/** T0 确定性裁判：命令真实退出码/输出（移植自 Bobby `oracles/deterministic.ts`）。 */
export class CommandExitOracle implements Oracle {
  readonly tier = 'T0' as const;
  readonly name = 'command-exit';

  canJudge(_ac: AcceptanceCriterion, evidence: Evidence[]): boolean {
    return evidence.some((entry) => entry.evidenceType === 'command_output');
  }

  async judge(ac: AcceptanceCriterion, evidence: Evidence[]): Promise<VerdictBody> {
    const commandEvidences = evidence.filter((entry) => entry.evidenceType === 'command_output');
    const expected = extractExactText(ac.desc);
    const firstBadEvidence = commandEvidences.find((entry) => {
      const payload = (entry.payload ?? {}) as CommandOutputPayload;
      return typeof payload.exitCode !== 'number' || payload.exitCode !== 0 || exactStdoutFailure(payload, expected);
    });
    const pass = commandEvidences.length > 0 && firstBadEvidence === undefined;

    return {
      claimId: commandEvidences[0]?.callId ?? ac.id,
      acId: ac.id,
      oracleTier: 'T0',
      result: pass ? 'pass' : 'fail',
      detail: this.detail(pass, firstBadEvidence, expected)
    };
  }

  private detail(pass: boolean, firstBadEvidence: Evidence | undefined, expected: string | undefined): string | undefined {
    if (pass) {
      return undefined;
    }

    if (expected !== undefined) {
      return `stdout did not match exact expected text ${JSON.stringify(expected)}: ${JSON.stringify(firstBadEvidence?.payload ?? {})}`;
    }

    return `command output indicates non-zero or missing exitCode: ${JSON.stringify(firstBadEvidence?.payload ?? {})}`;
  }
}

/** T0 确定性裁判：文件真实存在性（移植）。 */
export class FileExistsOracle implements Oracle {
  readonly tier = 'T0' as const;
  readonly name = 'file-exists';

  canJudge(_ac: AcceptanceCriterion, evidence: Evidence[]): boolean {
    return evidence.some((entry) => entry.evidenceType === 'file_exists');
  }

  async judge(ac: AcceptanceCriterion, evidence: Evidence[]): Promise<VerdictBody> {
    const fileEvidences = evidence.filter((entry) => entry.evidenceType === 'file_exists');
    const firstBadEvidence = fileEvidences.find((entry) => {
      const payload = (entry.payload ?? {}) as FileExistsPayload;
      return payload.exists !== true;
    });
    const pass = fileEvidences.length > 0 && firstBadEvidence === undefined;

    return {
      claimId: fileEvidences[0]?.callId ?? ac.id,
      acId: ac.id,
      oracleTier: 'T0',
      result: pass ? 'pass' : 'fail',
      detail: pass ? undefined : `file existence check failed: ${JSON.stringify(firstBadEvidence?.payload ?? {})}`
    };
  }
}

/** T0 确定性裁判：文件真实写入/内容（v9.1 真机修复：适配 DSH 工具的真实 payload 形状）。
 *  - file_diff：要求 path 非空，且 (bytes>0 或 diff 非空 或 content/quote 非空) —— 真实 write/edit
 *    canonical value 是 {path, operation, before, after}，不含 bytes；放宽为承载任一实体证据均可。
 *  - quote_with_location：要求 content/quote 非空（read 类工具的自然产出），可全文精确核对。
 */
export class FileDiffOracle implements Oracle {
  readonly tier = 'T0' as const;
  readonly name = 'file-diff';

  canJudge(_ac: AcceptanceCriterion, evidence: Evidence[]): boolean {
    return evidence.some((entry) => entry.evidenceType === 'file_diff' || entry.evidenceType === 'quote_with_location');
  }

  async judge(ac: AcceptanceCriterion, evidence: Evidence[]): Promise<VerdictBody> {
    const fileEvidences = evidence.filter(
      (entry) => entry.evidenceType === 'file_diff' || entry.evidenceType === 'quote_with_location'
    );
    const expected = extractExactText(ac.desc);
    const contains = expected === undefined ? extractContainsText(ac.desc) : undefined;
    const firstBadEvidence = fileEvidences.find((entry) => {
      const payload = (entry.payload ?? {}) as FileDiffPayload;

      if (typeof payload.path !== 'string' || payload.path.trim().length === 0) {
        return true;
      }

      const hasBytes = typeof payload.bytes === 'number' && Number.isFinite(payload.bytes) && payload.bytes > 0;
      const hasDiff = typeof payload.diff === 'string' && payload.diff.length > 0;
      const content = contentOf(payload);
      if (!hasBytes && !hasDiff && content === undefined) {
        return true;
      }

      if (expected !== undefined) {
        return content !== expected;
      }
      // S2-1 收紧：desc 声明 "contains/include <text>" 时必须核对内容包含该子串，
      // 不能仅凭"有任何内容"就 T0 pass。
      if (contains !== undefined) {
        return content === undefined || !content.includes(contains);
      }
      return false;
    });

    const pass = fileEvidences.length > 0 && firstBadEvidence === undefined;

    return {
      claimId: fileEvidences[0]?.callId ?? ac.id,
      acId: ac.id,
      oracleTier: 'T0',
      result: pass ? 'pass' : 'fail',
      detail: this.detail(pass, firstBadEvidence, expected)
    };
  }

  private detail(pass: boolean, firstBadEvidence: Evidence | undefined, expected: string | undefined): string | undefined {
    if (pass) {
      return undefined;
    }

    if (expected !== undefined) {
      return `file content did not match exact expected text ${JSON.stringify(expected)}: ${JSON.stringify(firstBadEvidence?.payload ?? {})}`;
    }

    return `file evidence check failed: ${JSON.stringify(firstBadEvidence?.payload ?? {})}`;
  }
}
