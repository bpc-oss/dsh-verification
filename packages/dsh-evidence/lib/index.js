// src/evidence.ts
import { z } from "zod";
var EvidenceTypeSchema = z.enum([
  "test_run",
  "command_output",
  "file_diff",
  "file_exists",
  "schema_valid",
  "symbol_exists",
  "quote_with_location",
  "assistant_response",
  "pro_review",
  "human_ack"
]);
var EvidenceTypeValues = EvidenceTypeSchema.options;
var EVIDENCE_FAMILIES = [
  ["file_diff", "file_exists", "quote_with_location"]
];
function evidenceTypesCompatible(left, right) {
  if (left === right) {
    return true;
  }
  return EVIDENCE_FAMILIES.some((family) => family.includes(left) && family.includes(right));
}
var ContractIdentitySchema = z.object({
  contractId: z.string().min(1),
  revision: z.number().int().min(0),
  contractContentHash: z.string().min(1),
  basisHash: z.string().min(1),
  sessionId: z.string().min(1)
}).strict();
function identitiesEqual(left, right) {
  return left.contractId === right.contractId && left.revision === right.revision && left.contractContentHash === right.contractContentHash && left.basisHash === right.basisHash && left.sessionId === right.sessionId;
}
var SelectorV1Schema = z.object({
  schemaVersion: z.literal(1),
  toolIdentity: z.string().min(1),
  normalizedArgsHash: z.string().min(1),
  evidenceType: EvidenceTypeSchema
}).strict();
function selectorRefOf(identity, acId) {
  return `${identity.contractId}:${identity.revision}:${acId}`;
}
function selectorKey(selector) {
  return `${selector.toolIdentity}|${selector.normalizedArgsHash}|${selector.evidenceType}`;
}
var CapturedEvidenceSchema = z.object({
  callId: z.string().min(1),
  toolIdentity: z.string().min(1),
  schemaVersion: z.literal(1).default(1),
  /** 规范化参数（按工具 schema 展开默认值 + 键稳定排序 + 路径 lexical 归一；服务端 binder 匹配依据）。 */
  normalizedArgs: z.record(z.string(), z.unknown()),
  normalizedArgsHash: z.string().min(1),
  evidenceType: EvidenceTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  producedBy: z.enum(["tool", "flash", "pro", "human"]).default("tool"),
  failed: z.boolean().default(false),
  contractIdentity: ContractIdentitySchema
}).strict();
var BoundEvidenceSchema = CapturedEvidenceSchema.extend({
  acId: z.string().min(1),
  selectorRef: z.string().min(1)
}).strict();
function isBoundEvidence(value) {
  return BoundEvidenceSchema.safeParse(value).success;
}
var VerdictResultSchema = z.enum(["pass", "fail", "need_human"]);
var OracleTierSchema = z.enum(["T0", "T1", "T2", "T3", "T4"]);
var VerdictSchema = z.object({
  claimId: z.string(),
  acId: z.string().min(1),
  result: VerdictResultSchema,
  oracleTier: OracleTierSchema,
  contractIdentity: ContractIdentitySchema,
  detail: z.string().optional()
}).strict();
var GateResultSchema = z.object({
  status: z.enum(["done", "failed", "blocked"]),
  reasons: z.array(z.string())
});
var MAX_CAPTURED_EVIDENCE = 200;
var MAX_CAPTURED_BYTES = 20 * 1024 * 1024;
var MAX_EVIDENCE_PAYLOAD_BYTES = 256 * 1024;

// src/contract.ts
import { z as z2 } from "zod";

