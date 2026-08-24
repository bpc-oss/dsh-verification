// src/index.ts
import z3 from "@deepseek-ai/schemastery";
import { stableHash as stableHash3 } from "@bpc-oss/dsh-evidence";
import { KNOWN_SESSION_EVENT_TYPES } from "@deepseek-ai/dsh-session";

// src/complete-gate-hook.ts
var BOOTSTRAP_WHITELIST = ["create_goal", "set_verification_plan", "get_verification_plan", "reset_verification_plan"];
function renderDefects(gate) {
  return [
    "Verification gate rejected completion:",
    ...gate.reasons.map((reason) => `- ${reason}`),
    "The goal remains active. Fix the listed items, produce real tool evidence, and retry update_goal with action=complete."
  ].join("\n");
}
function installCompleteGateHook(ctx, service, config) {
  const requireContractBeforeExecution = config.requireContractBeforeExecution ?? config.mode === "enforce";
  const writeTools = config.writeTools ?? ["edit", "write", "write_file", "unlink", "rename", "mkdir", "rm", "mv", "cp", "apply_patch", "patch", "replace", "shell", "bash", "pwsh", "powershell", "exec", "terminal", "send_message", "todo_write"];
  ctx.on("tools/pre-execute", async (exec, next) => {
    const agent = exec.agent;
    if (!agent) {
      return next();
    }
    const name2 = exec.name;
    if (BOOTSTRAP_WHITELIST.includes(name2)) {
      return next();
    }
    const args = exec.arguments;
    if (name2 === "update_goal" && args?.action === "complete") {
      return handleComplete(service, config, exec, next);
    }
    const isWriteTool = writeTools.includes(name2);
    if (!isWriteTool) {
      return next();
    }
    const contract = service.getContract(agent);
    if (!contract) {
      if (service.modeOf(agent) === "enforce" && requireContractBeforeExecution) {
        return { kind: "deny", reason: "missing_contract: \u5199\u5165\u7C7B\u5DE5\u5177\uFF08write/edit/shell \u7B49\uFF09\u5DF2\u8C03\u7528\uFF0C\u4F46\u672A\u58F0\u660E\u610F\u56FE\u5951\u7EA6\uFF0C\u65E0\u6CD5\u9A8C\u8BC1\u526F\u4F5C\u7528\u3002\u8BF7\u5148 create_goal \u540E set_verification_plan\uFF0C\u6216\u58F0\u660E tools/pre-execute \u4E0D\u8981\u6C42\u5951\u7EA6\uFF08advisory\uFF09\u3002" };
      }
      return next();
    }
    if (!service.isFrozen(agent)) {
      service.freezePlan(agent, String(exec.callId));
    }
    return next();
  });
}
async function handleComplete(service, config, exec, next) {
  const agent = exec.agent;
  const contract = service.getContract(agent);
  if (!contract) {
    if (service.modeOf(agent) === "enforce") {
      return { kind: "deny", reason: "missing_contract: \u672A\u58F0\u660E\u610F\u56FE\u5951\u7EA6\uFF0C\u65E0\u6CD5\u9A8C\u8BC1\u5B8C\u6210\u3002\u8BF7\u5148 set_verification_plan\u3002" };
    }
    return next();
  }
  if (!service.isFrozen(agent)) {
    service.freezePlan(agent, String(exec.callId));
  }
  if (service.modeOf(agent) === "advisory") {
    try {
      await service.evaluateGate(agent);
    } catch (error) {
      service.commitGateError(agent, error);
    }
    return next();
  }
  let outcome;
  try {
    outcome = await service.evaluateGate(agent);
  } catch (error) {
    return { kind: "deny", reason: `evaluation_error: ${String(error)}` };
  }
  if (outcome.gate.status !== "done") {
    return { kind: "deny", reason: renderDefects(outcome.gate) };
  }
  const goalArgs = exec.arguments;
  if (goalArgs && typeof goalArgs.goal_id === "string" && typeof goalArgs.revision === "number" && Number.isSafeInteger(goalArgs.revision)) {
    await service.prepareGoalCompletion(agent, goalArgs.goal_id, goalArgs.revision);
  }
  return next();
}

// src/evidence-capture.ts
function toToolRecord(exec, result) {
  return {
    callId: String(exec.callId),
    name: exec.name,
    arguments: exec.arguments ?? {},
    isError: result.isError,
    value: result.isError ? void 0 : result.value,
    content: result.content,
    meta: result.meta
  };
}
var NETWORKLIKE_NAME = /(^|_)web|read_page|fetch|req|http|browser/i;
function isNetworkLikeTool(name2) {
  return NETWORKLIKE_NAME.test(name2) || name2.startsWith("mcp:") || name2.includes("web_search") || name2.includes("web_fetch");
}
function installEvidenceCapture(ctx, service) {
  ctx.on("tools/post-execute", (exec, result, next) => {
    const agent = exec.agent;
    if (agent) {
      const record = toToolRecord(exec, result);
      service.markToolCallHandled(agent, String(exec.callId));
      void service.captureEvidence(agent, record, agent.session.seq).catch(() => {
      });
    }
    return next();
  });
}

// src/goal-guard.ts
function installGoalTransitionGuard(ctx, service) {
  const goals = ctx.get("goals");
  if (!goals?.registerTransitionGuard) {
    return void 0;
  }
  return goals.registerTransitionGuard((request) => {
    const session = request.agent.session;
    const headerPreset = session?.header?.agentPreset;
    const meta = request.agent.meta;
    const preset = headerPreset ?? meta?.agentPreset;
    if (preset && preset !== "enforce-standard") {
      return { kind: "allow", permitRef: void 0 };
    }
    if (!preset && !service.hasVerificationActivity(request.agent)) {
      return { kind: "allow", permitRef: void 0 };
    }
    const result = service.assertCompletionPermit(request.agent, request.goalId, request.currentRevision);
    if (result.ok) {
      return { kind: "allow", permitRef: result.usedPermitRef };
    }
    return { kind: "deny", reason: result.reason };
  });
}

// src/tool-utils.ts
function compileNode(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    return {};
  }
  const record = spec;
  const type = record.type;
  const { required: _r, ...schema } = { ...record };
  if (type === "object") {
    const out = { ...schema, type: "object" };
    if (record.properties && typeof record.properties === "object") {
      const properties = {};
      const required = [];
      for (const [key, value] of Object.entries(record.properties)) {
        const node = value ?? {};
        properties[key] = compileNode(node);
        if (node.required === true) {
          required.push(key);
        }
      }
      out.properties = properties;
      if (required.length > 0) {
        out.required = required;
      }
    }
    if (out.additionalProperties === void 0) {
      out.additionalProperties = true;
    }
    return out;
  }
  if (type === "array") {
    const out = { ...schema, type: "array" };
    if (record.items !== void 0) {
      out.items = compileNode(record.items);
    }
    return out;
  }
  if (typeof type === "string") {
    return { ...schema, type };
  }
  return { ...schema };
}
function compileParameterJsonSchema(spec) {
  const properties = {};
  const required = [];
  for (const [key, value] of Object.entries(spec)) {
    const node = value ?? {};
    properties[key] = compileNode(node);
    if (node.required === true) {
      required.push(key);
    }
  }
  const out = { type: "object", properties };
  if (required.length > 0) {
    out.required = required;
  }
  return out;
}
var VerificationToolError = class extends Error {
  code;
  constructor(message, code) {
    super(message);
    this.name = "VerificationToolError";
    this.code = code;
  }
};

// src/intent.ts
function proposalOf(args) {
  return {
    goal_value: args.goal,
    acceptance_criteria: args.acceptance_criteria.map((ac) => ({
      id: ac.id,
      desc: ac.desc,
      oracleHint: ac.oracle_hint,
      ...ac.tool ? { tool: ac.tool } : {},
      ...ac.args ? { args: ac.args } : {}
    })),
    constraints: args.constraints ?? [],
    inputs: args.inputs ?? [],
    outOfScope: args.out_of_scope ?? []
  };
}
function contractReceipt(contract) {
  return {
    contract_id: contract?.ref.contractId ?? null,
    revision: contract?.ref.revision ?? null,
    origin: contract?.origin ?? null,
    goal: contract?.goal ?? null,
    acceptance_criteria: contract?.acceptanceCriteria ?? null,
    constraints: contract?.constraints ?? null
  };
}
var OPEN_OBJECT_SCHEMA = { type: "object", additionalProperties: true };
var asJson = (value) => value;
var textBlock = (value) => [{ type: "text", text: JSON.stringify(value) }];
function installIntentTools(ctx, service) {
  const setPlanDefinition = {
    name: "set_verification_plan",
    description: "Declare the intent contract bound to the active root goal (goal_id + goal_revision). The server mints the authoritative ContractRef; your proposal is advisory. Each acceptance criterion SHOULD carry a tool + args proposal that the server freezes into an exact evidence selector; criteria WITHOUT a tool+args proposal freeze no exact selector, and in enforce mode they will fail the completion gate (no bound evidence) unless a human confirmation is later bound. So declare the exact tool + args that will prove each AC BEFORE mutating work in enforce mode. Selector guidance (2026-08-17): freeze the selector on the tool you will ACTUALLY use to produce the deliverable \u2014 for file deliverables prefer write/edit (evidence type file_diff) or file_exists over glob/read; a glob that finds nothing will fail the AC even if the files exist (the engine has a file-family fallback, but an exact match on your real work tool is stronger and avoids re-verification).",
    parameters: compileParameterJsonSchema({
      goal_id: { type: "string", required: true, description: "The active root goal id (from get_goal)." },
      goal_revision: { type: "number", required: true, description: "The goal revision (from get_goal)." },
      goal: { type: "string", required: true, description: "One-sentence goal the user asked for." },
      acceptance_criteria: {
        type: "array",
        required: true,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            desc: { type: "string" },
            oracle_hint: { type: "string", enum: ["test", "run", "file", "schema", "review", "human"] },
            tool: { type: "string", description: "Tool identity whose exact output proves this AC (e.g. bash)." },
            args: { type: "object", additionalProperties: true, description: "Exact tool args for the frozen selector." }
          }
        }
      },
      constraints: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            desc: { type: "string" },
            check: { type: "string" }
          }
        }
      },
      inputs: { type: "array", items: { type: "string" } },
      out_of_scope: { type: "array", items: { type: "string" } }
    }),
    output: { schema: OPEN_OBJECT_SCHEMA, render: textBlock },
    execute: async (rawArgs, exec) => {
      const agent = exec.agent;
      if (!agent) {
        throw new VerificationToolError("set_verification_plan requires a calling agent", "VERIFICATION_AGENT_REQUIRED");
      }
      const args = rawArgs;
      const result = await service.setPlanFromProposal(agent, args.goal_id, args.goal_revision, proposalOf(args));
      if (!result.ok) {
        throw new VerificationToolError(result.reason, "VERIFICATION_PLAN_REJECTED");
      }
      return asJson(contractReceipt(result.contract));
    }
  };
  ctx.tools.register(setPlanDefinition);
  const getPlanDefinition = {
    name: "get_verification_plan",
    description: "Read the current server-minted verification plan (contract) for this session, or null.",
    parameters: compileParameterJsonSchema({
      include_evidence: {
        type: "boolean",
        description: "Include captured evidence refs in the response (optional)."
      }
    }),
    output: { schema: OPEN_OBJECT_SCHEMA, render: textBlock },
    execute: async (_rawArgs, exec) => {
      const agent = exec.agent;
      if (!agent) {
        throw new VerificationToolError("get_verification_plan requires a calling agent", "VERIFICATION_AGENT_REQUIRED");
      }
      const plan = service.getContract(agent);
      return asJson({
        plan: contractReceipt(plan),
        evidence_refs: plan ? service.getProjection(agent).evidenceRefs.slice(-20) : []
      });
    }
  };
  ctx.tools.register(getPlanDefinition);
  const resetPlanDefinition = {
    name: "reset_verification_plan",
    description: "Re-basis the verification plan within the current task epoch (new contract id + revision 0, same sourceBasis boundary). Executes immediately when called; old confirmations and old evidence are invalidated by the new identity. The confirm parameter is accepted for compatibility and does not gate the rebase. Call create_goal first / use this to fix a contract you cannot satisfy.",
    parameters: compileParameterJsonSchema({
      confirm: {
        type: "boolean",
        description: "Accepted for compatibility; the rebase executes immediately regardless (no human confirmation gate)."
      }
    }),
    output: { schema: OPEN_OBJECT_SCHEMA, render: textBlock },
    execute: async (_rawArgs, exec) => {
      const agent = exec.agent;
      if (!agent) {
        throw new VerificationToolError("reset_verification_plan requires a calling agent", "VERIFICATION_AGENT_REQUIRED");
      }
      const contract = service.resetPlan(agent);
      return asJson({ plan: contractReceipt(contract) });
    }
  };
  ctx.tools.register(resetPlanDefinition);
}

