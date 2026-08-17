/**
 * 证据推导（v9）：把一次工具调用记录映射为 **CapturedEvidence**（无 acId）。
 * canonical value 只在 tools/post-execute 可见；DSH 不把 value 写入 durable events，
 * 因此证据本体由服务端持久化为内容寻址 blob（dsh-verification/evidence-store）。
 * 模型没有"代笔转述"通道（Bobby L1/L3）。
 */
import type { CapturedEvidence, ContractIdentity } from './evidence';
import { canonicalizeArgs, normalizedArgsHash } from './selector';
import { parseTestOutput } from './test-output';

/** 一次工具调用的最小记录形状（dsh-verification 的 evidence-capture 从 DSH 执行对象适配而来）。 */
export interface ToolRecord {
  callId: string;
  /** 工具 identity：内置注册名或 `mcp:<server>/<tool>`。 */
  name: string;
  /** 已解析的参数（lossless JSON）。 */
  arguments: Record<string, unknown>;
  /** 调用是否失败（工具抛出或被阻断）。 */
  isError: boolean;
  /** 成功时的 canonical value（仅 post-execute 可见）。 */
  value?: unknown;
  /** 模型可见的渲染内容（ContentBlock[] 或字符串）。 */
  content?: unknown;
  /** 工具私有展示投影。 */
  meta?: unknown;
}

/** 把 DSH 的 ContentBlock 数组/字符串/未知值压平成文本。 */
export function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block === null || typeof block !== 'object') {
        continue;
      }
      const record = block as Record<string, unknown>;
      if (typeof record.text === 'string') {
        parts.push(record.text.trim());
      } else if (typeof record.content === 'string') {
        parts.push(record.content.trim());
      } else if (record.content !== undefined) {
        parts.push(extractTextFromContent(record.content));
      }
    }
    return parts.filter(Boolean).join('\n').trim();
  }
  if (content !== null && typeof content === 'object') {
    const record = content as Record<string, unknown>;
    if (typeof record.text === 'string') {
      return record.text;
    }
  }
  return '';
}

