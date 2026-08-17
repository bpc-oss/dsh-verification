import type { Context } from '@deepseek-ai/cordis';
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools';
import type { ToolRecord } from '@bpc-oss/dsh-evidence';

import type { VerificationService } from './service';

function toToolRecord(exec: ToolExecution, result: ToolExecutionResult): ToolRecord {
  return {
    callId: String(exec.callId),
    name: exec.name,
    arguments: (exec.arguments ?? {}) as Record<string, unknown>,
    isError: result.isError,
    value: result.isError ? undefined : result.value,
    content: result.content,
    meta: result.meta
  };
}

/** S2-2：识别 network 型工具（`network:` 禁令的真实数据源）。 */
const NETWORKLIKE_NAME = /(^|_)web|read_page|fetch|req|http|browser/i;

/** 一次工具调用是否属于 network 型（名字启发式；本地工具不触发）。 */
export function isNetworkLikeTool(name: string): boolean {
  return NETWORKLIKE_NAME.test(name) || name.startsWith('mcp:') || name.includes('web_search') || name.includes('web_fetch');
}

/**
 * 证据采集（v9）：`tools/post-execute` 派生 **CapturedEvidence**（unbound）→
 * 服务端持久化为内容寻址 blob + 追加 evidence 记录。
 * 无契约 identity → unbound telemetry，不触发 capture failure。
 * 本监听器 pass-through：内部任何失败都被 captureEvidence 收敛或在此吞掉，绝不断链 `next()`。
 * network: 禁令的数据源已移到 durable `tool/call` 折叠（service.reconcileDurableCalls 同源重建），
 * 此处不再重复记录。
 */
export function installEvidenceCapture(ctx: Context, service: VerificationService): void {
  ctx.on('tools/post-execute', (exec, result, next) => {
    const agent = exec.agent;
    if (agent) {
      const record = toToolRecord(exec, result);
      // S3-4：先标记"本进程已处理"，再采集——对账不会被这条在途调用误报缺口。
      service.markToolCallHandled(agent, String(exec.callId));
      void service
        .captureEvidence(agent, record, agent.session.seq)
        .catch(() => {
          /* never-throw：采集失败已内部记录；这里兜底不打断工具流 */
        });
    }
    return next();
  });
}