// src/binders.ts
import { CapturedEvidenceSchema, evidenceTypesCompatible, selectorKey, selectorRefOf } from "@bpc-oss/dsh-evidence";
var FILE_FAMILY_TYPES = ["file_diff", "file_exists", "quote_with_location"];
function identityMatches(ref, identity) {
  return ref.contractIdentity.contractId === identity.contractId && ref.contractIdentity.revision === identity.revision && ref.contractIdentity.contractContentHash === identity.contractContentHash && ref.contractIdentity.basisHash === identity.basisHash && ref.contractIdentity.sessionId === identity.sessionId;
}
function refMatchesSelector(ref, selector, identity) {
  return identityMatches(ref, identity) && ref.toolIdentity === selector.toolIdentity && ref.normalizedArgsHash === selector.normalizedArgsHash;
}
function failureMatchesSelector(failure, selector, identity) {
  return identityMatches(failure, identity) && failure.toolIdentity === selector.toolIdentity && failure.normalizedArgsHash === selector.normalizedArgsHash;
}
async function parseCaptured(bytes) {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    const valid = CapturedEvidenceSchema.safeParse(parsed);
    return valid.success ? valid.data : null;
  } catch {
    return null;
  }
}
async function bindSelectorForAc(ac, ctx, evidenceTypeFor, opts = {}) {
  const selector = ac.selector;
  if (!selector) {
    return { kind: "not-harnessed", reason: `AC ${ac.id} has no frozen exact selector; route to T2/T4` };
  }
  const matchingRefs = ctx.refs.filter((ref) => refMatchesSelector(ref, selector, ctx.contractIdentity));
  const matchingFailures = ctx.captureFailures.filter((failure) => failureMatchesSelector(failure, selector, ctx.contractIdentity));
  let topSeq = -1;
  let topKind;
  for (const ref of matchingRefs) {
    if (ref.resultSeq > topSeq) {
      topSeq = ref.resultSeq;
      topKind = "ref";
    }
  }
  for (const failure of matchingFailures) {
    if (failure.resultSeq > topSeq) {
      topSeq = failure.resultSeq;
      topKind = "failure";
    }
  }
  if (topKind === void 0) {
    if (opts.familyFallback) {
      const family = await bindFamilyFallback(ac, ctx, selector, opts.familyExtraHints);
      if (family !== void 0) {
        return family;
      }
    }
    return { kind: "no-evidence", reason: `AC ${ac.id}: no committed run for selector (${selector.toolIdentity}, ${selector.normalizedArgsHash.slice(0, 8)}, ${selector.evidenceType})` };
  }
  if (topKind === "failure") {
    return { kind: "capture-failure", reason: `AC ${ac.id}: latest committed run failed to capture (seq ${topSeq})` };
  }
  const chosen = matchingRefs.find((ref) => ref.resultSeq === topSeq);
  const bytes = await ctx.loadBlob(chosen.blobHash);
  if (!bytes) {
    return { kind: "missing-blob", reason: `AC ${ac.id}: blob ${chosen.blobHash.slice(0, 8)} missing/corrupt (seq ${topSeq})` };
  }
  const captured = await parseCaptured(bytes);
  if (!captured || captured.toolIdentity !== selector.toolIdentity || captured.normalizedArgsHash !== selector.normalizedArgsHash) {
    return { kind: "missing-blob", reason: `AC ${ac.id}: blob content does not match selector (seq ${topSeq})` };
  }
  const bound = {
    ...captured,
    callId: chosen.callId,
    acId: ac.id,
    selectorRef: selectorRefOf(ctx.contractIdentity, ac.id)
  };
  return { kind: "bound", evidence: bound, resultSeq: topSeq };
}
function deliverableHints(desc) {
  const out = /* @__PURE__ */ new Set();
  const tokens = desc.match(
    /[A-Za-z0-9_\-./\\]+\.(?:md|js|ts|json|py|txt|yml|yaml|toml|cfg|sh|ps1|css|html)\b|(?:docs|src|lib|config|test|scripts|build|dist|report)(?:[/\\][A-Za-z0-9_\-./\\]*)?/g
  ) ?? [];
  for (const t of tokens) {
    const norm = t.replace(/\\/g, "/");
    if (norm.length >= 3) {
      out.add(norm);
    }
  }
  return [...out];
}
function payloadPath(captured) {
  const p = captured.payload?.path;
  return typeof p === "string" ? p.replace(/\\/g, "/") : "";
}
function payloadCommand(captured) {
  const p = captured.payload?.command;
  return typeof p === "string" ? p : "";
}
var RUN_FAMILY_TYPES = ["command_output", "test_run"];
function isRunFamilyType(t) {
  return RUN_FAMILY_TYPES.includes(t);
}
var RUN_STOPWORDS = /* @__PURE__ */ new Set([
  "python",
  "shell",
  "bash",
  "pwsh",
  "powershell",
  "cmd",
  "command",
  "run",
  "output",
  "stdout",
  "stderr",
  "\u8FD0\u884C",
  "\u8F93\u51FA",
  "\u6D4B\u8BD5",
  "\u547D\u4EE4",
  "\u6267\u884C",
  "\u9A8C\u8BC1",
  "\u68C0\u67E5",
  "\u8FD4\u56DE",
  "\u7ED3\u679C",
  "test",
  "tests",
  "suite",
  "all",
  "pass",
  "passes",
  "exit",
  "code",
  "the",
  "and",
  "that",
  "with",
  "using",
  "should",
  "must"
]);
function commandHints(desc) {
  const out = /* @__PURE__ */ new Set();
  for (const m of desc.matchAll(/"([^"]{2,})"/g)) out.add(m[1].toLowerCase());
  for (const m of desc.matchAll(/'([^']{2,})'/g)) out.add(m[1].toLowerCase());
  for (const m of desc.matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)) {
    const w = m[0].toLowerCase();
    if (!RUN_STOPWORDS.has(w)) out.add(w);
  }
  return [...out];
}
async function familyCandidates(ac, ctx, selector) {
  const isFile = FILE_FAMILY_TYPES.includes(selector.evidenceType);
  const isRun = isRunFamilyType(selector.evidenceType);
  if (!isFile && !isRun) {
    return [];
  }
  const hints = isFile ? deliverableHints(ac.desc) : commandHints(ac.desc);
  const candidates = ctx.refs.filter((ref) => {
    if (!identityMatches(ref, ctx.contractIdentity)) return false;
    if (ref.toolIdentity === selector.toolIdentity && ref.normalizedArgsHash === selector.normalizedArgsHash) return false;
    if (evidenceTypesCompatible(ref.evidenceType, selector.evidenceType)) return true;
    if (isFile && ref.evidenceType === "command_output") return true;
    return false;
  }).sort((a, b) => b.resultSeq - a.resultSeq);
  const out = [];
  for (const chosen of candidates) {
    const bytes = await ctx.loadBlob(chosen.blobHash);
    if (!bytes) {
      continue;
    }
    const captured = await parseCaptured(bytes);
    if (!captured) {
      continue;
    }
    const typeOk = evidenceTypesCompatible(captured.evidenceType, selector.evidenceType) || isFile && captured.evidenceType === "command_output";
    if (!typeOk) {
      continue;
    }
    if (hints.length > 0) {
      if (isFile) {
        const cmd = payloadCommand(captured).toLowerCase();
        const pathOk = hints.some((h) => payloadPath(captured).includes(h));
        const cmdOk = cmd !== "" && hints.some((h) => cmd.includes(h));
        if (!pathOk && !cmdOk) {
          continue;
        }
      } else {
        const c = payloadCommand(captured).toLowerCase();
        if (c === "" || !hints.some((h) => c.includes(h))) {
          continue;
        }
      }
    }
    const bound = {
      ...captured,
      callId: chosen.callId,
      acId: ac.id,
      selectorRef: selectorRefOf(ctx.contractIdentity, ac.id)
    };
    out.push({ evidence: bound, resultSeq: chosen.resultSeq });
  }
  return out;
}
async function bindFamilyFallback(ac, ctx, selector, extraHints) {
  const isFile = FILE_FAMILY_TYPES.includes(selector.evidenceType);
  const isRun = isRunFamilyType(selector.evidenceType);
  if (!isFile && !isRun) {
    return void 0;
  }
  const hints = isFile ? deliverableHints(ac.desc) : [.../* @__PURE__ */ new Set([...commandHints(ac.desc), ...extraHints ?? []])];
  const candidates = ctx.refs.filter(
    (ref) => identityMatches(ref, ctx.contractIdentity) && evidenceTypesCompatible(ref.evidenceType, selector.evidenceType) && !(ref.toolIdentity === selector.toolIdentity && ref.normalizedArgsHash === selector.normalizedArgsHash)
  ).sort((a, b) => b.resultSeq - a.resultSeq);
  for (const chosen of candidates) {
    const bytes = await ctx.loadBlob(chosen.blobHash);
    if (!bytes) {
      continue;
    }
    const captured = await parseCaptured(bytes);
    if (!captured || !evidenceTypesCompatible(captured.evidenceType, selector.evidenceType)) {
      continue;
    }
    if (hints.length > 0) {
      if (isFile) {
        const p = payloadPath(captured);
        if (p === "" || !hints.some((h) => p.includes(h))) {
          continue;
        }
      } else {
        const c = payloadCommand(captured).toLowerCase();
        if (c === "" || !hints.some((h) => c.includes(h))) {
          continue;
        }
      }
    }
    const bound = {
      ...captured,
      callId: chosen.callId,
      acId: ac.id,
      selectorRef: selectorRefOf(ctx.contractIdentity, ac.id)
    };
    return { kind: "bound", evidence: bound, resultSeq: chosen.resultSeq, familyFallback: true };
  }
  return void 0;
}
function findDuplicateSelectors(acs) {
  const seen = /* @__PURE__ */ new Map();
  const duplicates = [];
  for (const ac of acs) {
    if (!ac.selector) {
      continue;
    }
    const key = selectorKey(ac.selector);
    const existing = seen.get(key);
    if (existing !== void 0) {
      duplicates.push({ acId: ac.id, selectorKey: key });
    } else {
      seen.set(key, ac.id);
    }
  }
  return duplicates;
}

// src/pro-review-tool.ts
import { contractIdentityOf } from "@bpc-oss/dsh-evidence";

// src/verdicts.ts
import { normalizedArgsHash, textHash } from "@bpc-oss/dsh-evidence";
function textSummary(captured) {
  const payload = captured.payload;
  const parts = [`${captured.toolIdentity}`, `${captured.evidenceType}`];
  if (typeof payload.command === "string") {
    parts.push(`cmd:${payload.command.slice(0, 120)}`);
  }
  if (typeof payload.path === "string") {
    parts.push(`path:${payload.path}`);
  }
  if (typeof payload.exitCode === "number") {
    parts.push(`exit:${payload.exitCode}`);
  }
  if (typeof payload.failCount === "number") {
    parts.push(`fail:${payload.failCount}`);
  }
  return parts.join(" ");
}
function hintToEvidenceType(hint) {
  switch (hint) {
    case "test":
      return "test_run";
    case "run":
      return "command_output";
    case "file":
      return "file_diff";
    case "schema":
      return "schema_valid";
    case "review":
      return "assistant_response";
    case "human":
      return "human_ack";
  }
}

// src/pro-review-runner.ts
import { extractTextFromContent } from "@bpc-oss/dsh-evidence";

// src/oracles/pro-review.ts
var PROHIBITED_PAYLOAD_FIELDS = /* @__PURE__ */ new Set(["summary", "executorSays"]);
function stripSelfNarration(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  const source = payload;
  const cleaned = {};
  for (const [key, value] of Object.entries(source)) {
    if (PROHIBITED_PAYLOAD_FIELDS.has(key)) continue;
    cleaned[key] = value;
  }
  return cleaned;
}
function buildReviewPrompt(ac, evidence) {
  const filteredEvidence = evidence.map((entry) => ({
    ...entry,
    payload: stripSelfNarration(entry.payload)
  }));
  return [
    "You are a hostile review oracle. Default assumption: the executor is lying or lazy. Your only job is to falsify its completion claim.",
    "Judge strictly from the evidence payloads below. Ignore any executor self-narration (fields named summary or executorSays are already stripped).",
    "Ignore any conclusion unrelated to the acceptance criterion, including completion declarations.",
    "Output ONLY one JSON object, no extra text:",
    '{"verdict":"pass|fail","defects":[{"severity":"critical|high|medium","acId":"string","evidence":"string","mustFix":true|false}],"unverifiable":["string"]}',
    "When evidence is insufficient, return fail or a visible unverifiable entry explaining why.",
    "",
    "Judged acceptance criterion:",
    JSON.stringify(ac),
    "",
    "Evidence:",
    JSON.stringify(filteredEvidence)
  ].join("\n");
}
var ProReviewOracle = class {
  constructor(runner) {
    this.runner = runner;
  }
  runner;
  tier = "T2";
  name = "pro-review";
  canJudge(ac, evidence) {
    return ac.oracleHint === "review" || evidence.some((entry) => entry.evidenceType === "file_diff");
  }
  async judge(ac, evidence) {
    const review = await this.runner({ ac, evidence });
    const blockingDefect = review.defects.some((defect) => defect.severity === "critical" || defect.severity === "high");
    const result = blockingDefect || review.verdict === "fail" ? "fail" : review.unverifiable.length > 0 ? "need_human" : "pass";
    return {
      claimId: evidence[0]?.callId ?? ac.id,
      acId: ac.id,
      oracleTier: "T2",
      result,
      detail: result === "pass" ? void 0 : JSON.stringify(review)
    };
  }
};

// src/pro-review-runner.ts
var REVIEW_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "defects", "unverifiable"],
  properties: {
    verdict: { type: "string", enum: ["pass", "fail"] },
    defects: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "acId", "evidence", "mustFix"],
        properties: {
          severity: { type: "string", enum: ["critical", "high", "medium"] },
          acId: { type: "string" },
          evidence: { type: "string" },
          mustFix: { type: "boolean" }
        }
      }
    },
    unverifiable: { type: "array", items: { type: "string" } }
  }
};
function isReviewOutput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value;
  return (record.verdict === "pass" || record.verdict === "fail") && Array.isArray(record.defects) && Array.isArray(record.unverifiable);
}
function providerHasAuthorityIsolation(ctx, providerName) {
  const subagents = ctx.get("subagents");
  if (!subagents) {
    return false;
  }
  const provider = subagents.getProvider(providerName);
  if (!provider) {
    return false;
  }
  return (provider.inheritsParentContext === false || provider.inheritsParentContext === void 0) && Boolean(provider.capabilities?.authorityIsolation);
}
function createSubagentProReviewRunner(ctx, options) {
  return async (input) => {
    const subagents = ctx.get("subagents");
    if (!subagents) {
      throw new Error("verification: subagents service is not mounted; cannot run pro-review");
    }
    if (!providerHasAuthorityIsolation(ctx, options.provider)) {
      throw new Error(`verification: provider ${options.provider} lacks authorityIsolation; T2 unavailable (need_evidence)`);
    }
    const run = await subagents.start(options.provider, {
      label: "pro-review",
      prompt: [{ type: "text", text: buildReviewPrompt(input.ac, input.evidence) }],
      parent: options.agent,
      signal: options.signal ?? new AbortController().signal,
      outputSchema: REVIEW_OUTPUT_SCHEMA
    });
    try {
      const result = await run.result;
      if (result.stopReason !== "completed") {
        throw new Error(`pro-review run ${result.stopReason}`);
      }
      if (result.structured !== void 0 && isReviewOutput(result.structured)) {
        return result.structured;
      }
      const text = extractTextFromContent(result.output);
      if (text.length === 0) {
        throw new Error(`pro-review subagent returned no output (stop: ${result.stopReason})`);
      }
      const parsed = JSON.parse(text);
      if (!isReviewOutput(parsed)) {
        throw new Error("pro-review subagent returned malformed review JSON");
      }
      return parsed;
    } finally {
      await run.dispose();
    }
  };
}

// src/pro-review-tool.ts
var OPEN_OBJECT_SCHEMA2 = { type: "object", additionalProperties: true };
var textBlock2 = (value) => [{ type: "text", text: JSON.stringify(value) }];
function installProReviewTool(ctx, service, provider) {
  const definition = {
    name: "pro_review",
    description: "Run an adversarial Pro review of the current session evidence for one acceptance criterion (or the whole plan) and return the structured review. Use it to double-check a claim before completion, or after the completion gate rejects you.",
    parameters: compileParameterJsonSchema({
      ac_id: { type: "string", description: "Acceptance criterion id to review; omit to review every criterion in the plan." }
    }),
    output: { schema: OPEN_OBJECT_SCHEMA2, render: textBlock2 },
    execute: async (rawArgs, exec) => {
      const agent = exec.agent;
      if (!agent) {
        throw new VerificationToolError("pro_review requires a calling agent", "VERIFICATION_AGENT_REQUIRED");
      }
      const contract = service.getContract(agent);
      if (!contract) {
        throw new VerificationToolError("no verification plan declared; call set_verification_plan first", "VERIFICATION_NO_PLAN");
      }
      const acId = rawArgs.ac_id;
      const acs = acId ? contract.acceptanceCriteria.filter((ac) => ac.id === acId) : [...contract.acceptanceCriteria];
      if (acId !== void 0 && acs.length === 0) {
        throw new VerificationToolError(`unknown acceptance criterion: ${acId}`, "VERIFICATION_UNKNOWN_AC");
      }
      const identity = contractIdentityOf(contract);
      const projection = service.getProjection(agent);
      const runner = createSubagentProReviewRunner(ctx, { provider, agent });
      const reviews = [];
      for (const ac of acs) {
        const outcome = await bindSelectorForAc(
          ac,
          {
            contractIdentity: identity,
            refs: projection.evidenceRefs,
            captureFailures: projection.captureFailures,
            loadBlob: async (key) => service.readBlob(key)
          },
          (ac2) => hintToEvidenceType(ac2.oracleHint)
        );
        if (outcome.kind !== "bound") {
          reviews.push({ acId: ac.id, verdict: "fail", defects: [], unverifiable: [outcome.reason] });
          continue;
        }
        const review = await runner({ ac, evidence: [outcome.evidence] });
        reviews.push({ acId: ac.id, verdict: review.verdict, defects: review.defects, unverifiable: review.unverifiable });
      }
      return { reviews };
    }
  };
  ctx.tools.register(definition);
}

