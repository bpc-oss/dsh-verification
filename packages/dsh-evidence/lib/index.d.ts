import { z } from 'zod';

/**
 * 证据域 schema（v9 两态模型 + SelectorV1 + 唯一身份五元组）。
 * 契约权威：`docs/dsh-p01-verification-port-plan.md` v9 / `docs/dsh-plugin-port-plan.md` v11 §1。
 * Bobby 移植：证据契约 `shared/contracts/evidence.ts` —— "模型不得代笔转述（L1/L3）"保留，
 * acId 归属改为服务端 exact-only selector 绑定。
 */
/** 证据类型：由工具/沙箱直接产出。 */
declare const EvidenceTypeSchema: z.ZodEnum<{
    test_run: "test_run";
    command_output: "command_output";
    file_diff: "file_diff";
    file_exists: "file_exists";
    schema_valid: "schema_valid";
    symbol_exists: "symbol_exists";
    quote_with_location: "quote_with_location";
    assistant_response: "assistant_response";
    pro_review: "pro_review";
    human_ack: "human_ack";
}>;
type EvidenceType = z.infer<typeof EvidenceTypeSchema>;
declare const EvidenceTypeValues: readonly EvidenceType[];
/** 证据类型全等或同族互认（供 binder/selector 匹配使用）。 */
declare function evidenceTypesCompatible(left: EvidenceType, right: EvidenceType): boolean;
/**
 * 唯一身份五元组（v6）：contractId + revision + contractContentHash + basisHash + sessionId。
 * Evidence/Verdict 持久化携带；gate 逐字段全等比较。
 */
declare const ContractIdentitySchema: z.ZodObject<{
    contractId: z.ZodString;
    revision: z.ZodNumber;
    contractContentHash: z.ZodString;
    basisHash: z.ZodString;
    sessionId: z.ZodString;
}, z.core.$strict>;
type ContractIdentity = z.infer<typeof ContractIdentitySchema>;
declare function identitiesEqual(left: ContractIdentity, right: ContractIdentity): boolean;
/**
 * SelectorV1（v11：v1 exact-only）。
 * 冻结于契约 AC：system 只匹配 toolIdentity + normalizedArgsHash + evidenceType 的全等。
 */
declare const SelectorV1Schema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    toolIdentity: z.ZodString;
    normalizedArgsHash: z.ZodString;
    evidenceType: z.ZodEnum<{
        test_run: "test_run";
        command_output: "command_output";
        file_diff: "file_diff";
        file_exists: "file_exists";
        schema_valid: "schema_valid";
        symbol_exists: "symbol_exists";
        quote_with_location: "quote_with_location";
        assistant_response: "assistant_response";
        pro_review: "pro_review";
        human_ack: "human_ack";
    }>;
}, z.core.$strict>;
type SelectorV1 = z.infer<typeof SelectorV1Schema>;
/** Selector 的稳定引用 id（同一契约 revision 内唯一）：`<contractId>:<revision>:<acId>`。 */
declare function selectorRefOf(identity: ContractIdentity, acId: string): string;
/** 同一契约内两个 AC 冻结出相同 selector（exact 全等）→ 拒绝契约。 */
declare function selectorKey(selector: SelectorV1): string;
/**
 * 捕获态证据（v9）：无 acId / selectorRef。
 * 普通 bash/fs 调用不携带 AC 身份——模型自报一律拒绝。
 * 由 `tools/post-execute` 派生并持久化（内容寻址 blob），服务端 binder 才产生 BoundEvidence。
 */
