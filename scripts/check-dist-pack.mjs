/**
 * dist-pack 一致性检查（内容级，跨平台）：重新打包三个 @bpc-oss 包，
 * 解包后与已提交的 dist-pack/*-fixed.tgz 逐文件比较（行尾归一化后的内容 sha512）。
 *
 * 为什么内容级而非 tgz 整体 sha512：pnpm pack 在不同平台（Windows/Linux）生成的
 * tar 容器元数据（header 时间戳/模式等）可能不同，但包内文件内容应当完全一致。
 * CI 在 `pnpm -r build` 之后运行本脚本，保证"发布物可复现"。
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url))); // scripts/.. = 仓库根
const pkgs = ['dsh-evidence', 'dsh-verification', 'dsh-client-ui-verification'];
const tmp = mkdtempSync(join(tmpdir(), 'dsh-dist-check-'));
let ok = true;

const sha512hex = (buf) => createHash('sha512').update(buf).digest('hex');
/** 行尾归一化：原始 CRLF→LF，另处理 JSON 内转义的 \r\n（sourcemap sourcesContent 的 Windows 遗留）。 */
const normalize = (buf) => buf.toString('utf8').replace(/\r\n/g, '\n').replace(/\\r\\n/g, '\\n');

/** JSON 键排序规范化：pnpm pack 对 workspace 依赖的重写顺序不稳定，键顺序无语义，比较前统一排序。 */
function canonicalJson(buf) {
  const sortKeys = (o) => {
    if (Array.isArray(o)) return o.map(sortKeys);
    if (o && typeof o === 'object') {
      const out = {};
      for (const k of Object.keys(o).sort()) out[k] = sortKeys(o[k]);
      return out;
    }
    return o;
  };
  return JSON.stringify(sortKeys(JSON.parse(buf.toString('utf8'))), null, 2);
}

function contentBytes(rel, buf) {
  const text = normalize(buf);
  return rel.endsWith('.json') ? normalize(Buffer.from(canonicalJson(buf), 'utf8')) : text;
}

function treeFiles(root) {
  const out = [];
  const walk = (dir, base) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const rel = join(base, name).replace(/\\/g, '/');
      const st = statSync(p);
      if (st.isDirectory()) walk(p, rel);
      else out.push(rel);
    }
  };
  walk(root, '');
  return out.sort();
}

function contentIndex(root) {
  const idx = new Map();
  for (const rel of treeFiles(root)) {
    idx.set(rel, sha512hex(Buffer.from(contentBytes(rel, readFileSync(join(root, rel))), 'utf8')));
  }
  return idx;
}

for (const pkg of pkgs) {
  // 与 repack 脚本一致：从包目录内 `pnpm pack`（--filter 从根打包会对 package.json 做不同规范化，
  // 导致依赖顺序与归档不一致）
  execSync(`pnpm pack --pack-destination "${tmp}"`, { cwd: join(repo, 'packages', pkg), stdio: 'pipe' });
  const fresh = join(tmp, `bpc-oss-${pkg}-1.0.0.tgz`);
  const committed = join(repo, 'dist-pack', `bpc-oss-${pkg}-1.0.0-fixed.tgz`);
  if (!existsSync(committed)) {
    console.error(`${pkg}: committed dist-pack missing: ${committed}`);
    ok = false;
    continue;
  }
  const dirA = join(tmp, `a-${pkg}`);
  const dirB = join(tmp, `b-${pkg}`);
  mkdirSync(dirA, { recursive: true });
  mkdirSync(dirB, { recursive: true });
  execSync(`tar -xzf "${committed}" -C "${dirA}"`);
  execSync(`tar -xzf "${fresh}" -C "${dirB}"`);

  const a = contentIndex(dirA);
  const b = contentIndex(dirB);
  const aKeys = [...a.keys()];
  const onlyA = aKeys.filter((k) => !b.has(k));
  const onlyB = [...b.keys()].filter((k) => !a.has(k));
  const diffContent = aKeys.filter((k) => b.has(k) && a.get(k) !== b.get(k));
  const match = onlyA.length === 0 && onlyB.length === 0 && diffContent.length === 0;

  console.log(`${pkg}: ${match ? 'MATCH' : 'MISMATCH'}  (${aKeys.length} files)`);
  if (!match) {
    if (onlyA.length) console.log(`  only in committed: ${onlyA.join(', ')}`);
    if (onlyB.length) console.log(`  only in fresh: ${onlyB.join(', ')}`);
    if (diffContent.length) console.log(`  content differs: ${diffContent.join(', ')}`);
  }
  if (!match) ok = false;
}

rmSync(tmp, { recursive: true, force: true });
if (!ok) {
  console.error('dist-pack content differs from current source build. Run `pnpm -r build` and repack into dist-pack/.');
  process.exit(1);
}
console.log('dist-pack consistent with current source builds (content-level, cross-platform).');
