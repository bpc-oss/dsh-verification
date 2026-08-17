/**
 * 类型扩展（模块上下文 + 显式 import 目标模块）：verification 域 session 事件 / projection / cordis 事件。
 * 显式加载 dsh-goal（目标域）与 dsh-session-projection（projection 注册表）使相关 augmentation 生效。
 */
import type {} from '@deepseek-ai/dsh-goal';
import type {} from '@deepseek-ai/dsh-session-projection';
import type {} from '@deepseek-ai/dsh-session-projection/types';
import type { VerificationChangeEventData, VerificationProjection } from './projection';

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'verification/change': VerificationChangeEventData;
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    verification: VerificationProjection | null;
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'verification/changed'(
      this: import('@deepseek-ai/dsh-scope').Scoped<import('@deepseek-ai/dsh-agent').Agent>,
      payload: {
        agent: import('@deepseek-ai/dsh-agent').Agent;
        change: { operation: 'change'; projection: VerificationProjection };
      }
    ): void;
  }
}

export {};
