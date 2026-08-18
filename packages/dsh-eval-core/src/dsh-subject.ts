import { randomUUID } from 'node:crypto';
import type { EvalSubject, EvalSubjectRunInput, EvalSubjectRunResult } from './subject';

/**
 * Minimal structural DSH host interface. It intentionally does not import
 * @deepseek-ai/dsh-* at runtime: DshEvalSubject is a library consumed by the
 * host process, and the actual `ctx.agents.create()` object satisfies this
 * shape.
 */
export interface DshAgentOptions {
  readonly provider?: string;
  readonly model?: string;
  readonly maxTokens?: number;
}

export interface DshCreateAgentOptions {
  readonly sessionId: string;
  readonly meta?: {
    readonly cwd?: string;
    readonly origin?: 'subagent';
  };
  readonly agentOptions?: DshAgentOptions;
  readonly signal?: AbortSignal;
}

export interface DshAgentLike {
  followup(message: unknown): void;
  whenIdle(): Promise<void>;
}

export interface DshAgentHandleLike {
  readonly agent: DshAgentLike;
  dispose(): Promise<void>;
}

export interface DshAgentHost {
  create(options: DshCreateAgentOptions): Promise<DshAgentHandleLike>;
}

export interface DshEvalSubjectOptions {
  readonly createSessionId?: () => string;
  readonly signal?: AbortSignal;
}

/**
 * DSH live eval subject. It creates a subagent in a dedicated workspace
 * (meta.cwd) using the public `ctx.agents.create()` surface, sends the task
 * prompt through `agent.followup()`, and waits for quiescence before
 * disposing the handle.
 */
export class DshEvalSubject implements EvalSubject {
  readonly kind = 'dsh';

  constructor(
    private readonly host: DshAgentHost,
    private readonly options: DshEvalSubjectOptions = {}
  ) {}

  async run(input: EvalSubjectRunInput): Promise<EvalSubjectRunResult> {
    const sessionId = this.options.createSessionId?.() ?? randomUUID();
    const handle = await this.host.create({
      sessionId,
      meta: {
        cwd: input.workspaceRoot,
        origin: 'subagent'
      },
      agentOptions: {
        provider: input.config.provider,
        model: input.config.model,
        maxTokens: input.config.maxTokens
      },
      signal: input.signal ?? this.options.signal
    });

    try {
      handle.agent.followup(this.createUserMessage(input.taskCase.prompt));
      await handle.agent.whenIdle();
      return {
        finalStatus: 'done',
        turns: 1,
        notes: [`dsh: ran task in session ${sessionId}`],
        sessionId
      };
    } finally {
      await handle.dispose();
    }
  }

  private createUserMessage(text: string): unknown {
    return {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user' }
    };
  }
}