// src/prompts.ts
var INTENT_SYSTEM_PROMPT = [
  "\u4F60\u662F DeepSeek \u98CE\u683C\u7684\u610F\u56FE\u89E3\u6790\u5668\u3002\u53EA\u5141\u8BB8\u8F93\u51FA\u4E25\u683C JSON\uFF0C\u4E0D\u5F97\u8F93\u51FA\u4EFB\u4F55\u989D\u5916\u6587\u5B57\u3002",
  "\u53EA\u5141\u8BB8\u8FD4\u56DE\u4EE5\u4E0B JSON \u5BF9\u8C61\uFF08\u5305\u542B\u4E14\u4EC5\u5305\u542B\u8FD9\u4E9B\u5B57\u6BB5\uFF09\uFF1A",
  "{",
  '  "goal": "string",',
  '  "acceptanceCriteria": [{',
  '    "id": "string",',
  '    "desc": "string",',
  '    "oracleHint": "test|run|file|schema|review|human"',
  "  }],",
  '  "constraints": [{ "id": "string", "desc": "string", "check": "string" }],',
  '  "inputs": ["string"],',
  '  "outOfScope": ["string"]',
  "}",
  "acceptanceCriteria \u4E0D\u80FD\u4E3A\u7A7A\uFF0C\u81F3\u5C11\u5305\u542B 1 \u9879\uFF0C\u5E76\u4E14\u6BCF\u9879\u5FC5\u987B\u662F\u53EF\u9A8C\u6536\u7684\u53EF\u6838\u9A8C\u4E8B\u5B9E\u3002",
  "Only put machine-checkable constraints in constraints. Currently supported constraint.check syntax is path:<forbidden-prefix> or network: only.",
  "Do not use string, run, file, test, review, or human as constraint.check. Put file names, exact content, and command output requirements in acceptanceCriteria. If there is no machine-checkable safety constraint, constraints must be [].",
  "\u4E0D\u8BB8\u81EA\u6211\u8868\u626C\uFF0C\u4E0D\u5141\u8BB8\u628A\u201C\u5DF2\u5B8C\u6210/\u68C0\u67E5\u5B8C\u6210/\u53EF\u4EE5\u9A8C\u6536\u201D\u5F53\u6210\u7ED3\u6784\u5316\u8F93\u51FA\u6216\u8BC1\u636E\u3002",
  "\u4F60\u5FC5\u987B\u53EA\u8F93\u51FA\u53EF\u88AB\u5BA1\u67E5\u7684\u5408\u540C\u4E8B\u5B9E\uFF0C\u5C24\u5176\u662F\u53EF\u9A8C\u6536 acceptanceCriteria \u4E0E\u53EF\u6838\u9A8C\u7EBF\u7D22\u3002",
  "\u5982\u9700\u6C42\u4E0D\u8DB3\u4EE5\u5F62\u6210\u53EF\u9A8C\u6536 AC\uFF0C\u5E94\u5728\u5B57\u6BB5\u4E2D\u660E\u786E\u5199\u51FA\u4E0D\u53EF\u9A8C\u8BC1\u8FB9\u754C\uFF08constraints \u6216 outOfScope\uFF09\uFF0C\u907F\u514D\u4E3B\u89C2\u786E\u8BA4\u3002"
].join("\n");
var PRO_ARCHITECT_PROMPT = [
  "\u6A21\u5757\u8FB9\u754C\u56FE",
  "\u4E0D\u53D8\u91CF",
  "\u53D8\u66F4\u4F20\u64AD\u56FE",
  "\u6587\u4EF6\u7EA7 file:line \u8BC1\u636E\u94FE",
  "\u65E0\u8BC1\u636E\u4E0D\u6539",
  "reasoning_effort",
  "\u7CBE\u786E\u4F18\u5148\u4E8E\u8303\u56F4"
].join("\n");
var PRO_REVIEW_SYSTEM_PROMPT = [
  "\u4F60\u662F\u4E25\u683C\u590D\u5BA1 Oracle\u3002\u4EC5\u8FD4\u56DE JSON\uFF0C\u4E0D\u5F97\u9644\u52A0\u89E3\u91CA\u6587\u672C\u3002",
  "\u53EA\u8FD4\u56DE\u4EE5\u4E0B JSON\uFF1A",
  "{",
  '  "verdict": "pass|fail",',
  '  "defects": [{',
  '    "severity": "critical|high|medium",',
  '    "acId": "string",',
  '    "evidence": "string",',
  '    "mustFix": true/false',
  "  }],",
  '  "unverifiable": ["string"]',
  "}",
  "\u4E25\u683C\u4EC5\u57FA\u4E8E evidence \u53CA\u5176 payload \u505A\u5224\u5B9A\uFF0C\u4E0D\u8981\u8BFB\u53D6 executor \u4E3B\u89C2\u53D9\u8FF0\u3002",
  "\u4E0D\u8BB8\u81EA\u6211\u8868\u626C\uFF0C\u4E0D\u5F97\u5C06\u201C\u6211\u5DF2\u7ECF\u5B8C\u6210/\u68C0\u67E5\u5B8C\u6210\u201D\u5F53\u8BC1\u636E\u3002",
  "\u8BC1\u636E\u4E0D\u8DB3\u65F6\u5E94\u8FD4\u56DE fail \u6216\u53EF\u89C1\u7684\u201Cunverifiable\u201D\u6761\u76EE\uFF1B\u660E\u786E\u6307\u51FA\u4E3A\u4F55\u4E0D\u53EF\u9A8C\u8BC1\u3002",
  "\u4EFB\u4F55\u4E0E AC \u65E0\u5173\u7684\u7ED3\u8BBA\uFF08\u5305\u62EC\u5B8C\u6210\u5BA3\u8A00\uFF09\u90FD\u5E94\u88AB\u5FFD\u7565\u3002"
].join("\n");
var GRADER_INTENT_SYSTEM_PROMPT = `${INTENT_SYSTEM_PROMPT}

${PRO_ARCHITECT_PROMPT}`;
function buildVerificationGuidance(config) {
  const lines = [
    "Use the verification tools for any multi-step task with a checkable outcome.",
    `set_verification_plan declares the intent contract: goal, acceptance criteria (each with an oracle_hint of test|run|file|schema|review|human), and machine-checkable constraints (path:<prefix> or network:).`,
    'Keep every acceptance criterion a verifiable fact; never use "done", "checked", or "verified" as evidence.',
    "Tool results in this session are the only admissible evidence. If you claim something, the session must contain the tool call that produced it.",
    "Selector guidance: freeze the evidence selector on the tool you will actually use to produce the deliverable (for file deliverables prefer write/edit \u2192 file_diff or file_exists; avoid glob/read selectors that can report empty even when the files exist)."
  ];
  if (config.mode === "enforce") {
    lines.push("Before calling update_goal with action complete, every acceptance criterion must have a passing verdict; otherwise the completion gate will reject the call and return the defect list to fix.");
  } else {
    lines.push("The verification engine runs in advisory mode: it records contract/evidence/verdicts but never blocks tools or denies completion. Declare a plan to make the completion evidence auditable; enforce requires an explicit opt-in.");
  }
  if (config.requireContract) {
    lines.push("Declare the verification plan via set_verification_plan before starting execution of a multi-step task.");
  }
  return lines.join("\n");
}

// src/service.ts
import { Service } from "@deepseek-ai/cordis";
import { TaskContractSchema as TaskContractSchema2, deriveCaptured } from "@bpc-oss/dsh-evidence";
import { identitiesEqual } from "@bpc-oss/dsh-evidence";
import { z as z2 } from "zod";

// src/contract-authority.ts
import { randomUUID } from "crypto";
import { stableHash, textHash as textHash2 } from "@bpc-oss/dsh-evidence";
import { computeBasisHash, computeContractContentHash } from "@bpc-oss/dsh-evidence";
var MAX_SOURCE_BASIS_ENTRIES = 200;
var BasisTooLargeError = class extends Error {
  constructor(count) {
    super(`sourceBasis exceeds maxEntries ${MAX_SOURCE_BASIS_ENTRIES} (got ${count}); split the task`);
    this.name = "BasisTooLargeError";
  }
};
function collectBasisEntries(messages) {
  if (messages.length > MAX_SOURCE_BASIS_ENTRIES) {
    throw new BasisTooLargeError(messages.length);
  }
  return messages.map((message) => ({
    kind: "user-message",
    eventRef: message.eventRef,
    seq: message.seq,
    text: message.text
  })).sort((a, b) => a.seq - b.seq);
}
function materializeBasis(sessionId, entries) {
  return {
    sessionId,
    entries: entries.map((entry) => ({
      kind: entry.kind,
      eventRef: entry.eventRef,
      seq: entry.seq,
      contentHash: textHash2(entry.text)
    })),
    basisHash: computeBasisHash(
      sessionId,
      entries.map((entry) => ({
        kind: entry.kind,
        eventRef: entry.eventRef,
        seq: entry.seq,
        contentHash: textHash2(entry.text)
      }))
    )
  };
}
function basisPromptText(entries) {
  return entries.map((entry) => `[${entry.kind} @seq${entry.seq}] ${entry.text}`).join("\n\n");
}
function mintContract(options) {
  const contentBody = {
    goal: options.goal,
    acceptanceCriteria: options.acceptanceCriteria,
    constraints: options.constraints,
    inputs: options.inputs,
    outOfScope: options.outOfScope
  };
  const contractContentHash = options.contentHashOverride ?? computeContractContentHash(contentBody);
  const sourceBasis = materializeBasis(options.sessionId, options.basis);
  const contractId = stableHash({
    kind: "verification-contract",
    sessionId: options.sessionId,
    contractContentHash,
    basisHash: sourceBasis.basisHash,
    revision: 0
  });
  return {
    ref: {
      contractId,
      revision: 0,
      contractContentHash,
      sourceBasis
    },
    origin: options.origin,
    ...contentBody
  };
}
function rebaseContract(previous) {
  const contentBody = {
    goal: previous.goal,
    acceptanceCriteria: previous.acceptanceCriteria,
    constraints: previous.constraints,
    inputs: previous.inputs,
    outOfScope: previous.outOfScope
  };
  const contractContentHash = computeContractContentHash(contentBody);
  const contractId = stableHash({
    kind: "verification-contract",
    sessionId: previous.ref.sourceBasis.sessionId,
    contractContentHash,
    basisHash: previous.ref.sourceBasis.basisHash,
    revision: 0,
    rebased: randomUUID()
  });
  return {
    ref: {
      contractId,
      revision: 0,
      contractContentHash,
      sourceBasis: previous.ref.sourceBasis
    },
    origin: previous.origin,
    ...contentBody
  };
}
function createContractChallenge(contract, questionId) {
  return { questionId, contract };
}

// src/service.ts
import { contractIdentityOf as contractIdentityOf2 } from "@bpc-oss/dsh-evidence";

// src/constraints.ts
function isMachineCheckableConstraintCheck(check) {
  return check.startsWith("path:") || check.startsWith("network:");
}
var NoForbiddenPathChecker = class {
  matches(c) {
    return c.check.startsWith("path:");
  }
  check(c, ctx) {
    const prefix = c.check.slice("path:".length);
    const hit = ctx.touchedPaths.find((path) => path.startsWith(prefix));
    return hit ? { id: c.id, result: "fail", detail: `Forbidden path touched: ${hit}` } : { id: c.id, result: "pass" };
  }
};
var NoNetworkChecker = class {
  matches(c) {
    return c.check.startsWith("network:");
  }
  check(c, ctx) {
    const calls = ctx.networkCalls ?? [];
    return calls.length > 0 ? { id: c.id, result: "fail", detail: `Network calls detected: ${calls.join(", ")}` } : { id: c.id, result: "pass" };
  }
};
function enforceConstraints(constraints, ctx, checkers) {
  return constraints.map((constraint) => {
    const checker = checkers.find((c) => c.matches(constraint));
    if (!checker) {
      return { id: constraint.id, result: "need_human", detail: `No machine checker for constraint: ${constraint.check}` };
    }
    return checker.check(constraint, ctx);
  });
}
var DEFAULT_CHECKERS = [new NoForbiddenPathChecker(), new NoNetworkChecker()];

// src/grader-parse.ts
var GraderParseError = class extends Error {
  constructor(message, rawSample) {
    super(message);
    this.rawSample = rawSample;
    this.name = "GraderParseError";
  }
  rawSample;
};
function extractJsonCandidates(raw) {
  const out = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        const candidate = raw.slice(start, i + 1);
        try {
          out.push(JSON.parse(candidate));
        } catch {
        }
        start = -1;
      }
    }
  }
  return out;
}

// src/oracle.ts
var ORDER = ["T0", "T1", "T2", "T3", "T4"];
function tierRank(tier) {
  return ORDER.indexOf(tier);
}
function stampVerdict(body, identity) {
  return { ...body, contractIdentity: identity };
}

// src/engine.ts
var VerificationEngine = class {
  constructor(oracles) {
    this.oracles = oracles;
  }
  oracles;
  async verify(ac, evidence, contractIdentity) {
    const boundEvidence = evidence.filter((entry) => entry.acId === ac.id);
    const usableOracles = this.oracles.filter((oracle) => oracle.canJudge(ac, boundEvidence)).sort((a, b) => tierRank(a.tier) - tierRank(b.tier));
    if (usableOracles.length === 0) {
      throw new Error(`no oracle can judge AC ${ac.id}`);
    }
    return stampVerdict(await usableOracles[0].judge(ac, boundEvidence), contractIdentity);
  }
};

// src/evidence-store.ts
import { mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { MAX_EVIDENCE_PAYLOAD_BYTES, contentHash } from "@bpc-oss/dsh-evidence";
function createMemoryBlobStore() {
  const map = /* @__PURE__ */ new Map();
  return {
    async write(bytes) {
      const key = contentHash(bytes);
      map.set(key, bytes);
      return key;
    },
    async read(key) {
      return map.get(key) ?? null;
    },
    async has(key) {
      return map.has(key);
    },
    async delete(key) {
      map.delete(key);
    }
  };
}
function createFileBlobStore(dir) {
  return {
    async write(bytes) {
      const key = contentHash(bytes);
      const target = join(dir, key);
      const tmp = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
      await mkdir(dir, { recursive: true });
      await writeFile(tmp, Buffer.from(bytes));
      await rename(tmp, target);
      return key;
    },
    async read(key) {
      try {
        const data = await readFile(join(dir, key));
        if (contentHash(new Uint8Array(data)) !== key) {
          return null;
        }
        return new Uint8Array(data);
      } catch {
        return null;
      }
    },
    async has(key) {
      const data = await this.read(key);
      return data !== null;
    },
    async delete(key) {
      await rm(join(dir, key), { force: true });
    }
  };
}
async function storePayload(store, payload, maxBytes = MAX_EVIDENCE_PAYLOAD_BYTES) {
  const text = JSON.stringify(payload);
  const raw = new TextEncoder().encode(text);
  const rawHash = contentHash(raw);
  if (raw.byteLength <= maxBytes) {
    const blobKey2 = await store.write(raw);
    return { blobKey: blobKey2, originalLength: raw.byteLength, rawHash, truncated: false, completeness: "complete" };
  }
  const truncatedText = text.slice(0, maxBytes);
  const truncated = new TextEncoder().encode(truncatedText);
  const blobKey = await store.write(truncated);
  return { blobKey, originalLength: raw.byteLength, rawHash, truncated: true, completeness: "truncated" };
}

// src/gate.ts
var CompletionGate = class {
  evaluate(contract, verdicts, constraints) {
    const reasons = [];
    let failed = false;
    let blocked = false;
    for (const ac of contract.acceptanceCriteria) {
      const verdict = verdicts.get(ac.id);
      if (!verdict) {
        failed = true;
        reasons.push(`Missing verdict for AC ${ac.id}`);
        continue;
      }
      if (verdict.result === "fail") {
        failed = true;
        reasons.push(`AC ${ac.id} failed: ${verdict.detail ?? "no details provided"}`);
      } else if (verdict.result === "need_human") {
        blocked = true;
        reasons.push(`AC ${ac.id} needs human confirmation`);
      }
    }
    for (const constraint of constraints) {
      if (constraint.result === "fail") {
        failed = true;
        reasons.push(`Constraint ${constraint.id} failed: ${constraint.detail ?? "no details provided"}`);
      } else if (constraint.result === "need_human") {
        blocked = true;
        reasons.push(`Constraint ${constraint.id} needs human confirmation`);
      }
    }
    return {
      status: failed ? "failed" : blocked ? "blocked" : "done",
      reasons
    };
  }
};

// src/intent-consensus.ts
async function runStructuredConsensus(input) {
  const validCandidates = [];
  let firstError;
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
          ...response.reasoningContent ? { reasoningContent: response.reasoningContent } : {},
          canonical,
          index,
          votes: 1
        });
      }
    } catch (error) {
      if (firstError === void 0) {
        firstError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }
  if (validCandidates.length === 0) {
    return {
      kind: "all_invalid",
      error: firstError ?? new Error("structuredConsensus: no valid candidates")
    };
  }
  validCandidates.sort((left, right) => {
    if (right.votes !== left.votes) {
      return right.votes - left.votes;
    }
    return left.index - right.index;
  });
  const winner = validCandidates[0];
  return {
    kind: "success",
    value: winner.value,
    content: winner.content,
    ...winner.reasoningContent ? { reasoningContent: winner.reasoningContent } : {}
  };
}
function stableCanonicalJson(value) {
  return JSON.stringify(sortCanonicalValue(value));
}
function sortCanonicalValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortCanonicalValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, sortCanonicalValue(entry)])
    );
  }
  return value;
}

