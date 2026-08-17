/**
 * grader 输出解析（S1-2 真机修复：vLLM/本地模型常把 JSON 包在 markdown 或用 reasoning 流承载）。
 * 只从原始文本提取第一个完整 JSON 对象；失败抛错（由 consensus 层收敛为 all_invalid）。
 */
export class GraderParseError extends Error {
  constructor(
    message: string,
    readonly rawSample: string
  ) {
    super(message);
    this.name = 'GraderParseError';
  }
}

/** 从原始文本中定位并解析唯一 JSON 对象（容忍围栏/前后缀/重复文本）。 */
export function parseGraderJson(raw: string): unknown {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed.length === 0) {
    throw new GraderParseError('grader output is empty', '');
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new GraderParseError('no JSON object found in grader output', trimmed.slice(0, 400));
  }
  const candidate = trimmed.slice(start, end + 1);
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('parsed value is not an object');
    }
    return parsed;
  } catch (error) {
    throw new GraderParseError(`grader output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, candidate.slice(0, 400));
  }
}

/**
 * 提取原始文本中所有括号平衡的完整 JSON 对象（按出现顺序）。
 * 本地模型常在 reasoning 里输出多份草稿/被围栏包裹的文本；逐候选验证比"首{到末}"稳妥。
 */
export function extractJsonCandidates(raw: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        const candidate = raw.slice(start, i + 1);
        try {
          out.push(JSON.parse(candidate));
        } catch {
          /* 忽略畸形草稿，保留其余候选 */
        }
        start = -1;
      }
    }
  }
  return out;
}

/** 解析优先级：text 优先 → 失败用 raw 样本；reasoning 作为最后的兜底文本源。 */
export function graderCandidateContent(text: string, reasoning?: string): Array<{ text: string; label: string }> {
  const sources: Array<{ text: string; label: string }> = [];
  if (text.trim().length > 0) {
    sources.push({ text, label: 'text' });
  }
  if (reasoning !== undefined && reasoning.trim().length > 0) {
    sources.push({ text: reasoning, label: 'reasoning' });
  }
  return sources;
}
