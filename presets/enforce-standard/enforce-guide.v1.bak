/**
 * enforce-guide — post-promotion, once-per-session near-user-message
 * injection of the enforce preset's DEFAULT verification workflow.
 *
 * Cloned from verifier-guide.mjs with the guidance text replaced by the
 * bpc-verification enforce workflow: after the anchored bootstrap promotes
 * (first tool call OR first assistant message), ONE short user-kind message
 * is appended telling the agent to run the verification workflow on every
 * task — create_goal → set_verification_plan (authoritative ACs) → execute
 * (evidence auto-captured) → update_goal complete (gate blocks wrong
 * deliverables with a defect list; fix per the defects, never weaken ACs).
 *
 * Why near-user-message: the injector's measured "close-distance signal"
 * principle. Fixed text, one-shot, durable: the once-per-session guard
 * derives from the event log, so a restart cannot duplicate it.
 *
 * Pre-promotion requests get NO hint (matches the anchored bootstrap); the
 * source kind `enforce-guide` is not in the context gate's allowlist, so the
 * gate strips it only while the session is unpromoted.
 */

import { createEpochPromotion } from './compaction-epoch.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'enforce-guide'

/** Durable session event types that count as a promotion signal per mode. */
const PROMOTE_EVENTS = {
  'tool-call': ['tool/call'],
  'assistant-message': ['assistant/message'],
  either: ['tool/call', 'assistant/message'],
}

function parsePromoteOn(value) {
  if (value === undefined || value === 'either') return PROMOTE_EVENTS.either
  if (value === 'tool-call' || value === 'assistant-message') return PROMOTE_EVENTS[value]
  throw new TypeError(`${name}: promoteOn must be one of "tool-call", "assistant-message", "either"; got ${JSON.stringify(value)}`)
}

function booleanOption(value, key, fallback) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new TypeError(`${name}: ${key} must be a boolean`)
  return value
}

const ALLOWED_KEYS = new Set(['promoteOn', 'includeSubagents'])

/** The one-shot guidance text (near-user-message, post-promotion). */
const GUIDE_TEXT = [
  '【本会话为 enforce 验证模式】每个任务默认走验证工作流：',
  '1. create_goal 建立目标；',
  '2. set_verification_plan 声明验收标准——【AC 必须权威】：来自用户明确要求/官方测试/任务文本，不要声明可操纵的自定义 AC（v9.4 加固：冻结后不能削弱，弱声明会被 gate 卡死）；',
  '3. 真实执行（write/edit/shell 等工具调用自动捕获为证据）；',
  '4. update_goal complete——若被拒（GOAL_TRANSITION_DENIED + 缺陷清单），按缺陷修复后重试，绝不重声明弱化 AC；gate 通过才真正完成。',
].join('\n')

/** Register the post-promotion enforce-guide injector. */
export function apply(ctx, config) {
  const source = config === undefined ? {} : config
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    throw new TypeError(`${name}: config must be an object`)
  }
  const unknown = Object.keys(source).filter((key) => !ALLOWED_KEYS.has(key))
  if (unknown.length > 0) {
    throw new TypeError(
      `${name}: unknown config key(s) ${unknown.join(', ')} — allowed keys: ${[...ALLOWED_KEYS].sort().join(', ')}`,
    )
  }
  const promoteEvents = parsePromoteOn(source.promoteOn)
  const includeSubagents = booleanOption(source.includeSubagents, 'includeSubagents', false)
  const promotion = createEpochPromotion(promoteEvents, { includeSubagents })
  ctx.on('session/event', (session, event) => promotion.observe(session, event))

  /** Sessions whose guide is already durable in the event log (restart-safe). */
  const guided = new Map()
  const guideIsDurable = (session) => {
    const known = guided.get(session.id)
    if (known !== undefined) return known
    const found = (Array.isArray(session.events) ? session.events : []).some((event) =>
      event.type === 'user/message' && event.data?.source?.kind === 'enforce-guide',
    )
    guided.set(session.id, found)
    return found
  }
  ctx.on('session/event', (session, event) => {
    if (event.type === 'user/message' && event.data?.source?.kind === 'enforce-guide') {
      guided.set(session.id, true)
    }
  })

  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    try {
      if (promotion.status(agent).promoted !== true) return decision
      const session = agent.session
      if (session === undefined || guideIsDurable(session)) return decision
      guided.set(session.id, true)
      return {
        ...decision,
        batch: [...decision.batch, {
          type: 'user/message',
          data: {
            id: `enforce-guide-${session.id}`,
            source: { kind: 'enforce-guide' },
            content: [{ type: 'text', text: GUIDE_TEXT }],
          },
        }],
      }
    } catch (error) {
      console.error(`[${name}] pre-step injection failed:`, error)
      return decision
    }
  })
}
