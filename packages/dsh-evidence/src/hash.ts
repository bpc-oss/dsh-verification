import { createHash } from 'node:crypto';

/**
 * 规范化哈希工具（v9）：stable canonical JSON 哈希。
 * 对象键稳定排序；数组保持顺序；字符串原样。用于：
 *  - `normalizedArgsHash`（selector 参数规范化）
 *  - `contractContentHash`（契约内容）
 *  - `basisHash`（sourceBasis 条目序列）
 *  - 内容寻址 blob key（evidence payload）
 */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 稳定排序键的规范化值（递归）。undefined 省略；number NaN/Infinity 归一为 null。 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    const out: Record<string, unknown> = {};
    for (const [key, entry] of entries) {
      out[key] = canonicalize(entry);
    }
    return out;
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      return null;
    }
  }
  return value;
}

/** 稳定 hash（sha256 hex）。 */
export function stableHash(value: unknown): string {
  const canonical = canonicalize(value);
  if (canonical === undefined) {
    return createHash('sha256').update('undefined').digest('hex');
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** 原始字节 hash（内容寻址 blob 用）。 */
export function contentHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function textHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** epochId 派生：sha256(sessionId:goalId:createSeq)。 */
export function deriveEpochId(sessionId: string, goalId: string, createSeq: number): string {
  return createHash('sha256').update(`${sessionId}:${goalId}:${createSeq}`).digest('hex');
}