declare const CapturedEvidenceSchema: z.ZodObject<{
    callId: z.ZodString;
    toolIdentity: z.ZodString;
    schemaVersion: z.ZodDefault<z.ZodLiteral<1>>;
    normalizedArgs: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    normalizedArgsHash: z.ZodString;
    evidenceType: z.ZodEnum<{
        test_run: "test_run";
        command_output: "command_output";
        file_diff: "file_diff";
        file_exists: "file_exists";
        schema_valid: "schema_valid";
        symbol_exists: "symbol_exists";
        quote_with_location: "quote_with_location";
        assistant_response: "assistant_response";
        pro_review: "pro_review";
        human_ack: "human_ack";
    }>;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    producedBy: z.ZodDefault<z.ZodEnum<{
        tool: "tool";
        flash: "flash";
        pro: "pro";
        human: "human";
    }>>;
    failed: z.ZodDefault<z.ZodBoolean>;
    contractIdentity: z.ZodObject<{
        contractId: z.ZodString;
        revision: z.ZodNumber;
        contractContentHash: z.ZodString;
        basisHash: z.ZodString;
        sessionId: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
type CapturedEvidence = z.infer<typeof CapturedEvidenceSchema>;
/** 绑定态证据（v9）：captured + 服务端 acId + selectorRef。仅由 binder 产生。 */
declare const BoundEvidenceSchema: z.ZodObject<{
    callId: z.ZodString;
    toolIdentity: z.ZodString;
    schemaVersion: z.ZodDefault<z.ZodLiteral<1>>;
    normalizedArgs: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    normalizedArgsHash: z.ZodString;
    evidenceType: z.ZodEnum<{
        test_run: "test_run";
        command_output: "command_output";
        file_diff: "file_diff";
        file_exists: "file_exists";
        schema_valid: "schema_valid";
        symbol_exists: "symbol_exists";
        quote_with_location: "quote_with_location";
        assistant_response: "assistant_response";
        pro_review: "pro_review";
        human_ack: "human_ack";
    }>;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    producedBy: z.ZodDefault<z.ZodEnum<{
        tool: "tool";
        flash: "flash";
        pro: "pro";
        human: "human";
    }>>;
    failed: z.ZodDefault<z.ZodBoolean>;
    contractIdentity: z.ZodObject<{
        contractId: z.ZodString;
        revision: z.ZodNumber;
        contractContentHash: z.ZodString;
        basisHash: z.ZodString;
        sessionId: z.ZodString;
    }, z.core.$strict>;
    acId: z.ZodString;
    selectorRef: z.ZodString;
}, z.core.$strict>;
type BoundEvidence = z.infer<typeof BoundEvidenceSchema>;
/** 引擎只接受 bound 视图。 */
declare function isBoundEvidence(value: unknown): value is BoundEvidence;
/** 兼容别名（v9：engine 眼中的"证据"即 bound evidence）。 */
type Evidence = BoundEvidence;
declare const VerdictResultSchema: z.ZodEnum<{
    pass: "pass";
    fail: "fail";
    need_human: "need_human";
}>;
type VerdictResult = z.infer<typeof VerdictResultSchema>;
declare const OracleTierSchema: z.ZodEnum<{
    T0: "T0";
    T1: "T1";
    T2: "T2";
    T3: "T3";
    T4: "T4";
}>;
type OracleTier = z.infer<typeof OracleTierSchema>;
/** 裁决（v9）：携带 contractIdentity 快照；gate 全等比较。claimId 允许空串以兼容旧版无证据裁决记录。 */
declare const VerdictSchema: z.ZodObject<{
    claimId: z.ZodString;
    acId: z.ZodString;
    result: z.ZodEnum<{
        pass: "pass";
        fail: "fail";
        need_human: "need_human";
    }>;
    oracleTier: z.ZodEnum<{
        T0: "T0";
        T1: "T1";
        T2: "T2";
        T3: "T3";
        T4: "T4";
    }>;
    contractIdentity: z.ZodObject<{
        contractId: z.ZodString;
        revision: z.ZodNumber;
        contractContentHash: z.ZodString;
        basisHash: z.ZodString;
        sessionId: z.ZodString;
    }, z.core.$strict>;
    detail: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
type Verdict = z.infer<typeof VerdictSchema>;
/** 一次完成闸门评估的结果。 */
declare const GateResultSchema: z.ZodObject<{
    status: z.ZodEnum<{
        failed: "failed";
        done: "done";
        blocked: "blocked";
    }>;
    reasons: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
type GateResult = z.infer<typeof GateResultSchema>;
/** 捕获态硬上限（v9）：超限停止采集并写 durable capture-failure，gate fail closed。 */
declare const MAX_CAPTURED_EVIDENCE = 200;
declare const MAX_CAPTURED_BYTES: number;
/** 单条证据 payload 上限：超限截断并标记 completeness（256KB）。 */
declare const MAX_EVIDENCE_PAYLOAD_BYTES: number;

/** 验收标准可用的裁判提示（Bobby oracle_hint 移植）。 */
declare const OracleHintSchema: z.ZodEnum<{
    file: "file";
    human: "human";
    test: "test";
    run: "run";
    schema: "schema";
    review: "review";
}>;
type OracleHint = z.infer<typeof OracleHintSchema>;
/**
 * 一条验收标准。
 * `selector` 为服务端冻结的 exact-only 证据选择器（可选）：
 * 无法为 AC 生成 exact selector → 该 AC 走 T2/T4 或 need_evidence，不生成宽泛模式。
 */
declare const AcceptanceCriterionSchema: z.ZodObject<{
    id: z.ZodString;
    desc: z.ZodString;
    oracleHint: z.ZodEnum<{
        file: "file";
        human: "human";
        test: "test";
        run: "run";
        schema: "schema";
        review: "review";
    }>;
    selector: z.ZodOptional<z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        toolIdentity: z.ZodString;
        normalizedArgsHash: z.ZodString;
        evidenceType: z.ZodEnum<{
            test_run: "test_run";
            command_output: "command_output";
            file_diff: "file_diff";
            file_exists: "file_exists";
            schema_valid: "schema_valid";
            symbol_exists: "symbol_exists";
            quote_with_location: "quote_with_location";
            assistant_response: "assistant_response";
            pro_review: "pro_review";
            human_ack: "human_ack";
        }>;
    }, z.core.$strict>>;
}, z.core.$strict>;
type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;
/** 一条禁令：`check` 仅支持机器可检语法 `path:<prefix>` / `network:`，其余转人工/Pro 复核。 */
declare const ConstraintSchema: z.ZodObject<{
    id: z.ZodString;
    desc: z.ZodString;
    check: z.ZodString;
}, z.core.$strict>;
type Constraint = z.infer<typeof ConstraintSchema>;
/** sourceBasis 条目类型（v6）。 */
declare const SourceBasisEntrySchema: z.ZodObject<{
    kind: z.ZodEnum<{
        "user-message": "user-message";
        attachment: "attachment";
        "control-doc": "control-doc";
        "user-correction": "user-correction";
    }>;
    eventRef: z.ZodString;
    seq: z.ZodNumber;
    contentHash: z.ZodString;
}, z.core.$strict>;
type SourceBasisEntry = z.infer<typeof SourceBasisEntrySchema>;
/** sourceBasis（v6：服务端按确定 task boundary 收集，非模型指定）。 */
declare const SourceBasisSchema: z.ZodObject<{
    sessionId: z.ZodString;
    entries: z.ZodArray<z.ZodObject<{
        kind: z.ZodEnum<{
            "user-message": "user-message";
            attachment: "attachment";
            "control-doc": "control-doc";
            "user-correction": "user-correction";
        }>;
        eventRef: z.ZodString;
        seq: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>>;
    basisHash: z.ZodString;
}, z.core.$strict>;
type SourceBasis = z.infer<typeof SourceBasisSchema>;
/** 计算 basisHash：sessionId + 有序条目集合的稳定 hash（防删减/乱序/跨 session 替换）。 */
declare function computeBasisHash(sessionId: string, entries: SourceBasisEntry[]): string;
/** ContractRef（v6：服务端 mint；模型提交的 id/revision/hash 一律忽略/拒绝）。 */
declare const ContractRefSchema: z.ZodObject<{
    contractId: z.ZodString;
    revision: z.ZodNumber;
    contractContentHash: z.ZodString;
    sourceBasis: z.ZodObject<{
        sessionId: z.ZodString;
        entries: z.ZodArray<z.ZodObject<{
            kind: z.ZodEnum<{
                "user-message": "user-message";
                attachment: "attachment";
                "control-doc": "control-doc";
                "user-correction": "user-correction";
            }>;
            eventRef: z.ZodString;
            seq: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>>;
        basisHash: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
type ContractRef = z.infer<typeof ContractRefSchema>;
/** 意图契约（v6；S1-2 真机修复：origin 增加 `model-self-declared` 以反映降级路径真实来源）。 */
declare const TaskContractSchema: z.ZodObject<{
    ref: z.ZodObject<{
        contractId: z.ZodString;
        revision: z.ZodNumber;
        contractContentHash: z.ZodString;
        sourceBasis: z.ZodObject<{
            sessionId: z.ZodString;
            entries: z.ZodArray<z.ZodObject<{
                kind: z.ZodEnum<{
                    "user-message": "user-message";
                    attachment: "attachment";
                    "control-doc": "control-doc";
                    "user-correction": "user-correction";
                }>;
                eventRef: z.ZodString;
                seq: z.ZodNumber;
                contentHash: z.ZodString;
            }, z.core.$strict>>;
            basisHash: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>;
    origin: z.ZodEnum<{
        "independent-capture": "independent-capture";
        "human-confirmed": "human-confirmed";
        "model-self-declared": "model-self-declared";
    }>;
    goal: z.ZodString;
    acceptanceCriteria: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        desc: z.ZodString;
        oracleHint: z.ZodEnum<{
            file: "file";
            human: "human";
            test: "test";
            run: "run";
            schema: "schema";
            review: "review";
        }>;
        selector: z.ZodOptional<z.ZodObject<{
            schemaVersion: z.ZodLiteral<1>;
            toolIdentity: z.ZodString;
            normalizedArgsHash: z.ZodString;
            evidenceType: z.ZodEnum<{
                test_run: "test_run";
                command_output: "command_output";
                file_diff: "file_diff";
                file_exists: "file_exists";
                schema_valid: "schema_valid";
                symbol_exists: "symbol_exists";
                quote_with_location: "quote_with_location";
                assistant_response: "assistant_response";
                pro_review: "pro_review";
                human_ack: "human_ack";
            }>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    constraints: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        desc: z.ZodString;
        check: z.ZodString;
    }, z.core.$strict>>>;
    inputs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    outOfScope: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
type TaskContract = z.infer<typeof TaskContractSchema>;
/** 从契约推导唯一身份五元组。 */
declare function contractIdentityOf(contract: TaskContract): ContractIdentity;
/** 契约内容体（不含 ref/origin；用于内容 hash 与 mint 前的形状约束）。 */
interface ContractBodyShape {
    goal: string;
    acceptanceCriteria: AcceptanceCriterion[];
    constraints: Constraint[];
    inputs: string[];
    outOfScope: string[];
}
/** 契约内容 hash（goal + ACs + constraints + inputs + outOfScope；不含 ref/sourceBasis/origin）。 */
declare function computeContractContentHash(contract: ContractBodyShape): string;

/** 路径 lexical 归一：反斜杠→正斜杠、折叠 `./` 与 `a/../b`、去掉末尾 `/` 与前导 `./`。 */
declare function normalizePathLexically(path: string): string;
/** 工具 schema 默认值展开后的参数再规范化（binder 先做 default 展开再调用本函数）。 */
declare function canonicalizeArgs(args: Record<string, unknown>): Record<string, unknown>;
/** 候选证据侧参数 hash（binder 用它匹配冻结 SelectorV1.normalizedArgsHash）。 */
declare function normalizedArgsHash(args: Record<string, unknown>): string;
/** 规范化参数的确定性展示（UI/诊断，防泄漏内部 repr）。 */
declare function canonicalArgsToPlain(args: Record<string, unknown>): unknown;

/**
 * 证据推导（v9）：把一次工具调用记录映射为 **CapturedEvidence**（无 acId）。
 * canonical value 只在 tools/post-execute 可见；DSH 不把 value 写入 durable events，
 * 因此证据本体由服务端持久化为内容寻址 blob（dsh-verification/evidence-store）。
 * 模型没有"代笔转述"通道（Bobby L1/L3）。
 */

/** 一次工具调用的最小记录形状（dsh-verification 的 evidence-capture 从 DSH 执行对象适配而来）。 */
interface ToolRecord {
    callId: string;
    /** 工具 identity：内置注册名或 `mcp:<server>/<tool>`。 */
    name: string;
    /** 已解析的参数（lossless JSON）。 */
    arguments: Record<string, unknown>;
    /** 调用是否失败（工具抛出或被阻断）。 */
    isError: boolean;
    /** 成功时的 canonical value（仅 post-execute 可见）。 */
    value?: unknown;
    /** 模型可见的渲染内容（ContentBlock[] 或字符串）。 */
    content?: unknown;
    /** 工具私有展示投影。 */
    meta?: unknown;
}
/** 把 DSH 的 ContentBlock 数组/字符串/未知值压平成文本。 */
declare function extractTextFromContent(content: unknown): string;
interface DeriveOptions {
    /** 捕获时的契约身份五元组（无契约身份 → 捕获层上游判定不产生证据）。 */
    contractIdentity: ContractIdentity;
    /** 是否把 exec-like 且命令像测试运行器的记录解析为 test_run。默认 true。 */
    parseTestRuns?: boolean;
}
/**
 * 从工具调用记录推导 **一条** CapturedEvidence（unbound）。
 * 返回 null 表示该调用不产生可采集证据（不在捕获名单内 → 上游不落 blob）。
 */
declare function deriveCaptured(record: ToolRecord, options: DeriveOptions): CapturedEvidence | null;

/**
 * 规范化哈希工具（v9）：stable canonical JSON 哈希。
 * 对象键稳定排序；数组保持顺序；字符串原样。用于：
 *  - `normalizedArgsHash`（selector 参数规范化）
 *  - `contractContentHash`（契约内容）
 *  - `basisHash`（sourceBasis 条目序列）
 *  - 内容寻址 blob key（evidence payload）
 */
declare function isPlainObject(value: unknown): value is Record<string, unknown>;
/** 稳定排序键的规范化值（递归）。undefined 省略；number NaN/Infinity 归一为 null。 */
declare function canonicalize(value: unknown): unknown;
/** 稳定 hash（sha256 hex）。 */
declare function stableHash(value: unknown): string;
/** 原始字节 hash（内容寻址 blob 用）。 */
declare function contentHash(bytes: Uint8Array): string;
declare function textHash(text: string): string;
/** epochId 派生：sha256(sessionId:goalId:createSeq)。 */
declare function deriveEpochId(sessionId: string, goalId: string, createSeq: number): string;

/**
 * 测试输出解析：从测试运行器的真实 stdout 提取 pass/fail 计数与失败清单。
 * 直接移植自 Bobby `packages/kernel/src/conscience/test-feedback.ts`。
 */
interface TestFailure {
    title: string;
    file: string;
    message: string;
}
interface ParsedTestOutput {
    passCount: number;
    failCount: number;
    failures: TestFailure[];
    files: string[];
    errorMessages: string[];
}
declare function parseTestOutput(text: string): ParsedTestOutput;
declare const formatTestFailureContext: (parsed: ParsedTestOutput) => string;

export { type AcceptanceCriterion, AcceptanceCriterionSchema, type BoundEvidence, BoundEvidenceSchema, type CapturedEvidence, CapturedEvidenceSchema, type Constraint, ConstraintSchema, type ContractBodyShape, type ContractIdentity, ContractIdentitySchema, type ContractRef, ContractRefSchema, type DeriveOptions, type Evidence, type EvidenceType, EvidenceTypeSchema, EvidenceTypeValues, type GateResult, GateResultSchema, MAX_CAPTURED_BYTES, MAX_CAPTURED_EVIDENCE, MAX_EVIDENCE_PAYLOAD_BYTES, type OracleHint, OracleHintSchema, type OracleTier, OracleTierSchema, type ParsedTestOutput, type SelectorV1, SelectorV1Schema, type SourceBasis, type SourceBasisEntry, SourceBasisEntrySchema, SourceBasisSchema, type TaskContract, TaskContractSchema, type TestFailure, type ToolRecord, type Verdict, type VerdictResult, VerdictResultSchema, VerdictSchema, canonicalArgsToPlain, canonicalize, canonicalizeArgs, computeBasisHash, computeContractContentHash, contentHash, contractIdentityOf, deriveCaptured, deriveEpochId, evidenceTypesCompatible, extractTextFromContent, formatTestFailureContext, identitiesEqual, isBoundEvidence, isPlainObject, normalizePathLexically, normalizedArgsHash, parseTestOutput, selectorKey, selectorRefOf, stableHash, textHash };
