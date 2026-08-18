import { createHash } from 'node:crypto';

/**
 * P1-3 v4 trust model: a fixture never declares its own trust level.
 * The loader injects trustLevel from the fixture's origin and/or a reviewed
 * hash allowlist.
 */
export type TrustLevel = 'builtin' | 'allowlisted' | 'untrusted';

export interface TrustResolutionInput {
  readonly source: 'builtin' | 'external';
  readonly fixtureHash?: string;
  readonly allowlistHashes?: ReadonlySet<string>;
}

export function resolveTrustLevel(input: TrustResolutionInput): TrustLevel {
  if (input.source === 'builtin') {
    return 'builtin';
  }

  if (input.fixtureHash && input.allowlistHashes?.has(input.fixtureHash)) {
    return 'allowlisted';
  }

  return 'untrusted';
}

export const TRUST_FIELD_NAMES = ['trusted', 'trustLevel', 'trust_level'] as const;

export function hasTrustField(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return TRUST_FIELD_NAMES.some((name) => Object.prototype.hasOwnProperty.call(record, name));
}

/**
 * Strip trust fields from an untrusted fixture before schema parsing.
 * Used by loaders that choose "ignore" instead of "reject".
 */
export function stripTrustFields<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if ((TRUST_FIELD_NAMES as readonly string[]).includes(key)) {
      continue;
    }
    out[key] = entry;
  }
  return out as T;
}

export function fileSha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}
