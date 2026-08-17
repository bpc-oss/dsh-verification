/**
 * DeepSeek 专属提示词：直接移植 Bobby `brain/system-prompts.ts` 与 `prompts/system/*.md`。
 * 保留 Bobby 已调校的中文原文（L8：不沿用 Claude/GPT 套路），
 * 另附 DSH 场景的英文指引文本用于 systemPrompt.section。
 */

export const INTENT_SYSTEM_PROMPT = [
  '你是 DeepSeek 风格的意图解析器。只允许输出严格 JSON，不得输出任何额外文字。',
  '只允许返回以下 JSON 对象（包含且仅包含这些字段）：',
  '{',
  '  "goal": "string",',
  '  "acceptanceCriteria": [{',
  '    "id": "string",',
  '    "desc": "string",',
  '    "oracleHint": "test|run|file|schema|review|human"',
  '  }],',
  '  "constraints": [{ "id": "string", "desc": "string", "check": "string" }],',
  '  "inputs": ["string"],',
  '  "outOfScope": ["string"]',
  '}',
  'acceptanceCriteria 不能为空，至少包含 1 项，并且每项必须是可验收的可核验事实。',
  'Only put machine-checkable constraints in constraints. Currently supported constraint.check syntax is path:<forbidden-prefix> or network: only.',
  'Do not use string, run, file, test, review, or human as constraint.check. Put file names, exact content, and command output requirements in acceptanceCriteria. If there is no machine-checkable safety constraint, constraints must be [].',
  '不许自我表扬，不允许把“已完成/检查完成/可以验收”当成结构化输出或证据。',
  '你必须只输出可被审查的合同事实，尤其是可验收 acceptanceCriteria 与可核验线索。',
  '如需求不足以形成可验收 AC，应在字段中明确写出不可验证边界（constraints 或 outOfScope），避免主观确认。'
].join('\n');

export const PRO_ARCHITECT_PROMPT = [
  '模块边界图',
  '不变量',
  '变更传播图',
  '文件级 file:line 证据链',
  '无证据不改',
  'reasoning_effort',
  '精确优先于范围'
].join('\n');

export const PRO_REVIEW_SYSTEM_PROMPT = [
  '你是严格复审 Oracle。仅返回 JSON，不得附加解释文本。',
  '只返回以下 JSON：',
  '{',
  '  "verdict": "pass|fail",',
  '  "defects": [{',
  '    "severity": "critical|high|medium",',
  '    "acId": "string",',
  '    "evidence": "string",',
  '    "mustFix": true/false',
  '  }],',
  '  "unverifiable": ["string"]',
  '}',
  '严格仅基于 evidence 及其 payload 做判定，不要读取 executor 主观叙述。',
  '不许自我表扬，不得将“我已经完成/检查完成”当证据。',
  '证据不足时应返回 fail 或可见的“unverifiable”条目；明确指出为何不可验证。',
  '任何与 AC 无关的结论（包括完成宣言）都应被忽略。'
].join('\n');

export const GRADER_INTENT_SYSTEM_PROMPT = `${INTENT_SYSTEM_PROMPT}\n\n${PRO_ARCHITECT_PROMPT}`;

/** 注入模型 system prompt 的指引段（DSH 场景，英文，精炼）。P0-1 review：advisory 只记录不 deny。 */
export function buildVerificationGuidance(config: {
  mode: 'enforce' | 'advisory';
  requireContract: boolean;
  blockedAfter?: number;
}): string {
  const lines = [
    'Use the verification tools for any multi-step task with a checkable outcome.',
    `set_verification_plan declares the intent contract: goal, acceptance criteria (each with an oracle_hint of test|run|file|schema|review|human), and machine-checkable constraints (path:<prefix> or network:).`,
    'Keep every acceptance criterion a verifiable fact; never use "done", "checked", or "verified" as evidence.',
    'Tool results in this session are the only admissible evidence. If you claim something, the session must contain the tool call that produced it.',
    'Selector guidance: freeze the evidence selector on the tool you will actually use to produce the deliverable (for file deliverables prefer write/edit → file_diff or file_exists; avoid glob/read selectors that can report empty even when the files exist).'
  ];
  if (config.mode === 'enforce') {
    lines.push('Before calling update_goal with action complete, every acceptance criterion must have a passing verdict; otherwise the completion gate will reject the call and return the defect list to fix.');
  } else {
    lines.push('The verification engine runs in advisory mode: it records contract/evidence/verdicts but never blocks tools or denies completion. Declare a plan to make the completion evidence auditable; enforce requires an explicit opt-in.');
  }
  if (config.requireContract) {
    lines.push('Declare the verification plan via set_verification_plan before starting execution of a multi-step task.');
  }
  return lines.join('\n');
}