function pick(record: ToolRecord, ...keys: string[]): unknown {
  for (const source of [record.value, record.meta] as const) {
    if (source === null || source === undefined || typeof source !== 'object') {
      continue;
    }
    const obj = source as Record<string, unknown>;
    for (const key of keys) {
      if (obj[key] !== undefined) {
        return obj[key];
      }
    }
  }
  return undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isExecLike(name: string): boolean {
  return /(^|[-_.])(bash|pwsh|powershell|shell|exec|cmd|run|terminal)([-_.]|$)/i.test(name) || name === 'exec';
}

function isWriteLike(name: string): boolean {
  return /(write|edit|patch|replace|apply|insert|update)/i.test(name) || name === 'str_replace_editor';
}

function isReadLike(name: string): boolean {
  return /(read|list|stat|exists|find|glob|grep|search|inspect|fetch)/i.test(name);
}

function isTestLike(name: string, record: ToolRecord): boolean {
  if (/(test|spec|vitest|jest|pytest|go test)/i.test(name)) {
    return true;
  }
  const command = str(record.arguments.command) ?? str(record.arguments.cmd) ?? str(record.arguments.script) ?? '';
  return /(^|\s)(vitest|jest|pytest|go test|npm test|pnpm test|yarn test|npm run test)(\s|$)/i.test(command);
}

function pathFrom(record: ToolRecord): string | undefined {
  // S1-2 真机修复：DSH read 工具的参数名是 `file_path`（原实现只认 path/file/target，导致
  // read 证据缺少 path → FileDiffOracle 恒 fail）。补全常见参数名。
  return (
    str(record.arguments.path) ??
    str(record.arguments.file_path) ??
    str(record.arguments.filepath) ??
    str(record.arguments.file) ??
    str(record.arguments.target)
  );
}

/** S3 修复：控制面/verification 工具不产证据（update_goal、goal 工具、verification 工具等）。 */
function isNonEvidenceTool(name: string): boolean {
  return /update_goal|_goal|set_verification_plan|get_verification_plan|reset_verification_plan|pro_review|verification_plan/i.test(name);
}

export interface DeriveOptions {
  /** 捕获时的契约身份五元组（无契约身份 → 捕获层上游判定不产生证据）。 */
  contractIdentity: ContractIdentity;
  /** 是否把 exec-like 且命令像测试运行器的记录解析为 test_run。默认 true。 */
  parseTestRuns?: boolean;
}

interface ExtractResult {
  evidenceType: CapturedEvidence['evidenceType'];
  payload: Record<string, unknown>;
}

function commandOutputResult(record: ToolRecord): ExtractResult {
  const exitCode = num(pick(record, 'exitCode', 'exit_code', 'code'));
  const stdout = str(pick(record, 'stdout', 'output', 'out'));
  const stderr = str(pick(record, 'stderr', 'error'));
  const command =
    str(record.arguments.command) ??
    str(record.arguments.cmd) ??
    str(record.arguments.script) ??
    str(record.arguments.args) ??
    record.name;
  const effectiveExitCode = record.isError ? (exitCode ?? 1) : exitCode;
  return {
    evidenceType: 'command_output',
    payload: {
      command,
      exitCode: effectiveExitCode,
      ...(stdout !== undefined ? { stdout } : {}),
      ...(stderr !== undefined ? { stderr } : {})
    }
  };
}

function testRunResult(record: ToolRecord): ExtractResult {
  const output =
    str(pick(record, 'stdout', 'output')) ??
    str(pick(record, 'outputText', 'text')) ??
    extractTextFromContent(record.content);
  const exitCode = num(pick(record, 'exitCode', 'exit_code', 'code')) ?? (record.isError ? 1 : 0);
  const parsed = parseTestOutput(output ?? '');
  return {
    evidenceType: 'test_run',
    payload: {
      output,
      exitCode,
      passCount: parsed.passCount,
      failCount: parsed.failCount,
      failures: parsed.failures,
      files: parsed.files
    }
  };
}

function fileDiffResult(record: ToolRecord): ExtractResult {
  const path = pathFrom(record) ?? str(pick(record, 'path'));
  const diff = str(pick(record, 'diff', 'patch'));
  // 真实 write/edit 工具的 canonical value 形如 {path, operation, before, after}，无 content/bytes。
  // `after`（写入后的完整内容）是最可靠的精确核对源，优先于 content/text。
  const after = str(pick(record, 'after'));
  const content = str(pick(record, 'content', 'text')) ?? after;
  const bytesValue =
    typeof record.value === 'object' && record.value !== null
      ? (record.value as Record<string, unknown>).bytes
      : undefined;
  return {
    evidenceType: 'file_diff',
    payload: {
      ...(path !== undefined ? { path } : {}),
      ...(diff !== undefined ? { diff } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(bytesValue !== undefined ? { bytes: bytesValue } : {}),
      error: record.isError ? true : undefined
    }
  };
}

function fileExistsOrQuoteResult(record: ToolRecord): ExtractResult {
  const path = pathFrom(record);
  const exists = pick(record, 'exists', 'found', 'matched', 'hits');
  const isError = record.isError;
  const existence =
    exists !== undefined
      ? Boolean(exists)
      : isError
        ? false
        : record.name.includes('exists') || record.name.includes('stat')
          ? true
          : undefined;
  if (existence === undefined) {
    // S1-2 真机修复：quote 优先取结构化 value 的干净文本（text/content/quote），
    // 其次才回退到模型可见渲染 content（可能夹带 <path>/<content> 等标记）。
    const cleanText =
      str(pick(record, 'text')) ??
      (typeof pick(record, 'content') === 'string' ? (pick(record, 'content') as string) : undefined) ??
      str(pick(record, 'quote'));
    const text = cleanText !== undefined && cleanText.length > 0 ? cleanText : extractTextFromContent(record.content);
    return {
      evidenceType: 'quote_with_location',
      payload: {
        ...(path !== undefined ? { path } : {}),
        ...(text.length > 0 ? { quote: text.slice(0, 2000) } : {}),
        error: isError ? true : undefined
      }
    };
  }
  return {
    evidenceType: 'file_exists',
    payload: {
      ...(path !== undefined ? { path } : {}),
      exists: existence,
      error: isError ? true : undefined
    }
  };
}

/**
 * 从工具调用记录推导 **一条** CapturedEvidence（unbound）。
 * 返回 null 表示该调用不产生可采集证据（不在捕获名单内 → 上游不落 blob）。
 */
export function deriveCaptured(record: ToolRecord, options: DeriveOptions): CapturedEvidence | null {
  if (isNonEvidenceTool(record.name)) {
    return null;
  }
  let extracted: ExtractResult | null = null;

  if (options.parseTestRuns !== false && isTestLike(record.name, record)) {
    extracted = testRunResult(record);
  } else if (isExecLike(record.name)) {
    extracted = commandOutputResult(record);
  } else if (isWriteLike(record.name)) {
    extracted = fileDiffResult(record);
  } else if (isReadLike(record.name)) {
    extracted = fileExistsOrQuoteResult(record);
  } else {
    return null;
  }

  const normalizedArgs = canonicalizeArgs(record.arguments);
  return {
    callId: record.callId,
    toolIdentity: record.name,
    schemaVersion: 1,
    normalizedArgs,
    normalizedArgsHash: normalizedArgsHash(record.arguments),
    evidenceType: extracted.evidenceType,
    payload: extracted.payload,
    producedBy: 'tool',
    failed: record.isError,
    contractIdentity: options.contractIdentity
  };
}

// 兼容导出（dsh-verification 集成层仍会引用 normalizedArgsHash 做 binder 匹配）
export { normalizedArgsHash, canonicalizeArgs } from './selector';

