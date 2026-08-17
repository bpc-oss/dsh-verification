/**
 * 内容寻址 blob 存储（v9 §4.4）。
 * 原子写 blob（tmp+rename）→ 追加 verification/change 事件（含 hash/length/schemaVersion/contractIdentity）。
 * blob 缺失/损坏/版本未知 → gate fail closed。truncation 语义：
 * 超过单证据上限时截断并在 payload 打 `completeness: 'truncated'` 标记——需要完整内容的 oracle
 * 看到 truncation 必须 fail/need_evidence，绝不把摘要当完整 canonical evidence。
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { MAX_EVIDENCE_PAYLOAD_BYTES, contentHash } from '@bpc-oss/dsh-evidence';

export interface BlobStore {
  write(bytes: Uint8Array): Promise<string>;
  read(key: string): Promise<Uint8Array | null>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

/** 内存实现（测试/单进程）。 */
export function createMemoryBlobStore(): BlobStore {
  const map = new Map<string, Uint8Array>();
  return {
    async write(bytes) {
      const key = contentHash(bytes);
      map.set(key, bytes);
      return key;
    },
    async read(key) {
      return map.get(key) ?? null;
    },
    async has(key) {
      return map.has(key);
    },
    async delete(key) {
      map.delete(key);
    }
  };
}

/** 文件实现（生产原型；atomic tmp+rename，内容寻址）。 */
export function createFileBlobStore(dir: string): BlobStore {
  return {
    async write(bytes) {
      const key = contentHash(bytes);
      const target = join(dir, key);
      const tmp = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
      await mkdir(dir, { recursive: true });
      await writeFile(tmp, Buffer.from(bytes));
      await rename(tmp, target);
      return key;
    },
    async read(key) {
      try {
        const data = await readFile(join(dir, key));
        if (contentHash(new Uint8Array(data)) !== key) {
          return null; // 损坏：hash 不匹配
        }
        return new Uint8Array(data);
      } catch {
        return null;
      }
    },
    async has(key) {
      const data = await this.read(key);
      return data !== null;
    },
    async delete(key) {
      await rm(join(dir, key), { force: true });
    }
  };
}

export interface StoredPayload {
  blobKey: string;
  originalLength: number;
  rawHash: string;
  truncated: boolean;
  completeness: 'complete' | 'truncated';
}

/** 规范化证据载荷持久化：原子写 blob 并返回元数据。 */
export async function storePayload(store: BlobStore, payload: unknown, maxBytes: number = MAX_EVIDENCE_PAYLOAD_BYTES): Promise<StoredPayload> {
  const text = JSON.stringify(payload);
  const raw = new TextEncoder().encode(text);
  const rawHash = contentHash(raw);
  if (raw.byteLength <= maxBytes) {
    const blobKey = await store.write(raw);
    return { blobKey, originalLength: raw.byteLength, rawHash, truncated: false, completeness: 'complete' };
  }
  const truncatedText = text.slice(0, maxBytes);
  const truncated = new TextEncoder().encode(truncatedText);
  const blobKey = await store.write(truncated);
  return { blobKey, originalLength: raw.byteLength, rawHash, truncated: true, completeness: 'truncated' };
}

export { dirname as _dirname };
