/**
 * 结构化共识：多次生成 → 稳定规范化 JSON 多数投票（Bobby `brain/structured-consensus.ts` 移植，
 * 去掉 Bobby 特有的 usage/cacheMetadata 载荷，保留核心多数决逻辑）。
 */

export type StructuredConsensusSuccess<T> = {
  kind: 'success';
  value: T;
  content: string;
  reasoningContent?: string;
};

export type StructuredConsensusAllInvalid = {
  kind: 'all_invalid';
  error: Error;
};

export type StructuredConsensusResult<T> = StructuredConsensusSuccess<T> | StructuredConsensusAllInvalid;

export interface ConsensusGeneration {
  content: string;
  reasoningContent?: string;
}

export async function runStructuredConsensus<T>(input: {
  consensusCount: number;
  generate: () => Promise<ConsensusGeneration>;
  parse: (content: string) => T;
}): Promise<StructuredConsensusResult<T>> {
  const validCandidates: Array<{
    value: T;
    content: string;
    reasoningContent?: string;
    canonical: string;
    index: number;
    votes: number;
  }> = [];
  let firstError: Error | undefined;

  for (let index = 0; index < input.consensusCount; index += 1) {
    const response = await input.generate();

    try {
      const value = input.parse(response.content);
      const canonical = stableCanonicalJson(value);
      const existing = validCandidates.find((candidate) => candidate.canonical === canonical);
      if (existing) {
        existing.votes += 1;
      } else {
        validCandidates.push({
          value,
          content: response.content,
          ...(response.reasoningContent ? { reasoningContent: response.reasoningContent } : {}),
          canonical,
          index,
          votes: 1
        });
      }
    } catch (error) {
      if (firstError === undefined) {
        firstError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  if (validCandidates.length === 0) {
    return {
      kind: 'all_invalid',
      error: firstError ?? new Error('structuredConsensus: no valid candidates')
    };
  }

  validCandidates.sort((left, right) => {
    if (right.votes !== left.votes) {
      return right.votes - left.votes;
    }
    return left.index - right.index;
  });

  const winner = validCandidates[0]!;
  return {
    kind: 'success',
    value: winner.value,
    content: winner.content,
    ...(winner.reasoningContent ? { reasoningContent: winner.reasoningContent } : {})
  };
}

function stableCanonicalJson(value: unknown): string {
  return JSON.stringify(sortCanonicalValue(value));
}

function sortCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortCanonicalValue(entry));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortCanonicalValue(entry)])
    );
  }

  return value;
}
