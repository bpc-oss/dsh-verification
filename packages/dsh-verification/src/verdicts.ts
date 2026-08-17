/**
 * 通用辅助：证据摘要、oracleHint → evidenceType、selector 参数规范化 re-export。
 */
import type { CapturedEvidence, EvidenceType, OracleHint } from '@bpc-oss/dsh-evidence';
import { normalizedArgsHash, textHash } from '@bpc-oss/dsh-evidence';

/** 捕获证据的定位摘要（供 evidenceRef.summary；binder 与 UI 展示不依赖 payload 细节）。 */
export function textSummary(captured: CapturedEvidence): string {
  const payload = captured.payload as Record<string, unknown>;
  const parts: string[] = [`${captured.toolIdentity}`, `${captured.evidenceType}`];
  if (typeof payload.command === 'string') {
    parts.push(`cmd:${payload.command.slice(0, 120)}`);
  }
  if (typeof payload.path === 'string') {
    parts.push(`path:${payload.path}`);
  }
  if (typeof payload.exitCode === 'number') {
    parts.push(`exit:${payload.exitCode}`);
  }
  if (typeof payload.failCount === 'number') {
    parts.push(`fail:${payload.failCount}`);
  }
  return parts.join(' ');
}

/** oracleHint → 服务端 binder 使用的证据类型（selector evidenceType 的来源之一）。 */
export function hintToEvidenceType(hint: OracleHint): EvidenceType {
  switch (hint) {
    case 'test':
      return 'test_run';
    case 'run':
      return 'command_output';
    case 'file':
      return 'file_diff';
    case 'schema':
      return 'schema_valid';
    case 'review':
      return 'assistant_response';
    case 'human':
      return 'human_ack';
  }
}

/** AC 建议的 selector evidenceType（由 oracleHint 代理）。 */
export function proxyEvidenceType(hint: OracleHint): EvidenceType {
  return hintToEvidenceType(hint);
}

/** 供工具/服务端冻结 selector 使用的规范化参数 hash。 */
export { normalizedArgsHash };
export { textHash };
