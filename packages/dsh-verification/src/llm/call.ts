/**
 * 程序化 LLM 调用助手：把一次文本补全折叠成完整响应。
 * 供 structured-consensus（意图契约多次生成）与 Pro 对抗审查（T2）使用。
 * 基于 `ctx.llm.stream(GenerateOptions)` 流式接口，纯装配逻辑可单测。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock, GenerateOptions, MessageId, StreamChunk } from '@deepseek-ai/dsh-llm';

export interface CompletionMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface CompleteTextOptions {
  provider: string;
  model: string;
  system?: string;
  messages: CompletionMessage[];
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  signal?: AbortSignal;
}

export interface CompleteTextResult {
  text: string;
  reasoning?: string;
  usage?: unknown;
}

function textBlock(text: string): ContentBlock {
  return { type: 'text', text };
}

/** 把流式 chunk 折叠成文本（纯函数，可单测）。 */
export function assembleStream(chunks: Iterable<StreamChunk>): { text: string; reasoning: string } {
  let text = '';
  let reasoning = '';
  for (const chunk of chunks) {
    if (chunk.type === 'text-delta') {
      text += chunk.text;
    } else if (chunk.type === 'reasoning-delta') {
      reasoning += chunk.text;
    }
  }
  return { text, reasoning };
}

/** 程序化文本补全（失败抛错；调用方负责 provider/model 的可用性）。 */
export async function completeText(ctx: Context, options: CompleteTextOptions): Promise<CompleteTextResult> {
  const llm = ctx.get('llm');
  if (!llm) {
    throw new Error('verification: llm service is not mounted');
  }

  const request: GenerateOptions = {
    provider: options.provider,
    model: options.model,
    messages: options.messages.map((message) => ({
      id: (`verification-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`) as MessageId,
      role: message.role,
      content: [textBlock(message.text)],
      source: { kind: 'plugin', plugin: 'dsh-verification' }
    })),
    ...(options.system !== undefined ? { system: options.system } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    ...(options.stop !== undefined ? { stop: options.stop } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {})
  };

  let usage: unknown;
  let finished = false;
  const collected: StreamChunk[] = [];
  for await (const chunk of llm.stream(request)) {
    if (chunk.type === 'usage') {
      usage = chunk.usage;
    }
    if (chunk.type === 'finish') {
      finished = true;
    }
    collected.push(chunk);
  }

  if (!finished) {
    throw new Error('verification: llm stream ended without a finish chunk');
  }

  const { text, reasoning } = assembleStream(collected);
  return {
    text,
    ...(reasoning.length > 0 ? { reasoning } : {}),
    ...(usage !== undefined ? { usage } : {})
  };
}
