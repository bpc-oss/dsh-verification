/**
 * goal-bound task epoch 状态机（v9，纯函数）。
 * 权威来源：`dsh-plugin-port-plan.md` §1（v11 第 10 条）与 P0-1 文档 §4.4。
 * 规则：
 *  - 只有成功 committed 的 root `goal/change create` 建立 epoch（session 内单 live goal，故 session 内 create = root）；
 *  - `rootSeq` = create 事件之前、上一 closed epoch 之后最近一条权威用户消息；
 *    无此消息时**不再 fail-closed**（v11 放宽）：以 goal create 自身 seq 作为 rootSeq 建立 epoch——
 *    agent/UI 侧创建的目标（无前置用户消息）同样可用，避免"无活跃 epoch"把写工具整体锁死；
 *  - `epochId = sha256(sessionId:goalId:createSeq)`；
 *  - close 由该 rootGoalId 的 committed complete/clear 事件确定性派生；observer 不写额外事件；
 *  - 子 goal（其他 session）不参与本 session fold。
 */
import { deriveEpochId } from '@bpc-oss/dsh-evidence';

export interface GoalLogEvent {
  type: string;
  data: unknown;
  seq: number;
  time: number;
}

export interface FoldedEpoch {
  epochId: string;
  rootSeq: number;
  rootGoalId: string;
  createdSeq: number;
  status: 'active' | 'closed';
  /** root goal close（complete/clear）事件 seq；closed 时必有。 */
  closedSeq?: number;
  /** 任务内容快照 hash（plan attach 后服务端更新；投影层以空串兜底展示）。 */
  contentHash?: string;
}

interface GoalChangeData {
  kind?: string;
  operation?: string;
  goal?: { id: string; phase: string };
  cleared?: { id: string };
}

function asGoalChange(data: unknown): GoalChangeData | undefined {
  if (!data || typeof data !== 'object') {
    return undefined;
  }
  return data as GoalChangeData;
}

/** 是否为权威用户消息（`user/message` 且 source.kind === 'user'）。 */
export function isAuthoritativeUserMessage(event: GoalLogEvent): boolean {
  if (event.type !== 'user/message') {
    return false;
  }
  const data = event.data as { source?: { kind?: string } } | undefined;
  return data?.source?.kind === 'user';
}

function lastCloseBoundary(epochs: FoldedEpoch[], eventSeq: number): number {
  let boundary = -1;
  for (const epoch of epochs) {
    if (epoch.status === 'closed' && epoch.closedSeq !== undefined && epoch.closedSeq < eventSeq) {
      boundary = Math.max(boundary, epoch.closedSeq);
    }
  }
  return boundary;
}

/**
 * 从 session goal 日志折叠任务 epoch。
 * v11 放宽：窗口内无权威用户消息的 root create 以 goal create 自身 seq 为 rootSeq 建 epoch（不 fail-closed）。
 */
export function foldTaskEpochs(events: readonly GoalLogEvent[], sessionId: string): FoldedEpoch[] {
  const epochs: FoldedEpoch[] = [];
  let active: FoldedEpoch | undefined;

  for (const event of events) {
    if (event.type === 'goal/change') {
      const change = asGoalChange(event.data);
      if (change?.operation === 'create' && change.goal?.id) {
        // 已有 active root → 并发第二 root create 拒绝（GoalService 侧保证）；此处置于防御
        if (active && active.status === 'active') {
          continue;
        }
        const boundary = lastCloseBoundary(epochs, event.seq);
        let rootSeq = -1;
        for (let index = event.seq - 1; index > boundary; index -= 1) {
          const candidate = events[index];
          if (candidate && isAuthoritativeUserMessage(candidate)) {
            rootSeq = candidate.seq;
            break;
          }
        }
        if (rootSeq < 0) {
          // v11 放宽：窗口内无权威用户消息（agent/UI 侧创建的目标）→ 以 goal create 自身为任务起点。
          // 不再 fail-closed 拒绝，避免"无活跃 epoch"连带锁死写工具（advisory 模式本应放行）。
          rootSeq = event.seq;
        }
        const epoch: FoldedEpoch = {
          epochId: deriveEpochId(sessionId, change.goal.id, event.seq),
          rootSeq,
          rootGoalId: change.goal.id,
          createdSeq: event.seq,
          status: 'active'
        };
        epochs.push(epoch);
        active = epoch;
      } else if (
        active &&
        active.status === 'active' &&
        (change?.operation === 'complete' || change?.operation === 'clear') &&
        (change.goal?.id === active.rootGoalId || change.cleared?.id === active.rootGoalId)
      ) {
        active = { ...active, status: 'closed', closedSeq: event.seq };
        const index = epochs.findIndex((epoch) => epoch.epochId === active!.epochId);
        if (index >= 0) {
          epochs[index] = active;
        }
      }
    }
  }

  return epochs;
}

export function currentActiveEpoch(epochs: readonly FoldedEpoch[]): FoldedEpoch | undefined {
  return [...epochs].reverse().find((epoch) => epoch.status === 'active');
}

export function epochOpenBases(epochs: readonly FoldedEpoch[]): { rootGoalId: string; rootSeq: number } | undefined {
  const active = currentActiveEpoch(epochs);
  if (!active) {
    return undefined;
  }
  return { rootGoalId: active.rootGoalId, rootSeq: active.rootSeq };
}

/** 增量 epoch fold（projection 注册表 apply 用；与批处理 foldTaskEpochs 语义一致）。 */
export interface IncrementalEpochState {
  epochs: FoldedEpoch[];
  lastUserSeqOutsideActive: number;
}

export function emptyIncrementalEpochState(): IncrementalEpochState {
  return { epochs: [], lastUserSeqOutsideActive: -1 };
}

export function applyEpochEvent(state: IncrementalEpochState, event: GoalLogEvent, sessionId: string): IncrementalEpochState {
  if (event.type === 'user/message' && isAuthoritativeUserMessage(event)) {
    const active = currentActiveEpoch(state.epochs);
    if (!active || active.status === 'closed') {
      return { ...state, lastUserSeqOutsideActive: event.seq };
    }
    return state;
  }
  if (event.type !== 'goal/change') {
    return state;
  }
  const change = asGoalChange(event.data);
  if (change?.operation === 'create' && change.goal?.id) {
    if (currentActiveEpoch(state.epochs)) {
      return state;
    }
    // rootSeq 由批处理 fold 解析（增量下退化为：取最近权威用户消息 seq；
    // 无则 v11 放宽：以 goal create 自身 seq 为起点立即建 epoch，不再挂起等待）。
    const rootSeq = state.lastUserSeqOutsideActive >= 0 ? state.lastUserSeqOutsideActive : event.seq;
    const epoch: FoldedEpoch = {
      epochId: deriveEpochId(sessionId, change.goal.id, event.seq),
      rootSeq,
      rootGoalId: change.goal.id,
      createdSeq: event.seq,
      status: 'active'
    };
    return { epochs: [...state.epochs, epoch], lastUserSeqOutsideActive: -1 };
  }
  const active = currentActiveEpoch(state.epochs);
  if (
    active &&
    active.status === 'active' &&
    (change?.operation === 'complete' || change?.operation === 'clear') &&
    (change.goal?.id === active.rootGoalId || change.cleared?.id === active.rootGoalId)
  ) {
    const closed: FoldedEpoch = { ...active, status: 'closed', closedSeq: event.seq };
    return {
      epochs: state.epochs.map((epoch) => (epoch.epochId === closed.epochId ? closed : epoch)),
      lastUserSeqOutsideActive: state.lastUserSeqOutsideActive
    };
  }
  return state;
}

