/**
 * dist-pack 一致性检查：重新打包三个 @bpc-oss 包，与仓库内已提交的
 * dist-pack/*-fixed.tgz 比对 sha512。CI 在 `pnpm -r build` 之后运行本脚本，
 * 防止归档二进制与源码漂移（发布物"可复现"承诺的机器校验）。
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url))); // scripts/.. = 仓库根
const pkgs = ['dsh-evidence', 'dsh-verification', 'dsh-client-ui-verification'];
const tmp = mkdtempSync(join(tmpdir(), 'dsh-dist-check-'));
let ok = true;

const sha512hex = (p) => createHash('sha512').update(readFileSync(p)).digest('hex');

for (const pkg of pkgs) {
  execSync(`pnpm --filter @bpc-oss/${pkg} pack --pack-destination "${tmp}"`, { cwd: repo, stdio: 'pipe' });
  const fresh = join(tmp, `bpc-oss-${pkg}-1.0.0.tgz`);
  const committed = join(repo, 'dist-pack', `bpc-oss-${pkg}-1.0.0-fixed.tgz`);
  if (!existsSync(committed)) {
    console.error(`${pkg}: committed dist-pack missing: ${committed}`);
    ok = false;
    continue;
  }
  const a = sha512hex(fresh);
  const b = sha512hex(committed);
  const match = a === b;
  console.log(`${pkg}: ${match ? 'MATCH' : 'MISMATCH'}  (fresh ${a.slice(0, 12)} / committed ${b.slice(0, 12)})`);
  if (!match) ok = false;
}

rmSync(tmp, { recursive: true, force: true });
if (!ok) {
  console.error('dist-pack is out of sync with current source. Run `pnpm -r build` and repack the tgz into dist-pack/.');
  process.exit(1);
}
console.log('dist-pack consistent with current source builds.');
