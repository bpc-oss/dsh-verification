import type { Agent } from '@deepseek-ai/dsh-agent';

/**
 * 扫描事件日志：自最近一次 turn 边界以来是否存在直接人类输入（`user/message` 且 `source.kind === 'user'`）。
 * 人类直接说"完成了"时，T4 人类闸口视为已满足。纯函数，便于测试。
 */
export function scanForDirectHumanInput(events: readonly { type?: string; data?: unknown }[]): boolean {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const boundary = events[index];
    if (boundary?.type === 'turn/end' || boundary?.type === 'turn/start') {
      break;
    }
    if (boundary?.type === 'user/message') {
      const data = boundary.data as { source?: { kind?: string } } | undefined;
      if (data?.source?.kind === 'user') {
        return true;
      }
    }
  }
  return false;
}

/** 当前 turn 内是否存在直接人类输入（仿 `dsh-tool-goal` 的 `hasDirectHumanInput`）。 */
export function hasDirectHumanInput(agent: Agent): boolean {
  return scanForDirectHumanInput(agent.session.events);
}
