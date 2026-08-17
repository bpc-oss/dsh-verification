/**
 * P0 修复 #4（构建期）：把 tsup 产出的裸 ESM `lib/client.js` 改写为 dsh 浏览器端
 * `window.__ModuleLoader__.load({ id, factory(require) })` 单文件协议（官方客户端包格式）。
 *
 * 处理范围（严格限定本包现状）：
 *  - 顶层 `import ... from "…"` 语句：仅 `react/jsx-runtime` 为运行时外部（其余均被 tsup 内联）；
 *  - `export { … }` / `export const|var|function` 统一落到 `module.exports`。
 * 改写后由 dsh `dsh-client-modules` 直接 serve；平台通过 `factory(require)` 注入 seed 词。
 */
const fs = require('node:fs');
const path = require('node:path');

const pkgDir = path.resolve(__dirname, '..');
const outFile = path.join(pkgDir, 'lib', 'client.js');
const pkgJson = require(path.join(pkgDir, 'package.json'));
const id = pkgJson.name;

let text = fs.readFileSync(outFile, 'utf8');

// ── 1) 顶层 import 语句 → require 映射（仅处理外部 spec；内联产物一般无其他裸 import） ──
const IMPORT_RE = /^import\s+(.*?)\s+from\s+["']([^"']+)["'];?\s*$/gm;
const beforeImports = (text.match(IMPORT_RE) ?? []).length;
console.log(`wrap-loader: found ${beforeImports} top-level import statement(s)`);
if (beforeImports > 0) {
  console.log('wrap-loader: sample ->', JSON.stringify((text.match(IMPORT_RE) ?? [])[0]));
}
const assignments = [];
text = text.replace(IMPORT_RE, (_m, clause, spec) => {
  // 命名导入：import { a as b, c } from 's'
  let named = /^\{([^}]*)\}$/.exec(clause.trim());
  if (named) {
    for (const part of named[1].split(',')) {
      const [src, dst] = part.trim().split(/\s+as\s+/);
      if (!src) continue;
      const target = (dst ?? src).trim();
      assignments.push(`let ${target} = require(${JSON.stringify(spec)}).${src.trim()};`);
    }
    return '';
  }
  // 命名空间导入：import * as ns from 's'
  let ns = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(clause.trim());
  if (ns) {
    assignments.push(`let ${ns[1]} = require(${JSON.stringify(spec)});`);
    return '';
  }
  // 默认导入：import d, { a } ... / import d from 's'
  const def = /^([A-Za-z_$][\w$]*)(?:\s*,\s*\{([^}]*)\})?$/.exec(clause.trim());
  if (def) {
    assignments.push(`let ${def[1]} = require(${JSON.stringify(spec)}).default ?? require(${JSON.stringify(spec)});`);
    if (def[2]) {
      for (const part of def[2].split(',')) {
        const [src, dst] = part.trim().split(/\s+as\s+/);
        if (!src) continue;
        const target = (dst ?? src).trim();
        assignments.push(`let ${target} = require(${JSON.stringify(spec)}).${src.trim()};`);
      }
    }
    return '';
  }
  throw new Error(`wrap-loader: unsupported import clause: "${clause}" from "${spec}"`);
});

// ── 2) export 语句 → module.exports ──
text = text.replace(/^export\s+async\s+function\s+/gm, 'async function ');
text = text.replace(/^export\s+function\s+/gm, 'function ');
text = text.replace(/^export\s+class\s+/gm, 'class ');
text = text.replace(/^export\s+const\s+/gm, 'const ');
text = text.replace(/^export\s+let\s+/gm, 'let ');
text = text.replace(/^export\s+var\s+/gm, 'var ');
text = text.replace(/^export\s*\{([^}]*)\};\s*$/gm, (_m, names) => {
  const keys = names
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [src, dst] = part.split(/\s+as\s+/);
      return `${(dst ?? src).trim()}: ${src.trim()}`;
    });
  return `module.exports = { ${keys.join(', ')} };`;
});
text = text.replace(/\/\/\# sourceMappingURL=.*\n?$/, '');

// ── 3) 包装为 __ModuleLoader__.load ──
const body = [assignments.join('\n'), text.trim()].filter(Boolean).join('\n');
// P0 #4 构建期守卫：残留 ESM 关键字会在浏览器端整包加载失败（历史故障），必须在此显式失败。
const residual = body.match(/^\s*(?:import\b|export\b)/m);
if (residual) {
  throw new Error(`wrap-loader: residual ESM statement in client bundle: ${JSON.stringify(residual[0])}`);
}
const wrapped = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(id)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${body
  .split('\n')
  .map((line) => '    ' + line)
  .join('\n')}
    return module.exports;
  }
});
`;

fs.writeFileSync(outFile, wrapped, 'utf8');
console.log(`wrap-loader: wrote ${id} client bundle (${body.split('\n').length} lines) to ${path.relative(process.cwd(), outFile)}`);
