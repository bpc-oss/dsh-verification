/**
 * 测试用 fake llm：把完整文本补全折叠为一个 JSON 内容块（grader 回显）。
 * 供独立捕获路径的端到端集成测试挂到 ctx 上（ctx.provide('llm', makeFakeLlm(...))）。
 */
import type { StreamChunk } from '@deepseek-ai/dsh-llm';

export interface FakeLlmOptions {
  /** 每次新生返回的文本；可依请求动态生成（request.message） */
  respondWith: (request: { messages: Array<{ role: string; content?: unknown }> }) => string;
  providers?: string[];
  models?: string[];
  /** 配置成执行者提案路径（true 回显）时的选项：建议直接传 JSON 字符串 */
  onStream?: () => AsyncIterable<StreamChunk>;
}

function textBlocksToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'object' && block !== null) {
      const b = block as { type?: string; text?: string; content?: unknown };
      if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
      else if (b.text === undefined && b.content !== undefined) parts.push(textBlocksToText(b.content));
    }
  }
  return parts.join('\n').trim();
}

function streamOf(text: string): AsyncIterable<StreamChunk> {
  return (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' } as StreamChunk;
    yield { type: 'text-delta', index: 0, text } as StreamChunk;
    yield { type: 'block-end', index: 0, block: { type: 'text', text } } as StreamChunk;
    yield { type: 'finish', reason: 'stop' } as StreamChunk;
  })();
}

/** 生成一个完整可用的 fake llm（listProviders/listModels/stream + 可选 usage 计量）。 */
export function makeFakeLlm(options: FakeLlmOptions): unknown {
  return {
    listProviders: () => {
      // dsh-llm 的 listProviders 返回 ProviderInfo[]（{id,name}），不是字符串数组
      return (options.providers ?? ['fake']).map((id) => ({ id, name: id }));
    },
    listModels: async () => (options.models ?? ['fake-model']).map((id) => ({ provider: 'fake', id, name: id })),
    stream: (request: { messages?: Array<{ role: string; content?: unknown }> }) => {
      const text = options.respondWith({ messages: request.messages ?? [] });
      return streamOf(text);
    }
  };
}

/** 把一段意图契约 JSON 文本转成流内容（供 respondWith 使用）。 */
export function contractJson(v: unknown): string {
  return `${JSON.stringify(v)}`;
}

/**
 * 构造完整的 grader 回显契约 JSON（body-only —— 与真实 grader 一致，ref/origin 由服务端 mint）。
 * selector 由服务端按 acId 从执行者提案回填。
 */
export function graderContract(body: {
  goal: string;
  acceptanceCriteria: Array<Record<string, unknown>>;
  constraints?: unknown[];
  inputs?: string[];
  outOfScope?: string[];
}): string {
  return JSON.stringify({
    goal: body.goal,
    acceptanceCriteria: body.acceptanceCriteria,
    constraints: body.constraints ?? [],
    inputs: body.inputs ?? [],
    outOfScope: body.outOfScope ?? []
  });
}