// src/llm/call.ts
function textBlock3(text) {
  return { type: "text", text };
}
function assembleStream(chunks) {
  let text = "";
  let reasoning = "";
  for (const chunk of chunks) {
    if (chunk.type === "text-delta") {
      text += chunk.text;
    } else if (chunk.type === "reasoning-delta") {
      reasoning += chunk.text;
    }
  }
  return { text, reasoning };
}
async function completeText(ctx, options) {
  const llm = ctx.get("llm");
  if (!llm) {
    throw new Error("verification: llm service is not mounted");
  }
  const request = {
    provider: options.provider,
    model: options.model,
    messages: options.messages.map((message) => ({
      id: `verification-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      role: message.role,
      content: [textBlock3(message.text)],
      source: { kind: "plugin", plugin: "dsh-verification" }
    })),
    ...options.system !== void 0 ? { system: options.system } : {},
    ...options.temperature !== void 0 ? { temperature: options.temperature } : {},
    ...options.maxTokens !== void 0 ? { maxTokens: options.maxTokens } : {},
    ...options.stop !== void 0 ? { stop: options.stop } : {},
    ...options.signal !== void 0 ? { signal: options.signal } : {}
  };
  let usage;
  let finished = false;
  const collected = [];
  for await (const chunk of llm.stream(request)) {
    if (chunk.type === "usage") {
      usage = chunk.usage;
    }
    if (chunk.type === "finish") {
      finished = true;
    }
    collected.push(chunk);
  }
  if (!finished) {
    throw new Error("verification: llm stream ended without a finish chunk");
  }
  const { text, reasoning } = assembleStream(collected);
  return {
    text,
    ...reasoning.length > 0 ? { reasoning } : {},
    ...usage !== void 0 ? { usage } : {}
  };
}

// src/oracles/assistant-response.ts
var AssistantResponseOracle = class {
  tier = "T3";
  name = "assistant-response";
  canJudge(ac, evidence) {
    return ac.oracleHint === "review" && evidence.some((entry) => entry.evidenceType === "assistant_response");
  }
  async judge(ac, evidence) {
    const responseEvidence = evidence.find((entry) => entry.evidenceType === "assistant_response");
    const payload = responseEvidence?.payload ?? {};
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    const pass = text.length > 0;
    return {
      claimId: responseEvidence?.callId ?? ac.id,
      acId: ac.id,
      oracleTier: "T3",
      result: pass ? "pass" : "fail",
      detail: pass ? void 0 : "assistant response evidence is empty"
    };
  }
};

// src/oracles/deterministic.ts
function contentOf(payload) {
  if (typeof payload.content === "string" && payload.content.length > 0) {
    return payload.content;
  }
  if (typeof payload.quote === "string" && payload.quote.length > 0) {
    return payload.quote;
  }
  return void 0;
}
function extractExactText(desc) {
  const quoted = desc.match(/exactly\s+(?:the\s+(?:text|string)\s+)?['"`]([^'"`]+)['"`]/i);
  if (quoted?.[1] !== void 0) {
    return quoted[1];
  }
  const bare = desc.match(/exactly\s+([A-Za-z0-9._-]+)(?=[\s).,;:]|$)/i);
  return bare?.[1];
}
function extractContainsText(desc) {
  const quoted = desc.match(/(?:contain(?:s|ing)?|include(?:s|ing)?)\s+(?:the\s+(?:word|text|string)\s+)?(["'`])([^"'`]+)\1/i);
  if (quoted?.[2] !== void 0 && quoted[2].length > 0) {
    return quoted[2];
  }
  const bare = desc.match(/(?:contain(?:s|ing)?|include(?:s|ing)?)\s+(?:the\s+(?:word|text|string)\s+)?([A-Za-z0-9._-]*)/i);
  if (bare?.[1] !== void 0 && bare[1].length > 0) {
    return bare[1];
  }
  return void 0;
}
function exactStdoutFailure(payload, expected) {
  if (expected === void 0) {
    return false;
  }
  return payload.stdout !== expected;
}
var CommandExitOracle = class {
  tier = "T0";
  name = "command-exit";
  canJudge(_ac, evidence) {
    return evidence.some((entry) => entry.evidenceType === "command_output");
  }
  async judge(ac, evidence) {
    const commandEvidences = evidence.filter((entry) => entry.evidenceType === "command_output");
    const expected = extractExactText(ac.desc);
    const firstBadEvidence = commandEvidences.find((entry) => {
      const payload = entry.payload ?? {};
      return typeof payload.exitCode !== "number" || payload.exitCode !== 0 || exactStdoutFailure(payload, expected);
    });
    const pass = commandEvidences.length > 0 && firstBadEvidence === void 0;
    return {
      claimId: commandEvidences[0]?.callId ?? ac.id,
      acId: ac.id,
      oracleTier: "T0",
      result: pass ? "pass" : "fail",
      detail: this.detail(pass, firstBadEvidence, expected)
    };
  }
  detail(pass, firstBadEvidence, expected) {
    if (pass) {
      return void 0;
    }
    if (expected !== void 0) {
      return `stdout did not match exact expected text ${JSON.stringify(expected)}: ${JSON.stringify(firstBadEvidence?.payload ?? {})}`;
    }
    return `command output indicates non-zero or missing exitCode: ${JSON.stringify(firstBadEvidence?.payload ?? {})}`;
  }
};
var FileExistsOracle = class {
  tier = "T0";
  name = "file-exists";
  canJudge(_ac, evidence) {
    return evidence.some((entry) => entry.evidenceType === "file_exists");
  }
  async judge(ac, evidence) {
    const fileEvidences = evidence.filter((entry) => entry.evidenceType === "file_exists");
    const firstBadEvidence = fileEvidences.find((entry) => {
      const payload = entry.payload ?? {};
      return payload.exists !== true;
    });
    const pass = fileEvidences.length > 0 && firstBadEvidence === void 0;
    return {
      claimId: fileEvidences[0]?.callId ?? ac.id,
      acId: ac.id,
      oracleTier: "T0",
      result: pass ? "pass" : "fail",
      detail: pass ? void 0 : `file existence check failed: ${JSON.stringify(firstBadEvidence?.payload ?? {})}`
    };
  }
};
var FileDiffOracle = class {
  tier = "T0";
  name = "file-diff";
  canJudge(_ac, evidence) {
    return evidence.some(
      (entry) => entry.evidenceType === "file_diff" || entry.evidenceType === "quote_with_location" || entry.evidenceType === "command_output"
      // v9.4：pwsh Set-Content/Test-Path 等文件操作产出 command_output
    );
  }
  /** 从 AC 描述提取路径 token（v9.4：command_output 证据的路径对齐用）。 */
  pathHints(desc) {
    const out = /* @__PURE__ */ new Set();
    for (const m of desc.matchAll(/[A-Za-z0-9_\-./\\]+\.(?:md|js|ts|json|py|txt|yml|yaml|toml|cfg|sh|ps1|css|html)\b|(?:[a-z0-9_\-]+)\.(?:txt|md|js|json|py)\b/gi)) {
      const norm = m[0].replace(/\\/g, "/").toLowerCase();
      if (norm.length >= 3) out.add(norm);
    }
    return [...out];
  }
  async judge(ac, evidence) {
    const fileEvidences = evidence.filter(
      (entry) => entry.evidenceType === "file_diff" || entry.evidenceType === "quote_with_location"
    );
    const expected = extractExactText(ac.desc);
    const contains = expected === void 0 ? extractContainsText(ac.desc) : void 0;
    const fileEvidencesOrCmd = fileEvidences.length > 0 ? fileEvidences : evidence.filter((entry) => {
      if (entry.evidenceType !== "command_output") return false;
      const payload = entry.payload ?? {};
      if (typeof payload.command !== "string" || payload.exitCode !== 0) return false;
      const hints = this.pathHints(ac.desc);
      if (hints.length === 0) return true;
      const cmd = payload.command.toLowerCase();
      if (!hints.some((h) => cmd.includes(h))) return false;
      if (expected !== void 0) {
        return typeof payload.stdout === "string" && payload.stdout.includes(expected);
      }
      if (contains !== void 0) {
        return typeof payload.stdout === "string" && payload.stdout.includes(contains);
      }
      return true;
    });
    const firstBadEvidence = fileEvidencesOrCmd.find((entry) => {
      const payload = entry.payload ?? {};
      if (typeof payload.path !== "string" || payload.path.trim().length === 0) {
        if (entry.evidenceType === "command_output") return false;
        return true;
      }
      const hasBytes = typeof payload.bytes === "number" && Number.isFinite(payload.bytes) && payload.bytes > 0;
      const hasDiff = typeof payload.diff === "string" && payload.diff.length > 0;
      const content = contentOf(payload);
      if (!hasBytes && !hasDiff && content === void 0) {
        return true;
      }
      if (expected !== void 0) {
        return content !== expected;
      }
      if (contains !== void 0) {
        return content === void 0 || !content.includes(contains);
      }
      return false;
    });
    const pass = fileEvidencesOrCmd.length > 0 && firstBadEvidence === void 0;
    return {
      claimId: fileEvidencesOrCmd[0]?.callId ?? ac.id,
      acId: ac.id,
      oracleTier: "T0",
      result: pass ? "pass" : "fail",
      detail: this.detail(pass, firstBadEvidence, expected)
    };
  }
  detail(pass, firstBadEvidence, expected) {
    if (pass) {
      return void 0;
    }
    if (expected !== void 0) {
      return `file content did not match exact expected text ${JSON.stringify(expected)}: ${JSON.stringify(firstBadEvidence?.payload ?? {})}`;
    }
    return `file evidence check failed: ${JSON.stringify(firstBadEvidence?.payload ?? {})}`;
  }
};

// src/oracles/run-based.ts
var TestRunOracle = class {
  tier = "T0";
  name = "test-run";
  canJudge(ac, evidence) {
    return evidence.some((entry) => entry.evidenceType === "test_run");
  }
  async judge(ac, evidence) {
    const testEvidences = evidence.filter((entry) => entry.evidenceType === "test_run");
    const firstBad = testEvidences.find((entry) => {
      const payload = entry.payload ?? {};
      if (payload.exitCode !== 0) {
        return true;
      }
      return typeof payload.failCount === "number" && payload.failCount > 0;
    });
    const pass = testEvidences.length > 0 && firstBad === void 0;
    return {
      claimId: testEvidences[0]?.callId ?? ac.id,
      acId: ac.id,
      oracleTier: "T0",
      result: pass ? "pass" : "fail",
      detail: pass ? void 0 : `test run indicates failure: ${JSON.stringify(firstBad?.payload ?? {})}`
    };
  }
};
var SchemaValidOracle = class {
  tier = "T0";
  name = "schema-valid";
  canJudge(ac, evidence) {
    return evidence.some((entry) => entry.evidenceType === "schema_valid");
  }
  async judge(ac, evidence) {
    const schemaEvidences = evidence.filter((entry) => entry.evidenceType === "schema_valid");
    const firstBad = schemaEvidences.find((entry) => {
      const payload = entry.payload ?? {};
      return payload.valid !== true;
    });
    const pass = schemaEvidences.length > 0 && firstBad === void 0;
    return {
      claimId: schemaEvidences[0]?.callId ?? ac.id,
      acId: ac.id,
      oracleTier: "T0",
      result: pass ? "pass" : "fail",
      detail: pass ? void 0 : `schema validation failed: ${JSON.stringify(firstBad?.payload ?? {})}`
    };
  }
};
var CoverageOracle = class {
  tier = "T3";
  name = "coverage";
  canJudge(ac, evidence) {
    return ac.oracleHint === "file" && evidence.some((entry) => entry.evidenceType === "file_diff" || entry.evidenceType === "file_exists");
  }
  async judge(ac, evidence) {
    const fileEvidences = evidence.filter(
      (entry) => entry.evidenceType === "file_diff" || entry.evidenceType === "file_exists"
    );
    const pass = fileEvidences.length > 0;
    return {
      claimId: fileEvidences[0]?.callId ?? ac.id,
      acId: ac.id,
      oracleTier: "T3",
      result: pass ? "pass" : "fail",
      detail: pass ? void 0 : "no file evidence recorded for this acceptance criterion"
    };
  }
};

// src/permits.ts
import { stableHash as stableHash2 } from "@bpc-oss/dsh-evidence";
function newPermitRef() {
  return `permit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function computeGateSnapshotHash(input) {
  return stableHash2({
    contractIdentity: input.contractIdentity,
    verdicts: input.verdicts,
    evidenceBlobHashes: input.evidenceBlobHashes,
    captureFailures: input.captureFailures,
    configHash: input.configHash,
    schemaVersion: input.schemaVersion
  });
}
function validatePermitForCompletion(input) {
  if (!input.completed.permitRef) {
    return { ok: false, reason: "strict-replay: complete event has no permitRef" };
  }
  const latest = input.permits.find((entry) => entry.record.permitRef === input.completed.permitRef);
  if (!latest) {
    return { ok: false, reason: `strict-replay: referenced permit ${input.completed.permitRef} does not exist` };
  }
  if (latest.record.goalId !== input.completed.goalId || latest.record.goalRevision !== input.completed.goalRevision) {
    return { ok: false, reason: "strict-replay: referenced permit goal or revision drift" };
  }
  if (latest.seq >= input.completed.completeSeq) {
    return { ok: false, reason: `strict-replay: permit (seq ${latest.seq}) must precede complete (seq ${input.completed.completeSeq})` };
  }
  const policy = input.policies[latest.record.configHash];
  if (!policy) {
    return { ok: false, reason: `strict-replay: unknown configHash ${latest.record.configHash}` };
  }
  if (latest.record.ttlMs !== policy.completionPermitTtlMs) {
    return {
      ok: false,
      reason: `strict-replay: ttlMs ${latest.record.ttlMs} does not match frozen policy ${policy.completionPermitTtlMs} for configHash ${latest.record.configHash}`
    };
  }
  const derivedExpiresAt = latest.time + policy.completionPermitTtlMs;
  if (latest.time > input.completed.completeTime || input.completed.completeTime > derivedExpiresAt) {
    return {
      ok: false,
      reason: `strict-replay: complete time ${input.completed.completeTime} outside permit window [${latest.time}, ${derivedExpiresAt}]`
    };
  }
  const identityMatches2 = latest.record.contractIdentity.contractId === input.contractIdentity.contractId && latest.record.contractIdentity.revision === input.contractIdentity.revision && latest.record.contractIdentity.contractContentHash === input.contractIdentity.contractContentHash && latest.record.contractIdentity.basisHash === input.contractIdentity.basisHash && latest.record.contractIdentity.sessionId === input.contractIdentity.sessionId;
  if (!identityMatches2) {
    return { ok: false, reason: "strict-replay: permit contract identity drift" };
  }
  if (latest.record.gateSnapshotHash !== input.gateSnapshotHash) {
    return { ok: false, reason: "strict-replay: permit gate snapshot drift (evidence/verdicts/config changed after permit minted)" };
  }
  return { ok: true, permitSeq: latest.seq, usedPermitRef: latest.record.permitRef };
}

// src/projection.ts
import { z } from "zod";
import {
  ContractIdentitySchema,
  EvidenceTypeSchema,
  VerdictSchema
} from "@bpc-oss/dsh-evidence";
import { TaskContractSchema } from "@bpc-oss/dsh-evidence";
var VERIFICATION_CHANGE_VERSION = 1;
var AuthorityScopeSchema = z.object({
  epochId: z.string().min(1),
  rootGoalId: z.string().min(1),
  ownerAgentId: z.string().min(1)
}).strict();
var PolicyFactsSchema = z.object({
  paths: z.array(z.string()),
  networkCalls: z.array(z.string())
}).strict();
var TaskEpochRecordSchema = z.object({
  epochId: z.string().min(1),
  rootSeq: z.number().int().min(0),
  contentHash: z.string().optional(),
  rootGoalId: z.string().optional(),
  status: z.enum(["active", "closed"]),
  createdSeq: z.number().int().min(0),
  closedSeq: z.number().int().min(0).optional()
}).strict();
function taskEpochViews(epochs) {
  return epochs.map((epoch) => ({
    epochId: epoch.epochId,
    rootSeq: epoch.rootSeq,
    rootGoalId: epoch.rootGoalId,
    status: epoch.status,
    createdSeq: epoch.createdSeq,
    ...epoch.closedSeq !== void 0 ? { closedSeq: epoch.closedSeq } : {}
  }));
}
var VerificationPlanViewSchema = z.object({
  contract: TaskContractSchema,
  authorityScope: AuthorityScopeSchema.optional(),
  frozenAt: z.object({ callId: z.string().min(1), at: z.number() }).optional()
}).strict();
var EvidenceRefSchema = z.object({
  callId: z.string().min(1),
  toolIdentity: z.string().min(1),
  normalizedArgsHash: z.string().min(1),
  blobHash: z.string().min(1),
  truncated: z.boolean(),
  originalLength: z.number().int().min(0),
  schemaVersion: z.number().int().min(1),
  contractIdentity: ContractIdentitySchema,
  evidenceType: EvidenceTypeSchema,
  resultSeq: z.number().int().min(0),
  summary: z.string(),
  authorityScope: AuthorityScopeSchema.optional(),
  policyFacts: PolicyFactsSchema.optional()
}).strict();
var CaptureFailureRecordSchema = z.object({
  kind: z.literal("capture-failure").optional(),
  contractIdentity: ContractIdentitySchema,
  callId: z.string().min(1),
  toolIdentity: z.string().min(1),
  normalizedArgsHash: z.string().min(1),
  evidenceType: EvidenceTypeSchema,
  resultSeq: z.number().int().min(0),
  error: z.string(),
  authorityScope: AuthorityScopeSchema.optional(),
  policyFacts: PolicyFactsSchema.optional()
}).strict();
var ChallengeRecordSchema = z.object({
  kind: z.literal("challenge").optional(),
  questionId: z.string().min(1),
  challengeKind: z.enum(["contract", "completion"]),
  identity: ContractIdentitySchema,
  gateSnapshotHash: z.string().optional(),
  consumed: z.boolean(),
  authorityScope: AuthorityScopeSchema.optional()
}).strict();
var CompletionPermitRecordSchema = z.object({
  kind: z.literal("permit").optional(),
  permitRef: z.string().min(1),
  goalId: z.string().min(1),
  goalRevision: z.number().int().min(1),
  contractIdentity: ContractIdentitySchema,
  gateSnapshotHash: z.string().min(1),
  configHash: z.string().min(1),
  ttlMs: z.number().int().min(1),
  authorityScope: AuthorityScopeSchema.optional()
}).strict();
var GateSummarySchema = z.object({
  at: z.number(),
  status: z.enum(["done", "failed", "blocked"]),
  mode: z.enum(["enforce", "advisory"]),
  reasons: z.array(z.string()),
  authorityScope: AuthorityScopeSchema.optional()
}).strict();
var VerificationRecordSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("plan"), contract: TaskContractSchema, authorityScope: AuthorityScopeSchema.optional(), frozenAt: z.object({ callId: z.string().min(1), at: z.number() }).optional() }).strict(),
  z.object({ kind: z.literal("evidence"), callId: z.string().min(1), toolIdentity: z.string().min(1), normalizedArgsHash: z.string().min(1), blobHash: z.string().min(1), originalLength: z.number().int().min(0), rawHash: z.string().min(1), truncated: z.boolean(), completeness: z.enum(["complete", "truncated"]), schemaVersion: z.number().int().min(1), contractIdentity: ContractIdentitySchema, evidenceType: EvidenceTypeSchema, resultSeq: z.number().int().min(0), summary: z.string(), authorityScope: AuthorityScopeSchema.optional(), policyFacts: PolicyFactsSchema.optional() }).strict(),
  z.object({ kind: z.literal("capture-failure"), contractIdentity: ContractIdentitySchema, callId: z.string().min(1), toolIdentity: z.string().min(1), normalizedArgsHash: z.string().min(1), evidenceType: EvidenceTypeSchema, resultSeq: z.number().int().min(0), error: z.string(), authorityScope: AuthorityScopeSchema.optional(), policyFacts: PolicyFactsSchema.optional() }).strict(),
  z.object({ kind: z.literal("challenge"), questionId: z.string().min(1), challengeKind: z.enum(["contract", "completion"]), identity: ContractIdentitySchema, gateSnapshotHash: z.string().optional(), consumed: z.boolean(), authorityScope: AuthorityScopeSchema.optional() }).strict(),
  z.object({ kind: z.literal("permit"), permitRef: z.string().min(1), goalId: z.string().min(1), goalRevision: z.number().int().min(1), contractIdentity: ContractIdentitySchema, gateSnapshotHash: z.string().min(1), configHash: z.string().min(1), ttlMs: z.number().int().min(1), authorityScope: AuthorityScopeSchema.optional() }).strict(),
  z.object({ kind: z.literal("verdicts"), verdicts: z.record(z.string(), VerdictSchema), authorityScope: AuthorityScopeSchema.optional() }).strict(),
  z.object({ kind: z.literal("gate"), entry: GateSummarySchema }).strict()
]);
var VerificationProjectionSchema = z.object({
  taskEpochs: z.array(TaskEpochRecordSchema),
  plan: VerificationPlanViewSchema.nullable(),
  evidenceRefs: z.array(EvidenceRefSchema),
  captureFailures: z.array(CaptureFailureRecordSchema),
  challenges: z.record(z.string(), ChallengeRecordSchema),
  completionPermits: z.array(CompletionPermitRecordSchema),
  verdicts: z.record(z.string(), VerdictSchema),
  verdictAuthorityScope: AuthorityScopeSchema.nullable(),
  gateLog: z.array(GateSummarySchema),
  updatedAt: z.number()
});
function emptyVerificationProjection() {
  return {
    taskEpochs: [],
    plan: null,
    evidenceRefs: [],
    captureFailures: [],
    challenges: {},
    completionPermits: [],
    verdicts: {},
    verdictAuthorityScope: null,
    gateLog: [],
    updatedAt: 0
  };
}
function applyVerificationRecord(state, record, eventMetadata) {
  switch (record.kind) {
    case "plan":
      return { ...state, plan: { contract: record.contract, authorityScope: record.authorityScope, ...record.frozenAt ? { frozenAt: record.frozenAt } : {} }, updatedAt: eventMetadata.time };
    case "evidence":
      return {
        ...state,
        evidenceRefs: [
          ...state.evidenceRefs,
          {
            callId: record.callId,
            toolIdentity: record.toolIdentity,
            normalizedArgsHash: record.normalizedArgsHash,
            blobHash: record.blobHash,
            truncated: record.truncated,
            originalLength: record.originalLength,
            schemaVersion: record.schemaVersion,
            contractIdentity: record.contractIdentity,
            evidenceType: record.evidenceType,
            resultSeq: record.resultSeq,
            summary: record.summary,
            authorityScope: record.authorityScope,
            policyFacts: record.policyFacts
          }
        ],
        updatedAt: eventMetadata.time
      };
    case "capture-failure":
      return { ...state, captureFailures: [...state.captureFailures, { ...record }], updatedAt: eventMetadata.time };
    case "challenge":
      return {
        ...state,
        challenges: { ...state.challenges, [record.questionId]: { ...record } },
        updatedAt: eventMetadata.time
      };
    case "permit":
      return {
        ...state,
        completionPermits: [...state.completionPermits, { ...record }],
        updatedAt: eventMetadata.time
      };
    case "verdicts":
      return { ...state, verdicts: { ...record.verdicts }, verdictAuthorityScope: record.authorityScope ?? null, updatedAt: eventMetadata.time };
    case "gate":
      return { ...state, gateLog: [...state.gateLog, { ...record.entry }], updatedAt: eventMetadata.time };
  }
}
function extractVerificationRecords(events) {
  const out = [];
  for (const event of events) {
    if (event.type !== "verification/change") {
      continue;
    }
    const data = z.object({ kind: z.literal("verification/change"), version: z.literal(VERIFICATION_CHANGE_VERSION), record: VerificationRecordSchema }).strict().safeParse(event.data);
    if (!data.success) {
      throw new Error(`invalid verification/change at seq ${event.seq}: ${data.error.message}`);
    }
    out.push({ record: data.data.record, seq: event.seq, time: event.time });
  }
  return out;
}
function foldVerificationRecords(state, records) {
  let next = state;
  for (const { record, seq, time } of records) {
    next = applyVerificationRecord(next, record, { seq, time });
  }
  return next;
}
function gateResultOf(entry) {
  return { status: entry.status, reasons: entry.reasons };
}

// src/task-epoch.ts
import { deriveEpochId } from "@bpc-oss/dsh-evidence";
function asGoalChange(data) {
  if (!data || typeof data !== "object") {
    return void 0;
  }
  return data;
}
function isAuthoritativeUserMessage(event) {
  if (event.type !== "user/message") {
    return false;
  }
  const data = event.data;
  return data?.source?.kind === "user";
}
function lastCloseBoundary(epochs, eventSeq) {
  let boundary = -1;
  for (const epoch of epochs) {
    if (epoch.status === "closed" && epoch.closedSeq !== void 0 && epoch.closedSeq < eventSeq) {
      boundary = Math.max(boundary, epoch.closedSeq);
    }
  }
  return boundary;
}
function foldTaskEpochs(events, sessionId) {
  const epochs = [];
  let active;
  for (const event of events) {
    if (event.type === "goal/change") {
      const change = asGoalChange(event.data);
      if (change?.operation === "create" && change.goal?.id) {
        if (active && active.status === "active") {
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
          rootSeq = event.seq;
        }
        const epoch = {
          epochId: deriveEpochId(sessionId, change.goal.id, event.seq),
          rootSeq,
          rootGoalId: change.goal.id,
          createdSeq: event.seq,
          status: "active"
        };
        epochs.push(epoch);
        active = epoch;
      } else if (active && active.status === "active" && (change?.operation === "complete" || change?.operation === "clear") && (change.goal?.id === active.rootGoalId || change.cleared?.id === active.rootGoalId)) {
        active = { ...active, status: "closed", closedSeq: event.seq };
        const index = epochs.findIndex((epoch) => epoch.epochId === active.epochId);
        if (index >= 0) {
          epochs[index] = active;
        }
      }
    }
  }
  return epochs;
}
function currentActiveEpoch(epochs) {
  return [...epochs].reverse().find((epoch) => epoch.status === "active");
}
function emptyIncrementalEpochState() {
  return { epochs: [], lastUserSeqOutsideActive: -1 };
}
function applyEpochEvent(state, event, sessionId) {
  if (event.type === "user/message" && isAuthoritativeUserMessage(event)) {
    const active2 = currentActiveEpoch(state.epochs);
    if (!active2 || active2.status === "closed") {
      return { ...state, lastUserSeqOutsideActive: event.seq };
    }
    return state;
  }
  if (event.type !== "goal/change") {
    return state;
  }
  const change = asGoalChange(event.data);
  if (change?.operation === "create" && change.goal?.id) {
    if (currentActiveEpoch(state.epochs)) {
      return state;
    }
    const rootSeq = state.lastUserSeqOutsideActive >= 0 ? state.lastUserSeqOutsideActive : event.seq;
    const epoch = {
      epochId: deriveEpochId(sessionId, change.goal.id, event.seq),
      rootSeq,
      rootGoalId: change.goal.id,
      createdSeq: event.seq,
      status: "active"
    };
    return { epochs: [...state.epochs, epoch], lastUserSeqOutsideActive: -1 };
  }
  const active = currentActiveEpoch(state.epochs);
  if (active && active.status === "active" && (change?.operation === "complete" || change?.operation === "clear") && (change.goal?.id === active.rootGoalId || change.cleared?.id === active.rootGoalId)) {
    const closed = { ...active, status: "closed", closedSeq: event.seq };
    return {
      epochs: state.epochs.map((epoch) => epoch.epochId === closed.epochId ? closed : epoch),
      lastUserSeqOutsideActive: state.lastUserSeqOutsideActive
    };
  }
  return state;
}

// src/service.ts
var FILE_FAMILY_TYPES2 = ["file_diff", "file_exists", "quote_with_location"];
var RUN_FAMILY_TYPES2 = ["command_output", "test_run"];
function isFileFamilyAc(ac) {
  if (ac.oracleHint === "file") {
    return true;
  }
  const t = ac.selector?.evidenceType;
  return t !== void 0 && FILE_FAMILY_TYPES2.includes(t);
}
function isRunFamilyAc(ac) {
  if (ac.oracleHint === "run" || ac.oracleHint === "test") {
    return true;
  }
  const t = ac.selector?.evidenceType;
  return t !== void 0 && RUN_FAMILY_TYPES2.includes(t);
}
var VerificationError = class extends Error {
  code;
  constructor(message, code) {
    super(message);
    this.name = "VerificationError";
    this.code = code;
  }
};
function normalizeGraderBody(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const record = value;
  const out = { ...record };
  if (out.acceptance_criteria !== void 0 && out.acceptanceCriteria === void 0) {
    out.acceptanceCriteria = out.acceptance_criteria;
  }
  if (Array.isArray(out.acceptanceCriteria)) {
    out.acceptanceCriteria = out.acceptanceCriteria.map((ac) => {
      if (ac === null || typeof ac !== "object") {
        return ac;
      }
      const acRecord = { ...ac };
      if (acRecord.oracle_hint !== void 0 && acRecord.oracleHint === void 0) {
        acRecord.oracleHint = acRecord.oracle_hint;
      }
      return acRecord;
    });
  }
  return out;
}
var GraderBodySchema = z2.object({
  goal: z2.string().min(1),
  acceptanceCriteria: z2.array(
    z2.object({
      id: z2.string().min(1),
      desc: z2.string().min(1),
      oracleHint: z2.enum(["test", "run", "file", "schema", "review", "human"])
    })
  ).min(1),
  constraints: z2.array(z2.object({ id: z2.string().min(1), desc: z2.string().min(1), check: z2.string().min(1) })).default([]),
  inputs: z2.array(z2.string()).default([]),
  outOfScope: z2.array(z2.string()).default([])
});
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function normalizePolicyPath(value) {
  const slash = value.replace(/\\/g, "/").replace(/\/+/g, "/");
  const absolute = slash.startsWith("/") || /^[A-Za-z]:\//.test(slash);
  const prefix = /^[A-Za-z]:\//.test(slash) ? slash.slice(0, 3) : slash.startsWith("/") ? "/" : "";
  const parts = [];
  for (const part of slash.slice(prefix.length).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
      else if (!absolute) parts.push("..");
      else parts.push("..");
      continue;
    }
    parts.push(part);
  }
  return `${prefix}${parts.join("/")}` || (absolute ? prefix : ".");
}
function policyFactsFor(record) {
  const path = ["path", "file_path", "filepath", "file", "target"].map((key) => record.arguments[key]).find((value) => typeof value === "string" && value.length > 0);
  const endpoint = ["url", "host"].map((key) => record.arguments[key]).find((value) => typeof value === "string" && value.length > 0);
  return { paths: path ? [normalizePolicyPath(path)] : [], networkCalls: isNetworkLikeTool(record.name) ? [endpoint ?? record.name] : [] };
}
function stripUndefined(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stripUndefined(entry));
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== void 0) {
        out[key] = stripUndefined(entry);
      }
    }
    return out;
  }
  return value;
}
function authoritativeUserMessages(session) {
  const out = [];
  for (const event of session.events) {
    if (event.type !== "user/message") {
      continue;
    }
    const data = event.data;
    if (data?.source?.kind !== "user") {
      continue;
    }
    const text = (data.content ?? []).filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("").trim();
    if (text.length > 0) {
      out.push({ eventRef: String(event.seq), seq: event.seq, text });
    }
  }
  return out;
}
function currentGoalSnapshot(events, goalId) {
  let snapshot;
  for (const event of events) {
    if (event.type !== "goal/change") {
      continue;
    }
    const data = event.data;
    if (data?.goal?.id === goalId) {
      snapshot = { id: data.goal.id, revision: data.goal.revision, phase: data.goal.phase };
    }
    if (data?.operation === "clear" && data.cleared?.id === goalId) {
      snapshot = void 0;
    }
  }
  return snapshot;
}
function parseDurableToolCall(event) {
  if (event.type !== "tool/call") {
    return null;
  }
  const data = event.data;
  if (typeof data.callId !== "string" || data.callId.length === 0 || typeof data.name !== "string") {
    return null;
  }
  let args = {};
  if (typeof data.arguments === "string") {
    try {
      const parsed = JSON.parse(data.arguments);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        args = parsed;
      }
    } catch {
    }
  } else if (data.arguments !== null && typeof data.arguments === "object") {
    args = data.arguments;
  }
  return { callId: data.callId, name: data.name, args, seq: event.seq };
}
var VerificationService = class extends Service {
  constructor(ctx, config, deps = {}) {
    super(ctx, "verification");
    this.config = config;
    this.store = deps.store ?? createMemoryBlobStore();
    this.clock = deps.clock ?? Date.now;
  }
  config;
  static inject = ["agents"];
  caches = /* @__PURE__ */ new WeakMap();
  store;
  clock;
  /** 最近一次独立捕获失败的根因（供 enforce 拒绝信息 — S1-2：origin 标签诚实 + 失败显式化）。 */
  captureUnavailableReason;
  /** S3-4：会话内"已处理（在途/成功/失败）"的可采集 callId —— 对账对它们免于误报。 */
  handledCallsBySession = /* @__PURE__ */ new WeakMap();
  // ── 状态访问 ────────────────────────────────────────────────
  /** S3-4 对账重入保护：commit → cache() → sync 的递归有界（每次只落一条缺口）。 */
  reconciling = false;
  cache(agent) {
    let cache = this.caches.get(agent.session);
    if (!cache) {
      cache = { observedSeq: 0, projection: emptyVerificationProjection(), epochSeq: 0, epochs: [], calls: /* @__PURE__ */ new Map(), contractPlanSeq: -1, reconciledSeq: 0 };
      this.caches.set(agent.session, cache);
    }
    this.sync(agent, cache);
    return cache;
  }
  sync(agent, cache) {
    if (cache.observedSeq < agent.session.seq) {
      const slice = agent.session.events.slice(cache.observedSeq).map((e) => ({ type: e.type, data: e.data, seq: e.seq, time: e.time }));
      cache.projection = foldVerificationRecords(cache.projection, extractVerificationRecords(slice));
      for (const event of slice) {
        if (event.type === "verification/change") {
          const record = event.data.record;
          if (record?.kind === "plan" && record.contract) {
            cache.contractPlanSeq = event.seq;
          }
        }
        if (event.type === "tool/call") {
          const parsed = parseDurableToolCall(event);
          if (parsed) {
            cache.calls.set(parsed.callId, parsed);
          }
        }
      }
      cache.observedSeq = agent.session.seq;
    }
    this.reconcileDurableCalls(agent, cache);
    if (cache.epochSeq < agent.session.seq || cache.epochs.length === 0) {
      cache.epochs = foldTaskEpochs(
        agent.session.events.map((e) => ({ type: e.type, data: e.data, seq: e.seq, time: e.time })),
        agent.session.id
      );
      cache.epochSeq = agent.session.seq;
    }
  }
  allEvents(agent) {
    return agent.session.events.map((e) => ({ type: e.type, data: e.data, seq: e.seq, time: e.time }));
  }
  getProjection(agent) {
    return this.cache(agent).projection;
  }
  getActiveEpoch(agent) {
    return currentActiveEpoch(this.cache(agent).epochs);
  }
  /**
   * 2026-08-19（enforce preset 审查发现）：agent 是否参与过验证系统（会话里有 verification/change 事件）。
   * goal transition guard 是进程级全局（GOAL_TRANSITION_GUARDS），enforce 实例的 guard 会拦截
   * 所有会话的 complete；用此方法把"从未使用验证的会话"（其他 preset）放行，避免 enforce 泄漏到全局。
   */
  hasVerificationActivity(agent) {
    return this.allEvents(agent).some((event) => event.type === "verification/change");
  }
  /**
   * 2026-08-20（enforce preset）：per-agent 生效模式。
   * 引擎保持全局（advisory），但 agentPreset === 'enforce-standard' 的会话按 enforce 处理——
   * preset 不再挂载第二个引擎实例（loader 挂载机制 + 全局实例共存问题），
   * 只靠 agentPreset 激活 enforce 语义（gate 拦截 + guard 强制）。
   * agentPreset 位于 session.header.agentPreset（会话创建头，resolveSessionPreset 读取），
   * 非 agent 顶层/meta 字段（2026-08-20 两次修正后确定）。
   */
  modeOf(agent) {
    const session = agent.session;
    const headerPreset = session?.header?.agentPreset;
    if (headerPreset === "enforce-standard") {
      return "enforce";
    }
    const meta = agent.meta;
    if (meta?.agentPreset === "enforce-standard") {
      return "enforce";
    }
    return this.config.mode;
  }
  requireCurrentAuthorityScope(agent) {
    const epoch = this.getActiveEpoch(agent);
    if (!epoch) {
      throw new VerificationError(
        "missing_authority_scope: no active task epoch\u3002\u5F15\u5BFC\uFF1A\u8BF7\u5148\u8C03\u7528 create_goal \u5EFA\u7ACB\u76EE\u6807\uFF08\u5EFA\u8BAE\u5728\u4E00\u6761\u7528\u6237\u6D88\u606F\u4E4B\u540E\u8BA9\u6A21\u578B\u521B\u5EFA\uFF09\uFF0C\u518D set_verification_plan \u58F0\u660E\u5951\u7EA6\uFF1Badvisory \u6A21\u5F0F\u53EF\u8DF3\u8FC7\u58F0\u660E\u76F4\u63A5\u6267\u884C\u3002",
        "VERIFICATION_MISSING_ROOT_GOAL"
      );
    }
    return { epochId: epoch.epochId, rootGoalId: epoch.rootGoalId, ownerAgentId: String(agent.id) };
  }
  getPlanView(agent) {
    const plan = this.cache(agent).projection.plan;
    if (!plan) return null;
    let scope;
    try {
      scope = this.requireCurrentAuthorityScope(agent);
    } catch (error) {
      if (error instanceof VerificationError && error.code === "VERIFICATION_MISSING_ROOT_GOAL") {
        return null;
      }
      throw error;
    }
    return plan.authorityScope !== void 0 && plan.authorityScope.epochId === scope.epochId && plan.authorityScope.rootGoalId === scope.rootGoalId && plan.authorityScope.ownerAgentId === scope.ownerAgentId ? plan : null;
  }
  /** 公开 blob 读取（pro_review / 工具用）。 */
  async readBlob(key) {
    return this.store.read(key);
  }
  getContract(agent) {
    return this.getPlanView(agent)?.contract ?? null;
  }
  isFrozen(agent) {
    return this.getPlanView(agent)?.frozenAt !== void 0;
  }
  /**
   * 2026-08-18 加固（live enforce 演示暴露）：agent 可在 update_goal edit 后重声明契约、
   * 删除/弱化已冻结的验收标准（demo：删掉 output_file AC，让错交付物通过）。
   * 返回同 rootGoalId 下**最新一条 frozenAt 的契约**（agent 已承诺执行过的基准）。
   */
  latestFrozenContractForGoal(agent, rootGoalId) {
    let latest = null;
    for (const event of agent.session.events) {
      if (event.type !== "verification/change") {
        continue;
      }
      const record = event.data.record;
      if (record?.kind === "plan" && record.frozenAt && record.authorityScope?.rootGoalId === rootGoalId && record.contract) {
        latest = record.contract;
      }
    }
    return latest;
  }
  // ── epoch / contract ────────────────────────────────────────
  requireGoalBoundEpoch(agent, goalId, goalRevision) {
    const active = this.getActiveEpoch(agent);
    if (!active) {
      throw new VerificationError(
        "missing_root_goal: no active root goal; create_goal must establish the task epoch\u3002\u5F15\u5BFC\uFF1A\u5148\u53D1\u4E00\u6761\u6D88\u606F\u8BF4\u660E\u4EFB\u52A1\uFF0C\u518D\u8BA9\u6A21\u578B\u8C03\u7528 create_goal\uFF0C\u7136\u540E set_verification_plan \u7ED1\u5B9A\u9A8C\u6536\u6807\u51C6\u3002",
        "VERIFICATION_MISSING_ROOT_GOAL"
      );
    }
    if (active.rootGoalId !== goalId) {
      throw new VerificationError(
        `missing_root_goal: active root goal is ${active.rootGoalId}, not ${goalId}\u3002\u5F15\u5BFC\uFF1Aset_verification_plan \u5FC5\u987B\u9488\u5BF9\u5F53\u524D\u6D3B\u8DC3\u76EE\u6807\u8C03\u7528\uFF0C\u8BF7\u5148 get_goal \u786E\u8BA4\u5F53\u524D\u76EE\u6807 id \u4E0E revision\u3002`,
        "VERIFICATION_MISSING_ROOT_GOAL"
      );
    }
    const snapshot = currentGoalSnapshot(agent.session.events, goalId);
    if (!snapshot || snapshot.revision !== goalRevision || snapshot.phase === "complete") {
      throw new VerificationError(
        `stale_revision: goal ${goalId} current revision ${snapshot?.revision ?? "none"} != ${goalRevision}`,
        "VERIFICATION_STALE_REVISION"
      );
    }
    return active;
  }
  collectSourceBasis(agent) {
    const active = this.getActiveEpoch(agent);
    if (!active) {
      return [];
    }
    const messages = authoritativeUserMessages(agent.session).filter((message) => message.seq >= active.rootSeq);
    const entries = messages.map((message) => ({
      kind: "user-message",
      eventRef: message.eventRef,
      seq: message.seq,
      text: message.text
    }));
    if (entries.length > this.config.intent.maxEntries) {
      throw new VerificationError(`sourceBasis exceeds maxEntries ${this.config.intent.maxEntries}`, "VERIFICATION_BASIS_TOO_LARGE");
    }
    return entries;
  }
  /** set_verification_plan：提案 → 服务端冻结 selector → 独立捕获/人类确认 → mint + attach。 */
  async setPlanFromProposal(agent, goalId, goalRevision, proposal) {
    try {
      this.requireGoalBoundEpoch(agent, goalId, goalRevision);
    } catch (error) {
      return { ok: false, reason: errorMessage(error) };
    }
    if (this.modeOf(agent) === "enforce") {
      const epoch = this.getActiveEpoch(agent);
      if (epoch) {
        const prior = this.latestFrozenContractForGoal(agent, epoch.rootGoalId);
        if (prior && prior.acceptanceCriteria.length > 0) {
          const newAcs = proposal.acceptance_criteria;
          const missing = [];
          for (const old of prior.acceptanceCriteria) {
            const match = newAcs.find(
              (ac) => ac.desc === old.desc && ac.oracleHint === old.oracleHint && (!old.selector || Boolean(ac.tool && ac.args))
            );
            if (!match) {
              missing.push(`${old.desc.slice(0, 60)}${old.selector ? ` [witness: ${old.selector.toolIdentity}]` : ""}`);
            }
          }
          if (missing.length > 0) {
            return {
              ok: false,
              reason: `enforce: re-declared contract cannot weaken the committed (frozen) contract \u2014 missing or weakened acceptance criteria: ${missing.join(" | ")}. A goal edit cannot drop verification criteria; fix the deliverable instead (or route re-baseline through human confirmation).`
            };
          }
        }
      }
    }
    let basis;
    try {
      basis = this.collectSourceBasis(agent);
    } catch (error) {
      return { ok: false, reason: errorMessage(error) };
    }
    const acs = proposal.acceptance_criteria.map((ac) => {
      const frozen = { id: ac.id, desc: ac.desc, oracleHint: ac.oracleHint };
      if (ac.tool && ac.args) {
        frozen.selector = {
          schemaVersion: 1,
          toolIdentity: ac.tool,
          normalizedArgsHash: normalizedArgsHash(ac.args),
          evidenceType: hintToEvidenceType(ac.oracleHint)
        };
      }
      return frozen;
    });
    const duplicates = findDuplicateSelectors(acs);
    if (duplicates.length > 0) {
      return { ok: false, reason: `duplicate exact selector on ${duplicates.map((d) => d.acId).join(", ")}` };
    }
    let body = {
      goal: proposal.goal_value,
      acceptanceCriteria: acs,
      constraints: proposal.constraints,
      inputs: proposal.inputs,
      outOfScope: proposal.outOfScope
    };
    let origin = this.config.intent.contractOrigin;
    if (this.config.intent.contractOrigin === "independent-capture") {
      let captured = null;
      const captureAttempts = this.modeOf(agent) === "enforce" ? 3 : 1;
      for (let attempt = 0; attempt < captureAttempts && captured === null; attempt += 1) {
        captured = await this.tryIndependentCapture(
          agent,
          basis,
          proposal.acceptance_criteria.map((ac) => ({ id: ac.id, tool: ac.tool, args: ac.args }))
        );
        if (captured === null && attempt + 1 < captureAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      if (captured) {
        body = captured;
        origin = "independent-capture";
        const byId = new Map(acs.map((ac) => [ac.id, ac]));
        body = {
          ...body,
          acceptanceCriteria: body.acceptanceCriteria.map((ac) => {
            const proposed = byId.get(ac.id);
            if (proposed?.selector) {
              return { ...ac, selector: proposed.selector };
            }
            return ac;
          })
        };
      } else if (this.modeOf(agent) === "enforce") {
        return {
          ok: false,
          reason: `independent-capture unavailable after ${captureAttempts} attempt(s) (${this.captureUnavailableReason ?? "grader returned no consensus"}); enforce mode requires an authoritative contract (independent-capture) or a human-confirmed one \u2014 fix intent.provider/model or route to human-confirmed`
        };
      } else {
        origin = "model-self-declared";
      }
    } else if (this.config.intent.contractOrigin === "human-confirmed") {
      if (this.config.askUser) {
        origin = "human-confirmed";
      } else if (this.modeOf(agent) === "enforce") {
        return {
          ok: false,
          reason: "contract origin human-confirmed requires an askUser confirmation channel, but none is mounted; enforce mode cannot mint an authoritative contract \u2014 mount a confirmation channel or switch to independent-capture"
        };
      } else {
        origin = "model-self-declared";
      }
    } else {
      origin = "model-self-declared";
    }
    const contract = mintContract({
      sessionId: agent.session.id,
      origin,
      ...body,
      basis
    });
    const valid = TaskContractSchema2.safeParse(contract);
    if (!valid.success) {
      return { ok: false, reason: `invalid contract: ${errorMessage(valid.error)}` };
    }
    if (this.config.intent.contractOrigin === "human-confirmed" && this.config.askUser) {
      const questionId = `verification-contract-${Math.random().toString(36).slice(2, 10)}`;
      this.commit(agent, { kind: "challenge", questionId, challengeKind: "contract", identity: contractIdentityOf2(valid.data), consumed: false, authorityScope: this.requireCurrentAuthorityScope(agent) });
      const answer = await this.config.askUser?.({
        agent,
        questionId,
        text: renderContractForHuman(valid.data),
        choices: ["approve", "decline"]
      });
      if (answer !== "approve") {
        this.commit(agent, { kind: "challenge", questionId, challengeKind: "contract", identity: contractIdentityOf2(valid.data), consumed: true, authorityScope: this.requireCurrentAuthorityScope(agent) });
        return { ok: false, reason: "contract declined by user; retry after adjusting the plan" };
      }
      this.commit(agent, { kind: "challenge", questionId, challengeKind: "contract", identity: contractIdentityOf2(valid.data), consumed: true, authorityScope: this.requireCurrentAuthorityScope(agent) });
      this.commit(agent, { kind: "plan", contract: valid.data, authorityScope: this.requireCurrentAuthorityScope(agent), frozenAt: { callId: "human-confirmed", at: this.clock() } });
      return { ok: true, contract: valid.data };
    }
    this.commit(agent, { kind: "plan", contract: valid.data, authorityScope: this.requireCurrentAuthorityScope(agent) });
    return { ok: true, contract: valid.data };
  }
  async tryIndependentCapture(agent, basis, intentSpec) {
    const llm = this.ctx.get("llm");
    if (!llm) {
      this.captureUnavailableReason = "llm service not mounted";
      return null;
    }
    const provider = this.config.intent.provider ?? llm.listProviders()[0]?.id;
    if (!provider) {
      this.captureUnavailableReason = "no llm provider configured";
      return null;
    }
    const model = this.config.intent.model ?? (await llm.listModels(provider))[0]?.id;
    if (!model) {
      this.captureUnavailableReason = `no configured model for provider ${provider}`;
      return null;
    }
    if (basis.length === 0) {
      this.captureUnavailableReason = "sourceBasis empty (no authoritative user message yet)";
      return null;
    }
    const specHint = intentSpec && intentSpec.length > 0 ? [
      "",
      "[witness-id binding only, not semantics] Executing agent intends these AC ids (KEEP each id EXACTLY; you may reword desc / adjust oracleHint / add constraints):",
      ...intentSpec.map((s) => `- ${s.id}${s.tool !== void 0 ? ` (proposed witness tool: ${s.tool})` : ""}`)
    ].join("\n") : "";
    const prompt = basis.map((entry) => `[${entry.kind} @seq${entry.seq}] ${entry.text}`).join("\n\n") + specHint;
    const generate = async () => {
      const result = await completeText(this.ctx, {
        provider,
        model,
        system: GRADER_INTENT_SYSTEM_PROMPT,
        messages: [
          { role: "user", text: prompt },
          { role: "user", text: "Return ONLY the final contract JSON object, starting with { and ending with }. No prose before or after it." }
        ],
        temperature: 0,
        maxTokens: 8192
      });
      const candidate = [result.text, result.reasoning].filter(Boolean).join("\n");
      return { content: candidate, reasoningContent: result.reasoning, rawSample: `${result.text} ${result.reasoning ?? ""}`.trim() };
    };
    const count = Math.max(1, this.config.intent.consensusCount);
    const candidates = [];
    try {
      for (let i = 0; i < count; i += 1) {
        candidates.push(await generate());
      }
    } catch (error) {
      this.captureUnavailableReason = `grader generation failed: ${errorMessage(error)}`;
      return null;
    }
    let consensus;
    const firstRawSample = candidates[0]?.rawSample;
    try {
      consensus = await runStructuredConsensus({
        consensusCount: candidates.length,
        generate: async () => candidates.shift(),
        parse: (content) => {
          const parsedList = extractJsonCandidates(content);
          if (parsedList.length === 0) {
            throw new GraderParseError("no complete JSON object found in grader output", content.slice(0, 400));
          }
          for (const parsed of parsedList) {
            const normalized = normalizeGraderBody(parsed);
            const valid = GraderBodySchema.safeParse(normalized);
            if (valid.success) {
              return valid.data;
            }
          }
          throw new Error(`no grader JSON candidate matched the contract schema (checked ${parsedList.length} candidate(s))`);
        }
      });
    } catch (error) {
      this.captureUnavailableReason = `grader consensus threw: ${errorMessage(error)}`;
      return null;
    }
    if (consensus.kind !== "success") {
      const sample = firstRawSample?.trim().slice(0, 600) ?? "";
      this.captureUnavailableReason = `grader consensus failed: ${consensus.kind}${sample ? ` (raw sample: ${JSON.stringify(sample)})` : ""}`;
      return null;
    }
    return {
      goal: consensus.value.goal,
      acceptanceCriteria: consensus.value.acceptanceCriteria,
      constraints: consensus.value.constraints,
      inputs: consensus.value.inputs,
      outOfScope: consensus.value.outOfScope
    };
  }
  freezePlan(agent, callId) {
    const view = this.getPlanView(agent);
    if (!view || view.frozenAt) {
      return;
    }
    this.commit(agent, { kind: "plan", contract: view.contract, authorityScope: this.requireCurrentAuthorityScope(agent), frozenAt: { callId, at: this.clock() } });
  }
  /** reset_verification_plan：同一 epoch 内 re-basis（新 contractId + revision 0），不关闭任务。 */
  resetPlan(agent) {
    const current = this.getContract(agent);
    if (!current) {
      return null;
    }
    const rebased = rebaseContract(current);
    this.commit(agent, { kind: "plan", contract: rebased, authorityScope: this.requireCurrentAuthorityScope(agent) });
    return rebased;
  }
  /** advisory 观测：evaluation_error 也落 gate 摘要（never-throw 语义在调用方）。 */
  commitGateError(agent, error) {
    this.commit(agent, {
      kind: "gate",
      entry: {
        at: this.clock(),
        status: "failed",
        mode: this.modeOf(agent),
        reasons: [`evaluation_error: ${errorMessage(error)}`],
        authorityScope: this.requireCurrentAuthorityScope(agent)
      }
    });
  }
  // ── capture ────────────────────────────────────────────────
  async captureEvidence(agent, record, resultSeq) {
    this.markToolCallHandled(agent, record.callId);
    const contract = this.getContract(agent);
    if (!contract) {
      return;
    }
    const identity = contractIdentityOf2(contract);
    const policyFacts = policyFactsFor(record);
    const captured = deriveCaptured(record, { contractIdentity: identity });
    if (!captured) {
      if (policyFacts.networkCalls.length > 0 || policyFacts.paths.length > 0) {
        this.recordCaptureFailure(agent, {
          contractIdentity: identity,
          callId: record.callId,
          toolIdentity: record.name,
          normalizedArgsHash: record.arguments ? normalizedArgsHash(record.arguments) : "",
          evidenceType: isNetworkLikeTool(record.name) ? "quote_with_location" : "command_output",
          resultSeq,
          error: "policy-facts-only: tool produced no capturable evidence shape; recording durable policy facts",
          authorityScope: this.requireCurrentAuthorityScope(agent),
          policyFacts
        });
      }
      return;
    }
    const projection = this.getProjection(agent);
    const sameContract = projection.evidenceRefs.filter(
      (ref) => ref.contractIdentity.contractId === identity.contractId && ref.contractIdentity.revision === identity.revision && ref.contractIdentity.contractContentHash === identity.contractContentHash && ref.contractIdentity.basisHash === identity.basisHash && ref.contractIdentity.sessionId === identity.sessionId
    );
    if (sameContract.length >= this.config.maxCapturedEvidence) {
      this.recordCaptureFailure(agent, {
        contractIdentity: identity,
        callId: record.callId,
        toolIdentity: record.name,
        normalizedArgsHash: captured.normalizedArgsHash,
        evidenceType: captured.evidenceType,
        resultSeq,
        error: `maxCapturedEvidence ${this.config.maxCapturedEvidence} exceeded`,
        authorityScope: this.requireCurrentAuthorityScope(agent),
        policyFacts
      });
      return;
    }
    const estimated = new TextEncoder().encode(JSON.stringify(captured)).byteLength;
    const capturedBytes = sameContract.reduce((total, ref) => total + ref.originalLength, 0);
    if (capturedBytes + estimated > this.config.maxCapturedBytes) {
      this.recordCaptureFailure(agent, {
        contractIdentity: identity,
        callId: record.callId,
        toolIdentity: record.name,
        normalizedArgsHash: captured.normalizedArgsHash,
        evidenceType: captured.evidenceType,
        resultSeq,
        error: `maxCapturedBytes ${this.config.maxCapturedBytes} exceeded (captured ${capturedBytes} + next ${estimated})`,
        authorityScope: this.requireCurrentAuthorityScope(agent),
        policyFacts
      });
      return;
    }
    try {
      const stored = await storePayload(this.store, captured);
      this.commit(agent, {
        kind: "evidence",
        callId: record.callId,
        toolIdentity: record.name,
        normalizedArgsHash: captured.normalizedArgsHash,
        blobHash: stored.blobKey,
        originalLength: stored.originalLength,
        rawHash: stored.rawHash,
        truncated: stored.truncated,
        completeness: stored.completeness,
        schemaVersion: 1,
        contractIdentity: identity,
        evidenceType: captured.evidenceType,
        resultSeq,
        summary: textSummary(captured),
        authorityScope: this.requireCurrentAuthorityScope(agent),
        policyFacts
      });
    } catch (error) {
      this.recordCaptureFailure(agent, {
        contractIdentity: identity,
        callId: record.callId,
        toolIdentity: record.name,
        normalizedArgsHash: captured.normalizedArgsHash,
        evidenceType: captured.evidenceType,
        resultSeq,
        error: errorMessage(error),
        authorityScope: this.requireCurrentAuthorityScope(agent),
        policyFacts
      });
    }
  }
  recordCaptureFailure(agent, failure) {
    this.commit(agent, { kind: "capture-failure", ...failure });
  }
  // ── gate / permit ──────────────────────────────────────────
  async evaluateGate(agent) {
    const contract = this.getContract(agent);
    if (!contract) {
      throw new VerificationError("missing_contract", "VERIFICATION_MISSING_CONTRACT");
    }
    const identity = contractIdentityOf2(contract);
    const scope = this.requireCurrentAuthorityScope(agent);
    const projection = this.getProjection(agent);
    const sameScope = (candidate) => candidate !== void 0 && candidate.epochId === scope.epochId && candidate.rootGoalId === scope.rootGoalId && candidate.ownerAgentId === scope.ownerAgentId;
    const sameIdentity = (candidate) => identitiesEqual(candidate, identity);
    const scopedProjection = {
      ...projection,
      evidenceRefs: projection.evidenceRefs.filter((ref) => sameScope(ref.authorityScope) && sameIdentity(ref.contractIdentity)),
      captureFailures: projection.captureFailures.filter((failure) => sameScope(failure.authorityScope) && sameIdentity(failure.contractIdentity)),
      verdicts: projection.verdictAuthorityScope && sameScope(projection.verdictAuthorityScope) ? projection.verdicts : {}
    };
    const bindings = /* @__PURE__ */ new Map();
    const boundMap = /* @__PURE__ */ new Map();
    for (const ac of contract.acceptanceCriteria) {
      const outcome = await bindSelectorForAc(ac, {
        contractIdentity: identity,
        refs: scopedProjection.evidenceRefs,
        captureFailures: scopedProjection.captureFailures,
        loadBlob: async (key) => this.store.read(key)
      }, (ac2) => hintToEvidenceType(ac2.oracleHint));
      bindings.set(ac.id, outcome);
      if (outcome.kind === "bound") {
        boundMap.set(ac.id, outcome.evidence);
      }
    }
    const verdicts = /* @__PURE__ */ new Map();
    for (const ac of contract.acceptanceCriteria) {
      verdicts.set(ac.id, await this.judgeAc(agent, contract, ac, boundMap.get(ac.id), bindings.get(ac.id)));
    }
    if (this.config.binderFamilyFallback !== false) {
      const contractRunHints = [...new Set(contract.acceptanceCriteria.flatMap((a) => commandHints(a.desc)))];
      for (const ac of contract.acceptanceCriteria) {
        const v0 = verdicts.get(ac.id);
        if (!v0 || v0.result !== "fail" || !isFileFamilyAc(ac) && !isRunFamilyAc(ac)) {
          continue;
        }
        const ctx2 = {
          contractIdentity: identity,
          refs: scopedProjection.evidenceRefs,
          captureFailures: scopedProjection.captureFailures,
          loadBlob: async (key) => this.store.read(key)
        };
        const fb = await bindSelectorForAc(ac, ctx2, (ac2) => hintToEvidenceType(ac2.oracleHint), {
          familyFallback: true,
          familyExtraHints: contractRunHints
        });
        if (fb.kind === "bound" && fb.familyFallback) {
          const v1 = await this.judgeAc(agent, contract, ac, fb.evidence, fb);
          if (v1.result === "pass") {
            v1.detail = `${v1.detail ?? ""}\uFF08family evidence fallback: exact selector ${ac.selector?.toolIdentity ?? ""} \u65E0\u6709\u6548\u8BC1\u636E\uFF0C\u6539\u7528\u65CF\u5185\u771F\u5B9E\u6587\u4EF6\u8BC1\u636E ${fb.evidence.toolIdentity}\u2192${fb.evidence.evidenceType} seq${fb.resultSeq}\uFF09`.trim();
            verdicts.set(ac.id, v1);
            continue;
          }
        }
        if (ac.selector) {
          const candidates = await familyCandidates(ac, ctx2, ac.selector);
          for (const cand of candidates) {
            const v2 = await this.judgeAc(agent, contract, ac, cand.evidence, {
              kind: "bound",
              evidence: cand.evidence,
              resultSeq: cand.resultSeq,
              familyFallback: true
            });
            if (v2.result === "pass") {
              v2.detail = `${v2.detail ?? ""}\uFF08family evidence fallback: exact selector ${ac.selector?.toolIdentity ?? ""} \u65E0\u6709\u6548\u8BC1\u636E\uFF0C\u65CF\u5185\u5019\u9009\u8BC1\u636E ${cand.evidence.toolIdentity}\u2192${cand.evidence.evidenceType} seq${cand.resultSeq} \u6EE1\u8DB3\u9A8C\u6536\uFF09`.trim();
              verdicts.set(ac.id, v2);
              break;
            }
          }
        }
      }
    }
    const policyPaths = [];
    const policyNetwork = [];
    for (const failure of scopedProjection.captureFailures) {
      policyPaths.push(...failure.policyFacts?.paths ?? []);
      policyNetwork.push(...failure.policyFacts?.networkCalls ?? []);
    }
    for (const ref of scopedProjection.evidenceRefs) {
      policyPaths.push(...ref.policyFacts?.paths ?? []);
      policyNetwork.push(...ref.policyFacts?.networkCalls ?? []);
    }
    const execCtx = {
      touchedPaths: [...this.inferredPaths(scopedProjection), ...policyPaths],
      networkCalls: [...this.networkCallsOf(agent), ...policyNetwork]
    };
    const constraintResults = enforceConstraints([...this.config.globalConstraints, ...contract.constraints], execCtx, DEFAULT_CHECKERS);
    const gate = new CompletionGate().evaluate(contract, verdicts, constraintResults);
    this.commit(agent, { kind: "verdicts", verdicts: Object.fromEntries(verdicts), authorityScope: this.requireCurrentAuthorityScope(agent) });
    this.commit(agent, {
      kind: "gate",
      entry: { at: this.clock(), status: gate.status, mode: this.modeOf(agent), reasons: gate.reasons, authorityScope: this.requireCurrentAuthorityScope(agent) }
    });
    return { gate, snapshotHash: this.currentSnapshotHash(agent), bindings };
  }
  async judgeAc(agent, contract, ac, bound, outcome) {
    const identity = contractIdentityOf2(contract);
    if (!bound) {
      const reason = outcome && outcome.kind !== "not-harnessed" ? outcome.reason : `AC ${ac.id} has no bound evidence (no exact selector match)`;
      return { claimId: ac.id, acId: ac.id, result: "fail", oracleTier: "T3", contractIdentity: identity, detail: reason };
    }
    if (ac.oracleHint === "human") {
      return { claimId: bound.callId, acId: ac.id, result: "need_human", oracleTier: "T4", contractIdentity: identity, detail: "AC requires human confirmation" };
    }
    const engine = new VerificationEngine(this.oracleList(agent));
    try {
      return await engine.verify(ac, [bound], identity);
    } catch (error) {
      return { claimId: bound.callId, acId: ac.id, result: "fail", oracleTier: "T3", contractIdentity: identity, detail: `no oracle can judge AC ${ac.id}: ${errorMessage(error)}` };
    }
  }
  oracleList(agent) {
    const oracles = [];
    if (this.config.enableDeterministic) {
      oracles.push(new TestRunOracle(), new CommandExitOracle(), new FileExistsOracle(), new FileDiffOracle(), new SchemaValidOracle());
    }
    if (this.config.enableCoverage) {
      oracles.push(new CoverageOracle());
    }
    if (this.config.enableProReview) {
      oracles.push(
        new ProReviewOracle(
          createSubagentProReviewRunner(this.ctx, { provider: this.config.proReviewProvider, agent })
        )
      );
    }
    if (this.config.enableAssistantResponse) {
      oracles.push(new AssistantResponseOracle());
    }
    return oracles;
  }
  inferredPaths(projection) {
    return [.../* @__PURE__ */ new Set([
      ...projection.evidenceRefs.flatMap((ref) => ref.policyFacts?.paths ?? []),
      ...projection.captureFailures.flatMap((failure) => failure.policyFacts?.paths ?? [])
    ])];
  }
  /**
   * S2-2/S3-1：network 型工具调用，**从 durable `tool/call` 事件重建**（非内存瞬态）——
   * 服务重启/插件缺席期后从会话日志重放得到，`network:` 禁令不回退 fail-open。
   */
  networkCallsOf(agent) {
    const contract = this.getContract(agent);
    if (!contract) return [];
    const identity = contractIdentityOf2(contract);
    const scope = this.requireCurrentAuthorityScope(agent);
    const same = (candidate, candidateIdentity) => candidate !== void 0 && candidate.epochId === scope.epochId && candidate.rootGoalId === scope.rootGoalId && candidate.ownerAgentId === scope.ownerAgentId && identitiesEqual(candidateIdentity, identity);
    const projection = this.getProjection(agent);
    return [.../* @__PURE__ */ new Set([
      ...projection.evidenceRefs.filter((ref) => same(ref.authorityScope, ref.contractIdentity)).flatMap((ref) => ref.policyFacts?.networkCalls ?? []),
      ...projection.captureFailures.filter((failure) => same(failure.authorityScope, failure.contractIdentity)).flatMap((failure) => failure.policyFacts?.networkCalls ?? [])
    ])];
  }
  /**
   * S3-4 对账（§4.4）：契约存在后，每个"可采集"durable `tool/call` 必须对应
   * 一条 evidenceRef 或 captureFailure（当前 identity）；缺口落 **durable capture-failure**
   *（不在内存里静默）：这是崩溃/插件缺席/重放场景的 fail-closed 底座。幂等 + 重入有界。
   */
  reconcileDurableCalls(agent, cache) {
    if (this.reconciling || cache.reconciledSeq >= agent.session.seq) {
      return;
    }
    const contract = cache.projection.plan?.contract;
    if (!contract) {
      cache.reconciledSeq = agent.session.seq;
      return;
    }
    const identity = contractIdentityOf2(contract);
    this.reconciling = true;
    try {
      for (const [callId, call] of cache.calls) {
        if (call.seq <= cache.contractPlanSeq) {
          continue;
        }
        if (cache.projection.evidenceRefs.some((ref) => ref.contractIdentity.contractId === identity.contractId && ref.callId === callId)) {
          continue;
        }
        if (cache.projection.captureFailures.some((f) => f.contractIdentity.contractId === identity.contractId && f.callId === callId)) {
          continue;
        }
        if (this.handledCallsBySession.get(agent.session)?.has(callId)) {
          continue;
        }
        const record = { callId, name: call.name, arguments: call.args, isError: false };
        const captured = deriveCaptured(record, { contractIdentity: identity });
        if (!captured) {
          continue;
        }
        this.recordCaptureFailure(agent, {
          contractIdentity: identity,
          callId,
          toolIdentity: call.name,
          normalizedArgsHash: captured.normalizedArgsHash,
          evidenceType: captured.evidenceType,
          resultSeq: call.seq,
          error: `reconcile: durable tool/call ${callId} has no captured evidence or capture-failure`,
          authorityScope: this.requireCurrentAuthorityScope(agent),
          policyFacts: policyFactsFor({ callId, name: call.name, arguments: call.args, isError: false })
        });
      }
    } finally {
      this.reconciling = false;
      cache.reconciledSeq = agent.session.seq;
    }
  }
  currentSnapshotHash(agent) {
    const contract = this.getContract(agent);
    const projection = this.getProjection(agent);
    const scope = this.requireCurrentAuthorityScope(agent);
    const identity = contract ? contractIdentityOf2(contract) : null;
    const refs = projection.evidenceRefs.filter((ref) => identity && identitiesEqual(ref.contractIdentity, identity) && ref.authorityScope !== void 0 && ref.authorityScope.epochId === scope.epochId && ref.authorityScope.rootGoalId === scope.rootGoalId && ref.authorityScope.ownerAgentId === scope.ownerAgentId);
    const failures = projection.captureFailures.filter((failure) => identity && identitiesEqual(failure.contractIdentity, identity) && failure.authorityScope !== void 0 && failure.authorityScope.epochId === scope.epochId && failure.authorityScope.rootGoalId === scope.rootGoalId && failure.authorityScope.ownerAgentId === scope.ownerAgentId);
    return computeGateSnapshotHash({
      contractIdentity: identity ?? { contractId: "", revision: 0, contractContentHash: "", basisHash: "", sessionId: agent.session.id },
      verdicts: projection.verdictAuthorityScope && projection.verdictAuthorityScope.epochId === scope.epochId && projection.verdictAuthorityScope.rootGoalId === scope.rootGoalId && projection.verdictAuthorityScope.ownerAgentId === scope.ownerAgentId ? projection.verdicts : {},
      evidenceBlobHashes: refs.map((ref) => ref.blobHash),
      captureFailures: failures.length,
      configHash: this.config.configHash,
      schemaVersion: 1
    });
  }
  /** 异步 prepare：gate done + goal ref 有效才落 durable permit。 */
  async prepareGoalCompletion(agent, goalId, goalRevision) {
    const scope = this.requireCurrentAuthorityScope(agent);
    if (scope.rootGoalId !== goalId) {
      throw new VerificationError("missing_root_goal: completion target is not the active root goal", "VERIFICATION_MISSING_ROOT_GOAL");
    }
    this.requireGoalBoundEpoch(agent, goalId, goalRevision);
    const { gate } = await this.evaluateGate(agent);
    if (gate.status !== "done") {
      return;
    }
    const snapshot = currentGoalSnapshot(agent.session.events, goalId);
    const contract = this.getContract(agent);
    if (!snapshot || snapshot.revision !== goalRevision || !contract) {
      return;
    }
    this.commit(agent, {
      kind: "permit",
      permitRef: newPermitRef(),
      goalId,
      goalRevision,
      contractIdentity: contractIdentityOf2(contract),
      gateSnapshotHash: this.currentSnapshotHash(agent),
      configHash: this.config.configHash,
      ttlMs: this.config.completionPermitTtlMs,
      authorityScope: this.requireCurrentAuthorityScope(agent)
    });
  }
  /** 同步 guard（GoalTransitionGuard seam 调用点）：零 mutation，先校验后放行。 */
  assertCompletionPermit(agent, goalId, goalRevision) {
    let scope;
    try {
      scope = this.requireCurrentAuthorityScope(agent);
    } catch (error) {
      return { ok: false, reason: errorMessage(error) };
    }
    if (scope.rootGoalId !== goalId) {
      return { ok: false, reason: "permit authority scope root goal mismatch" };
    }
    const contract = this.getContract(agent);
    if (!contract) {
      return { ok: false, reason: "no contract committed" };
    }
    const identity = contractIdentityOf2(contract);
    const permits = [];
    for (const event of this.allEvents(agent)) {
      if (event.type === "verification/change") {
        const data = event.data;
        if (data?.record?.kind === "permit") {
          permits.push({
            record: data.record,
            seq: event.seq,
            time: event.time
          });
        }
      }
    }
    const matching = permits.filter((entry) => entry.record.goalId === goalId && entry.record.goalRevision === goalRevision && entry.record.authorityScope !== void 0 && entry.record.authorityScope.epochId === scope.epochId && entry.record.authorityScope.rootGoalId === scope.rootGoalId && entry.record.authorityScope.ownerAgentId === scope.ownerAgentId).sort((a, b) => b.seq - a.seq);
    const selected = matching[0];
    return validatePermitForCompletion({
      completed: { goalId, goalRevision, permitRef: selected?.record.permitRef ?? "", completeSeq: agent.session.seq, completeTime: Date.now() },
      permits,
      policies: {
        [this.config.configHash]: { configHash: this.config.configHash, completionPermitTtlMs: this.config.completionPermitTtlMs, schemaVersion: 1 }
      },
      contractIdentity: identity,
      gateSnapshotHash: this.currentSnapshotHash(agent)
    });
  }
  // ── commit ─────────────────────────────────────────────────
  /** S3-4：标记一次工具调用已被本进程（post-execute）处理——对账对其免于"缺口"误报。 */
  markToolCallHandled(agent, callId) {
    let set = this.handledCallsBySession.get(agent.session);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.handledCallsBySession.set(agent.session, set);
    }
    set.add(callId);
  }
  commit(agent, record) {
    const cache = this.cache(agent);
    const beforeSeq = agent.session.seq;
    const meta = { kind: "verification/change", version: 1, record: stripUndefined(record) };
    agent.session.append("verification/change", meta);
    cache.projection = applyVerificationRecord(cache.projection, meta.record, { seq: beforeSeq, time: this.clock() });
    cache.observedSeq = agent.session.seq;
    if (record.kind === "plan") {
      cache.contractPlanSeq = beforeSeq;
    }
    try {
      this.ctx.emit?.("verification/changed", { agent, change: { operation: "change", projection: cache.projection } });
    } catch {
    }
  }
};
function renderContractForHuman(contract) {
  return JSON.stringify(
    {
      goal: contract.goal,
      acceptanceCriteria: contract.acceptanceCriteria,
      constraints: contract.constraints,
      outOfScope: contract.outOfScope
    },
    null,
    2
  );
}

// src/constraint-library.ts
var ConstraintsLibrary = class {
  constructor(global) {
    this.global = global;
  }
  global;
  applyTo(contract) {
    return {
      ...contract,
      constraints: [...this.global, ...contract.constraints]
    };
  }
};

// src/index.ts
KNOWN_SESSION_EVENT_TYPES.add("verification/change");
var name = "verification";
var inject = ["agents", "tools", "systemPrompt"];
var DEFAULT_READ_ONLY_TOOLS = [
  "read",
  "glob",
  "grep",
  "read_page",
  "read_image",
  "web_search",
  "x_search",
  "get_goal",
  "get_verification_plan",
  "ask_user_question",
  "ask_user",
  "list_dir",
  "search"
];
var DEFAULT_WRITE_TOOLS = [
  "edit",
  "write",
  "write_file",
  "unlink",
  "rename",
  "mkdir",
  "rm",
  "mv",
  "cp",
  "apply_patch",
  "patch",
  "replace",
  "shell",
  "bash",
  "pwsh",
  "powershell",
  "exec",
  "terminal",
  "send_message",
  "todo_write"
];
var Config = z3.object({
  mode: z3.union([z3.const("enforce"), z3.const("advisory")]).default("advisory"),
  maxCapturedEvidence: z3.number().min(1).default(200),
  maxCapturedBytes: z3.number().min(1).default(20 * 1024 * 1024),
  completionPermitTtlMs: z3.number().min(1e3).max(3e5).default(3e4),
  oracles: z3.object({
    deterministic: z3.boolean().default(true),
    assistantResponse: z3.boolean().default(true),
    coverage: z3.object({ enabled: z3.boolean().default(true) }),
    proReview: z3.object({
      // v9：authorityIsolation upstream seam 前默认关闭
      enabled: z3.boolean().default(false),
      provider: z3.string().default("spawn"),
      maxDefects: z3.number().min(1).default(10)
    }).default({ enabled: false, provider: "spawn", maxDefects: 10 })
  }),
  constraints: z3.array(z3.object({ id: z3.string(), desc: z3.string(), check: z3.string() })),
  intent: z3.object({
    requireContractBeforeExecution: z3.boolean(),
    contractOrigin: z3.union([z3.const("independent-capture"), z3.const("human-confirmed")]).default("independent-capture"),
    freezeOnHumanConfirm: z3.boolean().default(true),
    consensusCount: z3.number().min(0).max(3).default(1),
    provider: z3.string(),
    model: z3.string(),
    readOnlyToolAllowlist: z3.array(z3.string()).default(DEFAULT_READ_ONLY_TOOLS),
    sourceBasis: z3.object({
      includeAttachments: z3.boolean().default(true),
      includeControlDocs: z3.boolean().default(true),
      maxEntries: z3.number().min(1).default(200)
    })
  }),
  blobDir: z3.string(),
  systemPromptSection: z3.boolean().default(true),
  // 2026-08-17（完成任务能力修复）：file 族 AC 精确绑定失败时启用族内证据兜底，减少假阴性。默认开启；安全严格场景可关。
  binderFamilyFallback: z3.boolean().default(true)
});
function resolveConfig(config) {
  return {
    mode: config.mode ?? "advisory",
    maxCapturedEvidence: config.maxCapturedEvidence ?? 200,
    maxCapturedBytes: config.maxCapturedBytes ?? 20 * 1024 * 1024,
    completionPermitTtlMs: config.completionPermitTtlMs ?? 3e4,
    oracles: {
      deterministic: config.oracles?.deterministic ?? true,
      assistantResponse: config.oracles?.assistantResponse ?? true,
      coverage: { enabled: config.oracles?.coverage?.enabled ?? true },
      proReview: {
        enabled: config.oracles?.proReview?.enabled ?? false,
        provider: config.oracles?.proReview?.provider ?? "spawn",
        maxDefects: config.oracles?.proReview?.maxDefects ?? 10
      }
    },
    constraints: config.constraints ?? [],
    intent: {
      // P0-1 review：默认 advisory，requireContractBeforeExecution 只在显式 enforce 时推演为 true
      requireContractBeforeExecution: config.intent?.requireContractBeforeExecution ?? (config.mode ?? "advisory") === "enforce",
      contractOrigin: config.intent?.contractOrigin ?? "independent-capture",
      freezeOnHumanConfirm: config.intent?.freezeOnHumanConfirm ?? true,
      consensusCount: config.intent?.consensusCount ?? 1,
      ...config.intent?.provider !== void 0 ? { provider: config.intent.provider } : {},
      ...config.intent?.model !== void 0 ? { model: config.intent.model } : {},
      readOnlyToolAllowlist: config.intent?.readOnlyToolAllowlist ?? DEFAULT_READ_ONLY_TOOLS,
      sourceBasis: {
        includeAttachments: config.intent?.sourceBasis?.includeAttachments ?? true,
        includeControlDocs: config.intent?.sourceBasis?.includeControlDocs ?? true,
        maxEntries: config.intent?.sourceBasis?.maxEntries ?? 200
      }
    },
    ...config.blobDir !== void 0 ? { blobDir: config.blobDir } : {},
    systemPromptSection: config.systemPromptSection ?? true,
    binderFamilyFallback: config.binderFamilyFallback ?? true
  };
}
function computeConfigHash(config) {
  return stableHash3({
    mode: config.mode,
    completionPermitTtlMs: config.completionPermitTtlMs,
    oracles: {
      deterministic: config.oracles.deterministic ? 1 : 0,
      assistantResponse: config.oracles.assistantResponse ? 1 : 0,
      coverage: config.oracles.coverage.enabled ? 1 : 0,
      proReview: { enabled: config.oracles.proReview.enabled ? 1 : 0, provider: config.oracles.proReview.provider }
    },
    maxCapturedEvidence: config.maxCapturedEvidence,
    maxCapturedBytes: config.maxCapturedBytes,
    binderFamilyFallback: config.binderFamilyFallback ? 1 : 0,
    schemaVersion: 1
  });
}
function apply(ctx, config) {
  const resolved = resolveConfig(config);
  const configHash = computeConfigHash(resolved);
  const store = resolved.blobDir ? createFileBlobStore(resolved.blobDir) : createMemoryBlobStore();
  const service = new VerificationService(
    ctx,
    {
      mode: resolved.mode,
      maxCapturedEvidence: resolved.maxCapturedEvidence,
      maxCapturedBytes: resolved.maxCapturedBytes,
      completionPermitTtlMs: resolved.completionPermitTtlMs,
      configHash,
      enableDeterministic: resolved.oracles.deterministic,
      enableAssistantResponse: resolved.oracles.assistantResponse,
      enableCoverage: resolved.oracles.coverage.enabled,
      enableProReview: resolved.oracles.proReview.enabled,
      proReviewProvider: resolved.oracles.proReview.provider,
      globalConstraints: resolved.constraints,
      intent: {
        consensusCount: resolved.intent.consensusCount,
        ...resolved.intent.provider !== void 0 ? { provider: resolved.intent.provider } : {},
        ...resolved.intent.model !== void 0 ? { model: resolved.intent.model } : {},
        contractOrigin: resolved.intent.contractOrigin,
        maxEntries: resolved.intent.sourceBasis.maxEntries
      },
      readOnlyToolAllowlist: resolved.intent.readOnlyToolAllowlist,
      binderFamilyFallback: resolved.binderFamilyFallback,
      askUser: resolveAskUser(ctx)
    },
    { store }
  );
  installEvidenceCapture(ctx, service);
  installCompleteGateHook(ctx, service, {
    mode: resolved.mode,
    readOnlyAllowlist: resolved.intent.readOnlyToolAllowlist,
    writeTools: DEFAULT_WRITE_TOOLS,
    // P0-1 review：工具拦截与完成门禁拆分——只拦明确写入类工具，且默认（advisory）不拦
    requireContractBeforeExecution: resolved.intent.requireContractBeforeExecution
  });
  installIntentTools(ctx, service);
  installProReviewTool(ctx, service, resolved.oracles.proReview.provider);
  if (resolved.mode === "enforce") {
    const disposeGuard = installGoalTransitionGuard(ctx, service);
    if (!disposeGuard) {
      throw new Error("enforce verification blocked: GoalTransitionGuard seam unavailable");
    }
    const unregister = () => {
      try {
        disposeGuard();
      } catch {
      }
    };
    const anyCtx = ctx;
    if (typeof anyCtx.effect === "function") {
      anyCtx.effect(() => unregister);
    } else if (typeof anyCtx.dispose === "function") {
      const originalDispose = anyCtx.dispose;
      anyCtx.dispose = function() {
        unregister();
        return originalDispose.apply(this, arguments);
      };
    }
  }
  ctx.inject(["sessionProjections"], (projectionCtx) => {
    projectionCtx.sessionProjections.register({
      key: "verification",
      schema: VerificationProjectionSchema.nullable(),
      init: () => ({ projection: emptyVerificationProjection(), epoch: emptyIncrementalEpochState() }),
      apply: (state, event) => {
        if (event.type === "verification/change") {
          const data = event.data;
          if (data?.record) {
            return {
              projection: foldVerificationRecords(state.projection, [{ record: data.record, seq: event.seq, time: event.time }]),
              epoch: state.epoch
            };
          }
        }
        const epoch = applyEpochEvent(state.epoch, { type: event.type, data: event.data, seq: event.seq, time: event.time }, event.sessionId ?? "session");
        if (epoch === state.epoch) {
          return state;
        }
        return { ...state, epoch };
      },
      view: (state) => ({
        ...state.projection,
        taskEpochs: taskEpochViews(state.epoch.epochs)
      }),
      stateVersion: 1
    });
  });
  if (resolved.systemPromptSection) {
    ctx.systemPrompt.section({
      name: "verification",
      order: 115,
      text: buildVerificationGuidance({ mode: resolved.mode, requireContract: resolved.intent.requireContractBeforeExecution ?? false })
    });
  }
}
function resolveAskUser(ctx) {
  const approval = ctx.get("approval");
  if (approval?.request) {
    return async (question) => {
      const outcome = await approval.request({
        agent: question.agent,
        toolName: "set_verification_plan",
        reason: question.text,
        callId: question.questionId
      });
      return outcome === "allowed-once" ? "approve" : "decline";
    };
  }
  const userQuestions = ctx.get("userQuestions");
  if (!userQuestions?.ask) {
    return void 0;
  }
  return async (question) => {
    const answer = await userQuestions.ask({
      questionId: question.questionId,
      content: question.text,
      options: question.choices
    });
    return answer?.selected ?? answer?.answer;
  };
}
export {
  AssistantResponseOracle,
  AuthorityScopeSchema,
  BOOTSTRAP_WHITELIST,
  CaptureFailureRecordSchema,
  ChallengeRecordSchema,
  CommandExitOracle,
  CompletionGate,
  CompletionPermitRecordSchema,
  Config,
  ConstraintsLibrary,
  CoverageOracle,
  DEFAULT_CHECKERS,
  DEFAULT_READ_ONLY_TOOLS,
  DEFAULT_WRITE_TOOLS,
  EvidenceRefSchema,
  FileDiffOracle,
  FileExistsOracle,
  GRADER_INTENT_SYSTEM_PROMPT,
  GateSummarySchema,
  INTENT_SYSTEM_PROMPT,
  NoForbiddenPathChecker,
  NoNetworkChecker,
  PROHIBITED_PAYLOAD_FIELDS,
  PRO_REVIEW_SYSTEM_PROMPT,
  PolicyFactsSchema,
  ProReviewOracle,
  SchemaValidOracle,
  TaskEpochRecordSchema,
  TestRunOracle,
  VERIFICATION_CHANGE_VERSION,
  VerificationEngine,
  VerificationError,
  VerificationPlanViewSchema,
  VerificationProjectionSchema,
  VerificationRecordSchema,
  VerificationService,
  apply,
  applyEpochEvent,
  applyVerificationRecord,
  assembleStream,
  basisPromptText,
  bindSelectorForAc,
  buildReviewPrompt,
  buildVerificationGuidance,
  collectBasisEntries,
  completeText,
  computeConfigHash,
  computeGateSnapshotHash,
  createContractChallenge,
  createFileBlobStore,
  createMemoryBlobStore,
  createSubagentProReviewRunner,
  currentActiveEpoch,
  emptyVerificationProjection,
  enforceConstraints,
  extractVerificationRecords,
  findDuplicateSelectors,
  foldTaskEpochs,
  foldVerificationRecords,
  gateResultOf,
  inject,
  installCompleteGateHook,
  installEvidenceCapture,
  installGoalTransitionGuard,
  installIntentTools,
  installProReviewTool,
  isMachineCheckableConstraintCheck,
  materializeBasis,
  mintContract,
  name,
  newPermitRef,
  providerHasAuthorityIsolation,
  rebaseContract,
  renderDefects,
  resolveAskUser,
  resolveConfig,
  runStructuredConsensus,
  stampVerdict,
  storePayload,
  stripSelfNarration,
  taskEpochViews,
  tierRank,
  validatePermitForCompletion
};
//# sourceMappingURL=index.js.map