// src/hash.ts
import { createHash } from "crypto";
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(([, entry]) => entry !== void 0).sort(([left], [right]) => left.localeCompare(right));
    const out = {};
    for (const [key, entry] of entries) {
      out[key] = canonicalize(entry);
    }
    return out;
  }
  if (typeof value === "number") {
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      return null;
    }
  }
  return value;
}
function stableHash(value) {
  const canonical = canonicalize(value);
  if (canonical === void 0) {
    return createHash("sha256").update("undefined").digest("hex");
  }
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
function contentHash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function textHash(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function deriveEpochId(sessionId, goalId, createSeq) {
  return createHash("sha256").update(`${sessionId}:${goalId}:${createSeq}`).digest("hex");
}

// src/contract.ts
var OracleHintSchema = z2.enum(["test", "run", "file", "schema", "review", "human"]);
var AcceptanceCriterionSchema = z2.object({
  id: z2.string().min(1),
  desc: z2.string().min(1),
  oracleHint: OracleHintSchema,
  selector: SelectorV1Schema.optional()
}).strict();
var ConstraintSchema = z2.object({
  id: z2.string().min(1),
  desc: z2.string().min(1),
  check: z2.string().min(1)
}).strict();
var SourceBasisEntrySchema = z2.object({
  kind: z2.enum(["user-message", "attachment", "control-doc", "user-correction"]),
  eventRef: z2.string().min(1),
  seq: z2.number().int().min(0),
  contentHash: z2.string().min(1)
}).strict();
var SourceBasisSchema = z2.object({
  sessionId: z2.string().min(1),
  entries: z2.array(SourceBasisEntrySchema),
  basisHash: z2.string().min(1)
}).strict();
function computeBasisHash(sessionId, entries) {
  return stableHash({ sessionId, entries });
}
var ContractRefSchema = z2.object({
  contractId: z2.string().min(1),
  revision: z2.number().int().min(0),
  contractContentHash: z2.string().min(1),
  sourceBasis: SourceBasisSchema
}).strict();
var TaskContractSchema = z2.object({
  ref: ContractRefSchema,
  origin: z2.enum(["independent-capture", "human-confirmed", "model-self-declared"]),
  goal: z2.string().min(1),
  acceptanceCriteria: z2.array(AcceptanceCriterionSchema).min(1),
  constraints: z2.array(ConstraintSchema).default([]),
  inputs: z2.array(z2.string()).default([]),
  outOfScope: z2.array(z2.string()).default([])
}).strict().superRefine((contract, ctx) => {
  const seen = /* @__PURE__ */ new Set();
  for (const [index, criterion] of contract.acceptanceCriteria.entries()) {
    if (seen.has(criterion.id)) {
      ctx.addIssue({ code: "custom", path: ["acceptanceCriteria", index, "id"], message: `duplicate acceptance criterion id: ${criterion.id}` });
    }
    seen.add(criterion.id);
  }
});
function contractIdentityOf(contract) {
  return {
    contractId: contract.ref.contractId,
    revision: contract.ref.revision,
    contractContentHash: contract.ref.contractContentHash,
    basisHash: contract.ref.sourceBasis.basisHash,
    sessionId: contract.ref.sourceBasis.sessionId
  };
}
function computeContractContentHash(contract) {
  return stableHash({
    goal: contract.goal,
    acceptanceCriteria: contract.acceptanceCriteria,
    constraints: contract.constraints,
    inputs: contract.inputs,
    outOfScope: contract.outOfScope
  });
}

// src/selector.ts
function normalizePathLexically(path) {
  const normalized = path.replace(/\\/g, "/");
  const segments = [];
  for (const segment of normalized.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") {
        segments.pop();
      } else {
        segments.push("..");
      }
    } else {
      segments.push(segment);
    }
  }
  return segments.join("/");
}
function canonicalizeArgs(args) {
  const normalized = {};
  for (const [key, value] of Object.entries(args)) {
    let entry = value;
    if (typeof entry === "string" && /path|file|target|dir|url/i.test(key)) {
      entry = normalizePathLexically(entry);
    } else if (Array.isArray(entry) && /path|file|include|sources/i.test(key)) {
      entry = entry.map((item) => typeof item === "string" ? normalizePathLexically(item) : item);
    }
    normalized[key] = entry;
  }
  return normalized;
}
function normalizedArgsHash(args) {
  return stableHash(canonicalizeArgs(args));
}
function canonicalArgsToPlain(args) {
  return canonicalize(canonicalizeArgs(args));
}

