/**
 * SelectorV1（v11：v1 exact-only）匹配工具。
 * 规范化规则（契约权威 §1.2）：
 *  - 参数先按工具 schema 默认值展开（可由 binder 传入已展开的参数）；
 *  - 路径做 repo-relative lexical 归一（v1 不调用 realpath；存在 symlink 时另存 resolved identity）；
 *  - 对象键稳定排序后 hash。
 */
import { canonicalize, stableHash } from './hash';

/** 路径 lexical 归一：反斜杠→正斜杠、折叠 `./` 与 `a/../b`、去掉末尾 `/` 与前导 `./`。 */
export function normalizePathLexically(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const segments: string[] = [];
  for (const segment of normalized.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') {
        segments.pop();
      } else {
        segments.push('..');
      }
    } else {
      segments.push(segment);
    }
  }
  return segments.join('/');
}

/** 工具 schema 默认值展开后的参数再规范化（binder 先做 default 展开再调用本函数）。 */
export function canonicalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    let entry = value;
    if (typeof entry === 'string' && /path|file|target|dir|url/i.test(key)) {
      entry = normalizePathLexically(entry);
    } else if (Array.isArray(entry) && /path|file|include|sources/i.test(key)) {
      entry = entry.map((item) => (typeof item === 'string' ? normalizePathLexically(item) : item));
    }
    normalized[key] = entry;
  }
  return normalized;
}

/** 候选证据侧参数 hash（binder 用它匹配冻结 SelectorV1.normalizedArgsHash）。 */
export function normalizedArgsHash(args: Record<string, unknown>): string {
  return stableHash(canonicalizeArgs(args));
}

/** 规范化参数的确定性展示（UI/诊断，防泄漏内部 repr）。 */
export function canonicalArgsToPlain(args: Record<string, unknown>): unknown {
  return canonicalize(canonicalizeArgs(args));
}