// src/test-output.ts
var ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;]*m/g;
var MAX_MESSAGE_LINES = 3;
var TEST_HEADER = /^(?:FAIL|\u2717|\u00d7)\s+/i;
var TAP_HEADER = /^\s*not ok\s+\d+\s+-\s+/i;
var SUBTEST_HEADER = /^\s*#\s*Subtest:\s+/;
var FILE_PATTERN = /(?:[A-Za-z]:\\)?[A-Za-z0-9._-]+(?:[\\/][A-Za-z0-9._-]+)*\.(?:test|spec)\.[jt]sx?(?:\?[^>\s]*)?/i;
var STACK_FILE_PATTERN = /\(([^()]+\.(?:test|spec)\.[jt]sx?(?:\?[^)]*)?):\d+:\d+\)/i;
var SUMMARY_LINE = /^\s*Test Files\b/i;
var normalize = (text) => text.replace(ANSI_ESCAPE_PATTERN, "").trim();
var normalizeOutput = (text) => text.replace(/\r/g, "").split("\n").map((line) => normalize(line));
var parseSummaryCount = (line) => {
  const passMatch = line.match(/(\d+)\s+pass(?:ed)?\b/i);
  const failMatch = line.match(/(\d+)\s+fail(?:ed)?\b/i);
  const nodePassMatch = line.match(/^#\s*pass\s+(\d+)/i);
  const nodeFailMatch = line.match(/^#\s*fail\s+(\d+)/i);
  return {
    passCount: passMatch ? Number.parseInt(passMatch[1], 10) : nodePassMatch ? Number.parseInt(nodePassMatch[1], 10) : void 0,
    failCount: failMatch ? Number.parseInt(failMatch[1], 10) : nodeFailMatch ? Number.parseInt(nodeFailMatch[1], 10) : void 0
  };
};
var isFailureHeader = (line) => {
  if (TEST_HEADER.test(line) || TAP_HEADER.test(line) || SUBTEST_HEADER.test(line)) {
    return line;
  }
  return null;
};
var extractFileFromText = (text) => {
  const fileMatch = text.match(FILE_PATTERN);
  return fileMatch ? fileMatch[0] : null;
};
var extractFileFromStack = (line) => {
  const match = line.match(STACK_FILE_PATTERN);
  return match ? match[1].split(":")[0] : null;
};
var splitFailureTitle = (text) => {
  const segments = text.split(">").map((part) => part.trim()).filter(Boolean);
  if (segments.length > 1) {
    const file2 = extractFileFromText(segments[0]) ?? "unknown";
    return {
      title: segments.slice(1).join(" > "),
      file: file2
    };
  }
  const file = extractFileFromText(text);
  if (file) {
    const title = text.replace(file, "").replace(/^>\s*/, "").trim();
    return { title: title || "failed test", file };
  }
  return { title: text || "failed test", file: "unknown" };
};
var shouldKeepMessageLine = (line) => {
  if (!line || line.length === 0) {
    return false;
  }
  if (SUMMARY_LINE.test(line)) {
    return false;
  }
  if (/^\s*at\s+/.test(line)) {
    return false;
  }
  if (/^\s*(?:\d+\s+\||\u2500{2,}|[-=]{3,}|.*\.\.\/|.*\((?:node|internal)\.|.*\[(?:node|internal)\])/i.test(line)) {
    return false;
  }
  return true;
};
var formatFailureForSummary = (failure) => `${failure.file} :: ${failure.title}${failure.message ? ` \u2014 ${failure.message}` : ""}`;
var createParseState = () => ({
  result: {
    passCount: 0,
    failCount: 0,
    failures: [],
    files: [],
    errorMessages: []
  },
  currentFailure: null,
  currentMessageLines: [],
  failures: [],
  files: /* @__PURE__ */ new Set(),
  errorMessages: /* @__PURE__ */ new Set()
});
var flushCurrentFailure = (state) => {
  if (!state.currentFailure) {
    return;
  }
  const message = state.currentMessageLines.slice(0, MAX_MESSAGE_LINES).join(" -> ");
  const withMessage = message ? { ...state.currentFailure, message } : state.currentFailure;
  state.failures.push(withMessage);
  if (withMessage.file !== "unknown") {
    state.files.add(withMessage.file);
  }
  if (withMessage.message) {
    state.errorMessages.add(withMessage.message);
  }
  state.currentFailure = null;
  state.currentMessageLines = [];
};
var applySummaryCount = (state, line) => {
  const summaryCount = parseSummaryCount(line);
  if (summaryCount.passCount !== void 0) {
    state.result.passCount = Math.max(state.result.passCount, summaryCount.passCount);
  }
  if (summaryCount.failCount !== void 0) {
    state.result.failCount = Math.max(state.result.failCount, summaryCount.failCount);
  }
};
var normalizeFailureHeader = (header) => {
  if (TEST_HEADER.test(header)) {
    return header.replace(TEST_HEADER, "");
  }
  if (TAP_HEADER.test(header)) {
    return header.replace(TAP_HEADER, "");
  }
  if (SUBTEST_HEADER.test(header)) {
    return header.replace(SUBTEST_HEADER, "");
  }
  return header;
};
var startFailure = (state, header) => {
  flushCurrentFailure(state);
  const parsedHeader = splitFailureTitle(normalizeFailureHeader(header));
  state.currentFailure = {
    title: parsedHeader.title || "failed test",
    file: parsedHeader.file || "unknown",
    message: ""
  };
};
var inferFileFromStackLine = (state, line) => {
  if (!state.currentFailure || state.currentFailure.file !== "unknown") {
    return;
  }
  const inferred = extractFileFromStack(line);
  if (inferred) {
    state.currentFailure.file = inferred;
    state.files.add(inferred);
  }
};
var consumeFailureDetailLine = (state, line) => {
  if (!state.currentFailure) {
    return;
  }
  if (/^\s*at\s+/.test(line)) {
    inferFileFromStackLine(state, line);
    return;
  }
  if (shouldKeepMessageLine(line) && state.currentMessageLines.length < MAX_MESSAGE_LINES) {
    state.currentMessageLines.push(line);
  }
};
function parseTestOutput(text) {
  const state = createParseState();
  for (const rawLine of normalizeOutput(text)) {
    applySummaryCount(state, rawLine);
    const header = isFailureHeader(rawLine);
    if (header) {
      startFailure(state, header);
      continue;
    }
    consumeFailureDetailLine(state, rawLine);
  }
  flushCurrentFailure(state);
  state.result.failures = state.failures.filter((failure) => failure.title || failure.file);
  state.result.files = Array.from(state.files);
  state.result.errorMessages = Array.from(state.errorMessages);
  return state.result;
}
var formatTestFailureContext = (parsed) => {
  const filteredFailures = parsed.failures.filter((entry) => entry.title || entry.file || entry.message);
  if (parsed.failCount === 0 && filteredFailures.length === 0) {
    return `pass=${parsed.passCount}, fail=${parsed.failCount}`;
  }
  const headers = [
    "Previous test failures (retry context):",
    `pass=${parsed.passCount}`,
    `fail=${parsed.failCount}`
  ];
  const failureLines = filteredFailures.slice(0, 5).map((failure, index) => `${index + 1}. ${formatFailureForSummary(failure)}`);
  return [...headers, ...failureLines].join("\n");
};

// src/derive.ts
function extractTextFromContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = [];
    for (const block of content) {
      if (block === null || typeof block !== "object") {
        continue;
      }
      const record = block;
      if (typeof record.text === "string") {
        parts.push(record.text.trim());
      } else if (typeof record.content === "string") {
        parts.push(record.content.trim());
      } else if (record.content !== void 0) {
        parts.push(extractTextFromContent(record.content));
      }
    }
    return parts.filter(Boolean).join("\n").trim();
  }
  if (content !== null && typeof content === "object") {
    const record = content;
    if (typeof record.text === "string") {
      return record.text;
    }
  }
  return "";
}
function pick(record, ...keys) {
  for (const source of [record.value, record.meta]) {
    if (source === null || source === void 0 || typeof source !== "object") {
      continue;
    }
    const obj = source;
    for (const key of keys) {
      if (obj[key] !== void 0) {
        return obj[key];
      }
    }
  }
  return void 0;
}
function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function str(value) {
  return typeof value === "string" ? value : void 0;
}
function isExecLike(name) {
  return /(^|[-_.])(bash|pwsh|powershell|shell|exec|cmd|run|terminal)([-_.]|$)/i.test(name) || name === "exec";
}
function isWriteLike(name) {
  return /(write|edit|patch|replace|apply|insert|update)/i.test(name) || name === "str_replace_editor";
}
function isReadLike(name) {
  return /(read|list|stat|exists|find|glob|grep|search|inspect|fetch)/i.test(name);
}
function isTestLike(name, record) {
  if (/(test|spec|vitest|jest|pytest|go test)/i.test(name)) {
    return true;
  }
  const command = str(record.arguments.command) ?? str(record.arguments.cmd) ?? str(record.arguments.script) ?? "";
  return /(^|\s)(vitest|jest|pytest|go test|npm test|pnpm test|yarn test|npm run test)(\s|$)/i.test(command);
}
function pathFrom(record) {
  return str(record.arguments.path) ?? str(record.arguments.file_path) ?? str(record.arguments.filepath) ?? str(record.arguments.file) ?? str(record.arguments.target);
}
function isNonEvidenceTool(name) {
  return /update_goal|_goal|set_verification_plan|get_verification_plan|reset_verification_plan|pro_review|verification_plan/i.test(name);
}
function commandOutputResult(record) {
  const exitCode = num(pick(record, "exitCode", "exit_code", "code"));
  const stdout = str(pick(record, "stdout", "output", "out"));
  const stderr = str(pick(record, "stderr", "error"));
  const command = str(record.arguments.command) ?? str(record.arguments.cmd) ?? str(record.arguments.script) ?? str(record.arguments.args) ?? record.name;
  const effectiveExitCode = record.isError ? exitCode ?? 1 : exitCode;
  return {
    evidenceType: "command_output",
    payload: {
      command,
      exitCode: effectiveExitCode,
      ...stdout !== void 0 ? { stdout } : {},
      ...stderr !== void 0 ? { stderr } : {}
    }
  };
}
function testRunResult(record) {
  const output = str(pick(record, "stdout", "output")) ?? str(pick(record, "outputText", "text")) ?? extractTextFromContent(record.content);
  const exitCode = num(pick(record, "exitCode", "exit_code", "code")) ?? (record.isError ? 1 : 0);
  const parsed = parseTestOutput(output ?? "");
  return {
    evidenceType: "test_run",
    payload: {
      output,
      exitCode,
      passCount: parsed.passCount,
      failCount: parsed.failCount,
      failures: parsed.failures,
      files: parsed.files
    }
  };
}
function fileDiffResult(record) {
  const path = pathFrom(record) ?? str(pick(record, "path"));
  const diff = str(pick(record, "diff", "patch"));
  const after = str(pick(record, "after"));
  const content = str(pick(record, "content", "text")) ?? after;
  const bytesValue = typeof record.value === "object" && record.value !== null ? record.value.bytes : void 0;
  return {
    evidenceType: "file_diff",
    payload: {
      ...path !== void 0 ? { path } : {},
      ...diff !== void 0 ? { diff } : {},
      ...content !== void 0 ? { content } : {},
      ...bytesValue !== void 0 ? { bytes: bytesValue } : {},
      error: record.isError ? true : void 0
    }
  };
}
function fileExistsOrQuoteResult(record) {
  const path = pathFrom(record);
  const exists = pick(record, "exists", "found", "matched", "hits");
  const isError = record.isError;
  const existence = exists !== void 0 ? Boolean(exists) : isError ? false : record.name.includes("exists") || record.name.includes("stat") ? true : void 0;
  if (existence === void 0) {
    const cleanText = str(pick(record, "text")) ?? (typeof pick(record, "content") === "string" ? pick(record, "content") : void 0) ?? str(pick(record, "quote"));
    const text = cleanText !== void 0 && cleanText.length > 0 ? cleanText : extractTextFromContent(record.content);
    return {
      evidenceType: "quote_with_location",
      payload: {
        ...path !== void 0 ? { path } : {},
        ...text.length > 0 ? { quote: text.slice(0, 2e3) } : {},
        error: isError ? true : void 0
      }
    };
  }
  return {
    evidenceType: "file_exists",
    payload: {
      ...path !== void 0 ? { path } : {},
      exists: existence,
      error: isError ? true : void 0
    }
  };
}
function deriveCaptured(record, options) {
  if (isNonEvidenceTool(record.name)) {
    return null;
  }
  let extracted = null;
  if (options.parseTestRuns !== false && isTestLike(record.name, record)) {
    extracted = testRunResult(record);
  } else if (isExecLike(record.name)) {
    extracted = commandOutputResult(record);
  } else if (isWriteLike(record.name)) {
    extracted = fileDiffResult(record);
  } else if (isReadLike(record.name)) {
    extracted = fileExistsOrQuoteResult(record);
  } else {
    return null;
  }
  const normalizedArgs = canonicalizeArgs(record.arguments);
  return {
    callId: record.callId,
    toolIdentity: record.name,
    schemaVersion: 1,
    normalizedArgs,
    normalizedArgsHash: normalizedArgsHash(record.arguments),
    evidenceType: extracted.evidenceType,
    payload: extracted.payload,
    producedBy: "tool",
    failed: record.isError,
    contractIdentity: options.contractIdentity
  };
}
export {
  AcceptanceCriterionSchema,
  BoundEvidenceSchema,
  CapturedEvidenceSchema,
  ConstraintSchema,
  ContractIdentitySchema,
  ContractRefSchema,
  EvidenceTypeSchema,
  EvidenceTypeValues,
  GateResultSchema,
  MAX_CAPTURED_BYTES,
  MAX_CAPTURED_EVIDENCE,
  MAX_EVIDENCE_PAYLOAD_BYTES,
  OracleHintSchema,
  OracleTierSchema,
  SelectorV1Schema,
  SourceBasisEntrySchema,
  SourceBasisSchema,
  TaskContractSchema,
  VerdictResultSchema,
  VerdictSchema,
  canonicalArgsToPlain,
  canonicalize,
  canonicalizeArgs,
  computeBasisHash,
  computeContractContentHash,
  contentHash,
  contractIdentityOf,
  deriveCaptured,
  deriveEpochId,
  evidenceTypesCompatible,
  extractTextFromContent,
  formatTestFailureContext,
  identitiesEqual,
  isBoundEvidence,
  isPlainObject,
  normalizePathLexically,
  normalizedArgsHash,
  parseTestOutput,
  selectorKey,
  selectorRefOf,
  stableHash,
  textHash
};
//# sourceMappingURL=index.js.map