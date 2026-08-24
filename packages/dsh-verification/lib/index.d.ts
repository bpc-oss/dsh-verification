import { Service, Context } from '@deepseek-ai/cordis';
import z$1 from '@deepseek-ai/schemastery';
import * as _deepseek_ai_dsh_scope from '@deepseek-ai/dsh-scope';
import * as _deepseek_ai_dsh_agent from '@deepseek-ai/dsh-agent';
import { Agent } from '@deepseek-ai/dsh-agent';
import { z } from 'zod';
import { TaskContract, ContractIdentity, EvidenceType, Verdict, GateResultSchema, BoundEvidence, AcceptanceCriterion, OracleHint, Constraint, ToolRecord, GateResult, OracleTier, Evidence } from '@bpc-oss/dsh-evidence';
import { StreamChunk } from '@deepseek-ai/dsh-llm';

interface GoalLogEvent {
    type: string;
    data: unknown;
    seq: number;
    time: number;
}
interface FoldedEpoch {
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
/**
 * 从 session goal 日志折叠任务 epoch。
 * v11 放宽：窗口内无权威用户消息的 root create 以 goal create 自身 seq 为 rootSeq 建 epoch（不 fail-closed）。
 */
declare function foldTaskEpochs(events: readonly GoalLogEvent[], sessionId: string): FoldedEpoch[];
declare function currentActiveEpoch(epochs: readonly FoldedEpoch[]): FoldedEpoch | undefined;
/** 增量 epoch fold（projection 注册表 apply 用；与批处理 foldTaskEpochs 语义一致）。 */
interface IncrementalEpochState {
    epochs: FoldedEpoch[];
    lastUserSeqOutsideActive: number;
}
declare function applyEpochEvent(state: IncrementalEpochState, event: GoalLogEvent, sessionId: string): IncrementalEpochState;

declare const VERIFICATION_CHANGE_VERSION = 1;
/** Immutable authority boundary for every durable verification fact. */
declare const AuthorityScopeSchema: z.ZodObject<{
    epochId: z.ZodString;
    rootGoalId: z.ZodString;
    ownerAgentId: z.ZodString;
}, z.core.$strict>;
type AuthorityScope = z.infer<typeof AuthorityScopeSchema>;
/** Policy-relevant facts captured before evidence blob persistence. */
declare const PolicyFactsSchema: z.ZodObject<{
    paths: z.ZodArray<z.ZodString>;
    networkCalls: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
type PolicyFacts = z.infer<typeof PolicyFactsSchema>;
/**
 * verification 域 append-only 记录（v9）。
 * 每次提交一条不可变记录；投影折叠由所有记录确定性派生。
 * 依据：`dsh-plugin-port-plan.md` §1 / P0-1 文档 §4.4（epoch 由 goal log 权威，observer 不追加）。
 */
type VerificationRecord = {
    kind: 'plan';
    contract: TaskContract;
    authorityScope?: AuthorityScope;
    frozenAt?: {
        callId: string;
        at: number;
    };
} | {
    kind: 'evidence';
    callId: string;
    toolIdentity: string;
    normalizedArgsHash: string;
    blobHash: string;
    originalLength: number;
    rawHash: string;
    truncated: boolean;
    completeness: 'complete' | 'truncated';
    schemaVersion: number;
    contractIdentity: ContractIdentity;
    evidenceType: EvidenceType;
    resultSeq: number;
    summary: string;
    authorityScope?: AuthorityScope;
    policyFacts?: PolicyFacts;
} | {
    kind: 'capture-failure';
    contractIdentity: ContractIdentity;
    callId: string;
    toolIdentity: string;
    normalizedArgsHash: string;
    evidenceType: EvidenceType;
    resultSeq: number;
    error: string;
    authorityScope?: AuthorityScope;
    policyFacts?: PolicyFacts;
} | {
    kind: 'challenge';
    questionId: string;
    challengeKind: 'contract' | 'completion';
    identity: ContractIdentity;
    gateSnapshotHash?: string;
    consumed: boolean;
    authorityScope?: AuthorityScope;
} | {
    kind: 'permit';
    permitRef: string;
    goalId: string;
    goalRevision: number;
    contractIdentity: ContractIdentity;
    gateSnapshotHash: string;
    configHash: string;
    ttlMs: number;
    authorityScope?: AuthorityScope;
} | {
    kind: 'verdicts';
    verdicts: Record<string, Verdict>;
    authorityScope?: AuthorityScope;
} | {
    kind: 'gate';
    entry: GateSummary;
};
/** SessionEventMap 载荷（v9：每条 verification/change 事件承载一条不可变记录）。 */
interface VerificationChangeEventData {
    kind: 'verification/change';
    version: typeof VERIFICATION_CHANGE_VERSION;
    record: VerificationRecord;
}
/** 任务 epoch（v9：goal-bound；active/closed；仅 root create 建立）。
 *  2026-08-15（P0 修复 #1）：与 `FoldedEpoch` 字段契约统一——新增 createdSeq（必填）/closedSeq（可选），
 *  contentHash 改 optional（当前无写入点，不得以空串兜底）。 */
declare const TaskEpochRecordSchema: z.ZodObject<{
    epochId: z.ZodString;
    rootSeq: z.ZodNumber;
    contentHash: z.ZodOptional<z.ZodString>;
    rootGoalId: z.ZodOptional<z.ZodString>;
    status: z.ZodEnum<{
        active: "active";
        closed: "closed";
    }>;
    createdSeq: z.ZodNumber;
    closedSeq: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
type TaskEpochRecord = z.infer<typeof TaskEpochRecordSchema>;
/** 把增量 epoch 状态折叠为 schema 可校验的视图（显式白名单，绝不外泄未知字段）。 */
declare function taskEpochViews(epochs: readonly FoldedEpoch[]): TaskEpochRecord[];
/** 计划视图：契约 + 冻结标记（冻结先于副作用）。 */
declare const VerificationPlanViewSchema: z.ZodObject<{
    contract: z.ZodObject<{
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
                test: "test";
                run: "run";
                schema: "schema";
                review: "review";
                human: "human";
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
    authorityScope: z.ZodOptional<z.ZodObject<{
        epochId: z.ZodString;
        rootGoalId: z.ZodString;
        ownerAgentId: z.ZodString;
    }, z.core.$strict>>;
    frozenAt: z.ZodOptional<z.ZodObject<{
        callId: z.ZodString;
        at: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strict>;
type VerificationPlanView = z.infer<typeof VerificationPlanViewSchema>;
declare const EvidenceRefSchema: z.ZodObject<{
    callId: z.ZodString;
    toolIdentity: z.ZodString;
    normalizedArgsHash: z.ZodString;
    blobHash: z.ZodString;
    truncated: z.ZodBoolean;
    originalLength: z.ZodNumber;
    schemaVersion: z.ZodNumber;
    contractIdentity: z.ZodObject<{
        contractId: z.ZodString;
        revision: z.ZodNumber;
        contractContentHash: z.ZodString;
        basisHash: z.ZodString;
        sessionId: z.ZodString;
    }, z.core.$strict>;
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
    resultSeq: z.ZodNumber;
    summary: z.ZodString;
    authorityScope: z.ZodOptional<z.ZodObject<{
        epochId: z.ZodString;
        rootGoalId: z.ZodString;
        ownerAgentId: z.ZodString;
    }, z.core.$strict>>;
    policyFacts: z.ZodOptional<z.ZodObject<{
        paths: z.ZodArray<z.ZodString>;
        networkCalls: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
declare const CaptureFailureRecordSchema: z.ZodObject<{
    kind: z.ZodOptional<z.ZodLiteral<"capture-failure">>;
    contractIdentity: z.ZodObject<{
        contractId: z.ZodString;
        revision: z.ZodNumber;
        contractContentHash: z.ZodString;
        basisHash: z.ZodString;
        sessionId: z.ZodString;
    }, z.core.$strict>;
    callId: z.ZodString;
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
    resultSeq: z.ZodNumber;
    error: z.ZodString;
    authorityScope: z.ZodOptional<z.ZodObject<{
        epochId: z.ZodString;
        rootGoalId: z.ZodString;
        ownerAgentId: z.ZodString;
    }, z.core.$strict>>;
    policyFacts: z.ZodOptional<z.ZodObject<{
        paths: z.ZodArray<z.ZodString>;
        networkCalls: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
type CaptureFailureRecord = z.infer<typeof CaptureFailureRecordSchema>;
declare const ChallengeRecordSchema: z.ZodObject<{
    kind: z.ZodOptional<z.ZodLiteral<"challenge">>;
    questionId: z.ZodString;
    challengeKind: z.ZodEnum<{
        contract: "contract";
        completion: "completion";
    }>;
    identity: z.ZodObject<{
        contractId: z.ZodString;
        revision: z.ZodNumber;
        contractContentHash: z.ZodString;
        basisHash: z.ZodString;
        sessionId: z.ZodString;
    }, z.core.$strict>;
    gateSnapshotHash: z.ZodOptional<z.ZodString>;
    consumed: z.ZodBoolean;
    authorityScope: z.ZodOptional<z.ZodObject<{
        epochId: z.ZodString;
        rootGoalId: z.ZodString;
        ownerAgentId: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
type ChallengeRecord = z.infer<typeof ChallengeRecordSchema>;
declare const CompletionPermitRecordSchema: z.ZodObject<{
    kind: z.ZodOptional<z.ZodLiteral<"permit">>;
    permitRef: z.ZodString;
    goalId: z.ZodString;
    goalRevision: z.ZodNumber;
    contractIdentity: z.ZodObject<{
        contractId: z.ZodString;
        revision: z.ZodNumber;
        contractContentHash: z.ZodString;
        basisHash: z.ZodString;
        sessionId: z.ZodString;
    }, z.core.$strict>;
    gateSnapshotHash: z.ZodString;
    configHash: z.ZodString;
    ttlMs: z.ZodNumber;
    authorityScope: z.ZodOptional<z.ZodObject<{
        epochId: z.ZodString;
        rootGoalId: z.ZodString;
        ownerAgentId: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
type CompletionPermitRecord = z.infer<typeof CompletionPermitRecordSchema>;
/** gate 摘要（写事件用；与投影同构）。 */
declare const GateSummarySchema: z.ZodObject<{
    at: z.ZodNumber;
    status: z.ZodEnum<{
        done: "done";
        failed: "failed";
        blocked: "blocked";
    }>;
    mode: z.ZodEnum<{
        enforce: "enforce";
        advisory: "advisory";
    }>;
    reasons: z.ZodArray<z.ZodString>;
    authorityScope: z.ZodOptional<z.ZodObject<{
        epochId: z.ZodString;
        rootGoalId: z.ZodString;
        ownerAgentId: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
type GateSummary = z.infer<typeof GateSummarySchema>;
/** Strict durable-event decoder. Never cast or silently skip malformed authority facts. */
declare const VerificationRecordSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"plan">;
    contract: z.ZodObject<{
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
                test: "test";
                run: "run";
                schema: "schema";
                review: "review";
                human: "human";
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
    authorityScope: z.ZodOptional<z.ZodObject<{
        epochId: z.ZodString;
        rootGoalId: z.ZodString;
        ownerAgentId: z.ZodString;
    }, z.core.$strict>>;
    frozenAt: z.ZodOptional<z.ZodObject<{
        callId: z.ZodString;
        at: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"evidence">;
    callId: z.ZodString;
    toolIdentity: z.ZodString;
    normalizedArgsHash: z.ZodString;
    blobHash: z.ZodString;
    originalLength: z.ZodNumber;
    rawHash: z.ZodString;
    truncated: z.ZodBoolean;
    completeness: z.ZodEnum<{
        truncated: "truncated";
        complete: "complete";
    }>;
    schemaVersion: z.ZodNumber;
    contractIdentity: z.ZodObject<{
        contractId: z.ZodString;
        revision: z.ZodNumber;
        contractContentHash: z.ZodString;
        basisHash: z.ZodString;
        sessionId: z.ZodString;
    }, z.core.$strict>;
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
    resultSeq: z.ZodNumber;
    summary: z.ZodString;
    authorityScope: z.ZodOptional<z.ZodObject<{
        epochId: z.ZodString;
        rootGoalId: z.ZodString;
        ownerAgentId: z.ZodString;
    }, z.core.$strict>>;
    policyFacts: z.ZodOptional<z.ZodObject<{
        paths: z.ZodArray<z.ZodString>;
        networkCalls: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"capture-failure">;
    contractIdentity: z.ZodObject<{
        contractId: z.ZodString;
        revision: z.ZodNumber;
        contractContentHash: z.ZodString;
        basisHash: z.ZodString;
        sessionId: z.ZodString;
    }, z.core.$strict>;
    callId: z.ZodString;
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
    resultSeq: z.ZodNumber;
    error: z.ZodString;
    authorityScope: z.ZodOptional<z.ZodObject<{
        epochId: z.ZodString;
        rootGoalId: z.ZodString;
        ownerAgentId: z.ZodString;
    }, z.core.$strict>>;
    policyFacts: z.ZodOptional<z.ZodObject<{
        paths: z.ZodArray<z.ZodString>;
        networkCalls: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"challenge">;
    questionId: z.ZodString;
    challengeKind: z.ZodEnum<{
        contract: "contract";
        completion: "completion";
    }>;
    identity: z.ZodObject<{
        contractId: z.ZodString;
        revision: z.ZodNumber;
        contractContentHash: z.ZodString;
        basisHash: z.ZodString;
        sessionId: z.ZodString;
    }, z.core.$strict>;
    gateSnapshotHash: z.ZodOptional<z.ZodString>;
    consumed: z.ZodBoolean;
    authorityScope: z.ZodOptional<z.ZodObject<{
        epochId: z.ZodString;
        rootGoalId: z.ZodString;
        ownerAgentId: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"permit">;
    permitRef: z.ZodString;
    goalId: z.ZodString;
    goalRevision: z.ZodNumber;
    contractIdentity: z.ZodObject<{
        contractId: z.ZodString;
        revision: z.ZodNumber;
        contractContentHash: z.ZodString;
        basisHash: z.ZodString;
        sessionId: z.ZodString;
    }, z.core.$strict>;
    gateSnapshotHash: z.ZodString;
    configHash: z.ZodString;
    ttlMs: z.ZodNumber;
    authorityScope: z.ZodOptional<z.ZodObject<{
        epochId: z.ZodString;
        rootGoalId: z.ZodString;
        ownerAgentId: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"verdicts">;
    verdicts: z.ZodRecord<z.ZodString, z.ZodObject<{
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
    }, z.core.$strict>>;
    authorityScope: z.ZodOptional<z.ZodObject<{
        epochId: z.ZodString;
        rootGoalId: z.ZodString;
        ownerAgentId: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"gate">;
    entry: z.ZodObject<{
        at: z.ZodNumber;
        status: z.ZodEnum<{
            done: "done";
            failed: "failed";
            blocked: "blocked";
        }>;
        mode: z.ZodEnum<{
            enforce: "enforce";
            advisory: "advisory";
        }>;
        reasons: z.ZodArray<z.ZodString>;
        authorityScope: z.ZodOptional<z.ZodObject<{
            epochId: z.ZodString;
            rootGoalId: z.ZodString;
            ownerAgentId: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
}, z.core.$strict>], "kind">;
/** 完整投影（v9）。epoch 由 goal log 派生；其余由记录折叠。 */
declare const VerificationProjectionSchema: z.ZodObject<{
    taskEpochs: z.ZodArray<z.ZodObject<{
        epochId: z.ZodString;
        rootSeq: z.ZodNumber;
        contentHash: z.ZodOptional<z.ZodString>;
        rootGoalId: z.ZodOptional<z.ZodString>;
        status: z.ZodEnum<{
            active: "active";
            closed: "closed";
        }>;
        createdSeq: z.ZodNumber;
        closedSeq: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    plan: z.ZodNullable<z.ZodObject<{
        contract: z.ZodObject<{
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
                    test: "test";
                    run: "run";
                    schema: "schema";
                    review: "review";
                    human: "human";
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
        authorityScope: z.ZodOptional<z.ZodObject<{
            epochId: z.ZodString;
            rootGoalId: z.ZodString;
            ownerAgentId: z.ZodString;
        }, z.core.$strict>>;
        frozenAt: z.ZodOptional<z.ZodObject<{
            callId: z.ZodString;
            at: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strict>>;
    evidenceRefs: z.ZodArray<z.ZodObject<{
        callId: z.ZodString;
        toolIdentity: z.ZodString;
        normalizedArgsHash: z.ZodString;
        blobHash: z.ZodString;
        truncated: z.ZodBoolean;
        originalLength: z.ZodNumber;
        schemaVersion: z.ZodNumber;
        contractIdentity: z.ZodObject<{
            contractId: z.ZodString;
            revision: z.ZodNumber;
            contractContentHash: z.ZodString;
            basisHash: z.ZodString;
            sessionId: z.ZodString;
        }, z.core.$strict>;
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
        resultSeq: z.ZodNumber;
        summary: z.ZodString;
        authorityScope: z.ZodOptional<z.ZodObject<{
            epochId: z.ZodString;
            rootGoalId: z.ZodString;
            ownerAgentId: z.ZodString;
        }, z.core.$strict>>;
        policyFacts: z.ZodOptional<z.ZodObject<{
            paths: z.ZodArray<z.ZodString>;
            networkCalls: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    captureFailures: z.ZodArray<z.ZodObject<{
        kind: z.ZodOptional<z.ZodLiteral<"capture-failure">>;
        contractIdentity: z.ZodObject<{
            contractId: z.ZodString;
            revision: z.ZodNumber;
            contractContentHash: z.ZodString;
            basisHash: z.ZodString;
            sessionId: z.ZodString;
        }, z.core.$strict>;
        callId: z.ZodString;
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
        resultSeq: z.ZodNumber;
        error: z.ZodString;
        authorityScope: z.ZodOptional<z.ZodObject<{
            epochId: z.ZodString;
            rootGoalId: z.ZodString;
            ownerAgentId: z.ZodString;
        }, z.core.$strict>>;
        policyFacts: z.ZodOptional<z.ZodObject<{
            paths: z.ZodArray<z.ZodString>;
            networkCalls: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    challenges: z.ZodRecord<z.ZodString, z.ZodObject<{
        kind: z.ZodOptional<z.ZodLiteral<"challenge">>;
        questionId: z.ZodString;
        challengeKind: z.ZodEnum<{
            contract: "contract";
            completion: "completion";
        }>;
        identity: z.ZodObject<{
            contractId: z.ZodString;
            revision: z.ZodNumber;
            contractContentHash: z.ZodString;
            basisHash: z.ZodString;
            sessionId: z.ZodString;
        }, z.core.$strict>;
        gateSnapshotHash: z.ZodOptional<z.ZodString>;
        consumed: z.ZodBoolean;
        authorityScope: z.ZodOptional<z.ZodObject<{
            epochId: z.ZodString;
            rootGoalId: z.ZodString;
            ownerAgentId: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    completionPermits: z.ZodArray<z.ZodObject<{
        kind: z.ZodOptional<z.ZodLiteral<"permit">>;
        permitRef: z.ZodString;
        goalId: z.ZodString;
        goalRevision: z.ZodNumber;
        contractIdentity: z.ZodObject<{
            contractId: z.ZodString;
            revision: z.ZodNumber;
            contractContentHash: z.ZodString;
            basisHash: z.ZodString;
            sessionId: z.ZodString;
        }, z.core.$strict>;
        gateSnapshotHash: z.ZodString;
        configHash: z.ZodString;
        ttlMs: z.ZodNumber;
        authorityScope: z.ZodOptional<z.ZodObject<{
            epochId: z.ZodString;
            rootGoalId: z.ZodString;
            ownerAgentId: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    verdicts: z.ZodRecord<z.ZodString, z.ZodObject<{
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
    }, z.core.$strict>>;
    verdictAuthorityScope: z.ZodNullable<z.ZodObject<{
        epochId: z.ZodString;
        rootGoalId: z.ZodString;
        ownerAgentId: z.ZodString;
    }, z.core.$strict>>;
    gateLog: z.ZodArray<z.ZodObject<{
        at: z.ZodNumber;
        status: z.ZodEnum<{
            done: "done";
            failed: "failed";
            blocked: "blocked";
        }>;
        mode: z.ZodEnum<{
            enforce: "enforce";
            advisory: "advisory";
        }>;
        reasons: z.ZodArray<z.ZodString>;
        authorityScope: z.ZodOptional<z.ZodObject<{
            epochId: z.ZodString;
            rootGoalId: z.ZodString;
            ownerAgentId: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    updatedAt: z.ZodNumber;
}, z.core.$strip>;
type VerificationProjection = z.infer<typeof VerificationProjectionSchema>;
declare function emptyVerificationProjection(): VerificationProjection;
/** 从一条 append-only 记录折叠进投影状态（纯函数）。 */
declare function applyVerificationRecord(state: VerificationProjection, record: VerificationRecord, eventMetadata: {
    seq: number;
    time: number;
}): VerificationProjection;
/** 从会话事件日志提取 verification/change 记录（per-session fold 用）。 */
declare function extractVerificationRecords(events: readonly {
    type: string;
    data: unknown;
    seq: number;
    time: number;
}[]): Array<{
    record: VerificationRecord;
    seq: number;
    time: number;
}>;
/** 折叠一批验证记录到投影（用于重建/重放）。 */
declare function foldVerificationRecords(state: VerificationProjection, records: Array<{
    record: VerificationRecord;
    seq: number;
    time: number;
}>): VerificationProjection;
declare function gateResultOf(entry: GateSummary): z.infer<typeof GateResultSchema>;

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
        'verification/changed'(this: _deepseek_ai_dsh_scope.Scoped<_deepseek_ai_dsh_agent.Agent>, payload: {
            agent: _deepseek_ai_dsh_agent.Agent;
            change: {
                operation: 'change';
                projection: VerificationProjection;
            };
        }): void;
    }
}

/**
 * 服务端 exact-only selector 绑定（v9 §4.5 / v11 §1）。
 * 输入：冻结的 SelectorV1 + 已提交的 evidence refs / capture failures + blob 读取。
 * 规则：
 *  - 一证据一 AC（每条未绑定证据只绑定一个 AC；重复 exact selector 在契约生成期拒绝）；
 *  - 每个 selector 只裁决当前 contract identity 内最高 committed result seq；
 *    最高 seq 对应 capture-failure / 失败证据 / blob 缺失 → AC fail，不得回退更早 PASS；
 *  - BoundEvidence 只能由服务端 binder 产生（模型自报 acId 一律拒绝）。
 */

interface BindingContext {
    contractIdentity: ContractIdentity;
    refs: EvidenceRef[];
    captureFailures: CaptureFailureRecord[];
    loadBlob: (key: string) => Promise<Uint8Array | null>;
}
type BoundOutcome = {
    kind: 'not-harnessed';
    reason: string;
} | {
    kind: 'bound';
    evidence: BoundEvidence;
    resultSeq: number;
    familyFallback?: boolean;
} | {
    kind: 'no-evidence';
    reason: string;
} | {
    kind: 'missing-blob';
    reason: string;
} | {
    kind: 'capture-failure';
    reason: string;
};
interface BindOptions {
    /**
     * 2026-08-17（完成任务能力修复）：file 族兜底。
     * exact selector 无匹配时，允许用作用域内同族真实证据（file_diff/file_exists/quote_with_location 互认，
     * 任意工具产生均可）绑定——避免"交付物由 write/edit 产生而冻结 selector 是 glob/read"导致的假阴性。
     * 安全语义：仅当 exact 无匹配时启用；绑定结果带 familyFallback 标记，裁决 detail 注明，可审计。
     */
    familyFallback?: boolean;
    /**
     * 2026-08-18（v9.3 修）：run 族命令对齐的额外提示（来自整个契约的其他 AC 描述）。
     * 原因：run AC 描述常只写"验证意图"（如"输出显示全部通过"），命令是实现细节，
     * 单条描述提取的特征 token 可能不在命令里（如 AssertionError）；而文件类 AC 的描述
     * 会提到交付物（same_chars.py），命令 python same_chars.py 含其文件名 → 契约级提示可对齐。
     */
    familyExtraHints?: string[];
}
/** 绑定一个 AC 的 selector（产出 BoundEvidence 或明确的失败原因）。 */
declare function bindSelectorForAc(ac: AcceptanceCriterion, ctx: BindingContext, evidenceTypeFor: (ac: AcceptanceCriterion) => EvidenceType, opts?: BindOptions): Promise<BoundOutcome>;
/** 契约生成期校验：两个 AC 使用同一 exact selector → 拒绝契约。 */
declare function findDuplicateSelectors(acs: ReadonlyArray<AcceptanceCriterion>): Array<{
    acId: string;
    selectorKey: string;
}>;

/** 用户提交的 AC 建议（服务端据此 + 工具 schema 冻结 exact selector；无 tool → AC 走 T2/T4）。 */
interface AcProposal {
    id: string;
    desc: string;
    oracleHint: OracleHint;
    tool?: string;
    args?: Record<string, unknown>;
}
interface PlanProposal {
    goal_value: string;
    acceptance_criteria: AcProposal[];
    constraints: Constraint[];
    inputs: string[];
    outOfScope: string[];
}
interface BasisRuntimeEntry {
    kind: 'user-message' | 'attachment' | 'control-doc' | 'user-correction';
    eventRef: string;
    seq: number;
    text: string;
}
/** 从权威用户消息收集 sourceBasis 运行时条目（按 seq 升序；调用方保证起点/终点）。 */
declare function collectBasisEntries(messages: Array<{
    eventRef: string;
    seq: number;
    text: string;
}>): BasisRuntimeEntry[];
/** 把运行时条目物化为持久化 schema（contentHash 存文本 hash）。 */
declare function materializeBasis(sessionId: string, entries: BasisRuntimeEntry[]): {
    sessionId: string;
    entries: {
        kind: "user-message" | "attachment" | "control-doc" | "user-correction";
        eventRef: string;
        seq: number;
        contentHash: string;
    }[];
    basisHash: string;
};
/** sourceBasis 全文（独立捕获的 grader 唯一输入）。 */
declare function basisPromptText(entries: BasisRuntimeEntry[]): string;
interface MintOptions {
    sessionId: string;
    origin: 'independent-capture' | 'human-confirmed' | 'model-self-declared' | string;
    goal: string;
    acceptanceCriteria: AcceptanceCriterion[];
    constraints: Constraint[];
    inputs: string[];
    outOfScope: string[];
    basis: BasisRuntimeEntry[];
    /** 契约内容 hash 手工覆盖（re-basis 校验旧内容用；正常走 compute） */
    contentHashOverride?: string;
}
/** 服务端 mint：确定性 contractId + 服务端 revision + 内容/basis hash（模型提交值一律忽略）。 */
declare function mintContract(options: MintOptions): TaskContract;
/** re-basis：新 revision 0 + 新 contractId（新 contentHash），同 session。 */
declare function rebaseContract(previous: TaskContract): TaskContract;
/** 服务端生成的一次性 contract approval challenge 状态（questionId 为稳定引用）。 */
interface ContractChallengeState {
    questionId: string;
    contract: TaskContract;
}
declare function createContractChallenge(contract: TaskContract, questionId: string): ContractChallengeState;

interface BlobStore {
    write(bytes: Uint8Array): Promise<string>;
    read(key: string): Promise<Uint8Array | null>;
    has(key: string): Promise<boolean>;
    delete(key: string): Promise<void>;
}
/** 内存实现（测试/单进程）。 */
declare function createMemoryBlobStore(): BlobStore;
/** 文件实现（生产原型；atomic tmp+rename，内容寻址）。 */
declare function createFileBlobStore(dir: string): BlobStore;
interface StoredPayload {
    blobKey: string;
    originalLength: number;
    rawHash: string;
    truncated: boolean;
    completeness: 'complete' | 'truncated';
}
/** 规范化证据载荷持久化：原子写 blob 并返回元数据。 */
declare function storePayload(store: BlobStore, payload: unknown, maxBytes?: number): Promise<StoredPayload>;

/**
 * CompletionPermit + strict replay validator（v9 §4.2 / v11 §1 第 9 条）。
 * 纯函数。TTL 权威时间只信 SessionEvent envelope 的 seq/time，expiry = permitEvent.time + 冻结 config ttlMs；
 * permit payload 不含 issued/expiry。未知 configHash、ttl 不匹配、无 permit、permit 晚于 complete、
 * 提交时已过期或 identity/快照漂移 → fail closed。
 */

/** 冻结配置快照：configHash → 唯一合法 TTL。 */
interface FrozenPermitPolicy {
    configHash: string;
    completionPermitTtlMs: number;
    schemaVersion: number;
}
interface PermitLogEntry {
    record: CompletionPermitRecord;
    /** 承载该 permit 的 verification/change 事件的 envelope seq。 */
    seq: number;
    /** 承载该 permit 的 verification/change 事件的 envelope time。 */
    time: number;
}
interface CompletedGoalFacts {
    goalId: string;
    goalRevision: number;
    /** Exact immutable permit reference persisted on the complete event. */
    permitRef: string;
    completeSeq: number;
    completeTime: number;
}
type PermitValidation = {
    ok: true;
    permitSeq: number;
    usedPermitRef: string;
} | {
    ok: false;
    reason: string;
};
declare function newPermitRef(): string;
/** 确定性 gate 快照 hash：契约身份 + 已提交裁决 + 证据 blob/失败 + 配置 + schema 版本。 */
declare function computeGateSnapshotHash(input: {
    contractIdentity: ContractIdentity;
    verdicts: Record<string, unknown>;
    evidenceBlobHashes: string[];
    captureFailures: number;
    configHash: string;
    schemaVersion: number;
}): string;
/**
 * strict replay validator：验证一次 committed complete（goal 快照已结束在 revision R）在
 * 事件顺序与提交时 TTL 下是否有 valid permit。permit→complete 绑定按
 * complete 事件持久化的 permitRef 精确匹配。不得回退至最新匹配 permit。
 */
declare function validatePermitForCompletion(input: {
    completed: CompletedGoalFacts;
    /** complete 事件之前已提交的 permit 记录（seq < completeSeq）。 */
    permits: PermitLogEntry[];
    policies: Record<string, FrozenPermitPolicy>;
    contractIdentity: ContractIdentity;
    gateSnapshotHash: string;
}): PermitValidation;

/**
 * 验证服务（v9）。
 * 状态来源：session goal 日志折叠 epoch + append-only verification 记录折叠 projection。
 * 唯一持久化写路径 = commit(agent, record)：追加一条 verification/change 记录到 session。
 */
interface VerificationRuntimeConfig {
    mode: 'enforce' | 'advisory';
    maxCapturedEvidence: number;
    maxCapturedBytes: number;
    completionPermitTtlMs: number;
    configHash: string;
    enableDeterministic: boolean;
    enableAssistantResponse: boolean;
    enableCoverage: boolean;
    enableProReview: boolean;
    proReviewProvider: string;
    globalConstraints: Constraint[];
    intent: {
        consensusCount: number;
        provider?: string;
        model?: string;
        contractOrigin: 'independent-capture' | 'human-confirmed';
        maxEntries: number;
    };
    readOnlyToolAllowlist: string[];
    /** 2026-08-17：file 族 AC 精确绑定失败时启用族内证据兜底（减少假阴性）。 */
    binderFamilyFallback: boolean;
    /** 人类确认通道（P0-1 review：apply 注入 dsh approval/service；测试可注入；agent+decision 上下文随附）。 */
    askUser?: (question: {
        agent: Agent;
        questionId: string;
        text: string;
        choices: string[];
    }) => Promise<string | undefined>;
}
interface ServiceDeps {
    store?: BlobStore;
    clock?: () => number;
}
declare class VerificationError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
declare class VerificationService extends Service {
    private readonly config;
    static inject: string[];
    private readonly caches;
    private readonly store;
    private readonly clock;
    /** 最近一次独立捕获失败的根因（供 enforce 拒绝信息 — S1-2：origin 标签诚实 + 失败显式化）。 */
    private captureUnavailableReason?;
    /** S3-4：会话内"已处理（在途/成功/失败）"的可采集 callId —— 对账对它们免于误报。 */
    private readonly handledCallsBySession;
    constructor(ctx: Context, config: VerificationRuntimeConfig, deps?: ServiceDeps);
    /** S3-4 对账重入保护：commit → cache() → sync 的递归有界（每次只落一条缺口）。 */
    private reconciling;
    private cache;
    private sync;
    private allEvents;
    getProjection(agent: Agent): VerificationProjection;
    getActiveEpoch(agent: Agent): FoldedEpoch | undefined;
    /**
     * 2026-08-19（enforce preset 审查发现）：agent 是否参与过验证系统（会话里有 verification/change 事件）。
     * goal transition guard 是进程级全局（GOAL_TRANSITION_GUARDS），enforce 实例的 guard 会拦截
     * 所有会话的 complete；用此方法把"从未使用验证的会话"（其他 preset）放行，避免 enforce 泄漏到全局。
     */
    hasVerificationActivity(agent: Agent): boolean;
    /**
     * 2026-08-20（enforce preset）：per-agent 生效模式。
     * 引擎保持全局（advisory），但 agentPreset === 'enforce-standard' 的会话按 enforce 处理——
     * preset 不再挂载第二个引擎实例（loader 挂载机制 + 全局实例共存问题），
     * 只靠 agentPreset 激活 enforce 语义（gate 拦截 + guard 强制）。
     * agentPreset 位于 session.header.agentPreset（会话创建头，resolveSessionPreset 读取），
     * 非 agent 顶层/meta 字段（2026-08-20 两次修正后确定）。
     */
    modeOf(agent: Agent): 'enforce' | 'advisory';
    private requireCurrentAuthorityScope;
    getPlanView(agent: Agent): VerificationPlanView | null;
    /** 公开 blob 读取（pro_review / 工具用）。 */
    readBlob(key: string): Promise<Uint8Array | null>;
    getContract(agent: Agent): TaskContract | null;
    isFrozen(agent: Agent): boolean;
    /**
     * 2026-08-18 加固（live enforce 演示暴露）：agent 可在 update_goal edit 后重声明契约、
     * 删除/弱化已冻结的验收标准（demo：删掉 output_file AC，让错交付物通过）。
     * 返回同 rootGoalId 下**最新一条 frozenAt 的契约**（agent 已承诺执行过的基准）。
     */
    private latestFrozenContractForGoal;
    requireGoalBoundEpoch(agent: Agent, goalId: string, goalRevision: number): FoldedEpoch;
    collectSourceBasis(agent: Agent): BasisRuntimeEntry[];
    /** set_verification_plan：提案 → 服务端冻结 selector → 独立捕获/人类确认 → mint + attach。 */
    setPlanFromProposal(agent: Agent, goalId: string, goalRevision: number, proposal: PlanProposal): Promise<{
        ok: true;
        contract: TaskContract;
    } | {
        ok: false;
        reason: string;
    }>;
    private tryIndependentCapture;
    freezePlan(agent: Agent, callId: string): void;
    /** reset_verification_plan：同一 epoch 内 re-basis（新 contractId + revision 0），不关闭任务。 */
    resetPlan(agent: Agent): TaskContract | null;
    /** advisory 观测：evaluation_error 也落 gate 摘要（never-throw 语义在调用方）。 */
    commitGateError(agent: Agent, error: unknown): void;
    captureEvidence(agent: Agent, record: ToolRecord, resultSeq: number): Promise<void>;
    recordCaptureFailure(agent: Agent, failure: {
        contractIdentity: ContractIdentity;
        callId: string;
        toolIdentity: string;
        normalizedArgsHash: string;
        evidenceType: EvidenceType;
        resultSeq: number;
        error: string;
        authorityScope: AuthorityScope;
        policyFacts: PolicyFacts;
    }): void;
    evaluateGate(agent: Agent): Promise<{
        gate: GateResult;
        snapshotHash: string;
        bindings: Map<string, BoundOutcome>;
    }>;
    private judgeAc;
    private oracleList;
    private inferredPaths;
    /**
     * S2-2/S3-1：network 型工具调用，**从 durable `tool/call` 事件重建**（非内存瞬态）——
     * 服务重启/插件缺席期后从会话日志重放得到，`network:` 禁令不回退 fail-open。
     */
    private networkCallsOf;
    /**
     * S3-4 对账（§4.4）：契约存在后，每个"可采集"durable `tool/call` 必须对应
     * 一条 evidenceRef 或 captureFailure（当前 identity）；缺口落 **durable capture-failure**
     *（不在内存里静默）：这是崩溃/插件缺席/重放场景的 fail-closed 底座。幂等 + 重入有界。
     */
    private reconcileDurableCalls;
    private currentSnapshotHash;
    /** 异步 prepare：gate done + goal ref 有效才落 durable permit。 */
    prepareGoalCompletion(agent: Agent, goalId: string, goalRevision: number): Promise<void>;
    /** 同步 guard（GoalTransitionGuard seam 调用点）：零 mutation，先校验后放行。 */
    assertCompletionPermit(agent: Agent, goalId: string, goalRevision: number): PermitValidation;
    /** S3-4：标记一次工具调用已被本进程（post-execute）处理——对账对其免于"缺口"误报。 */
    markToolCallHandled(agent: Agent, callId: string): void;
    private commit;
}

/** 裁判原始裁决（无 contractIdentity；engine 统一盖章）。 */
type VerdictBody = Omit<Verdict, 'contractIdentity'>;
/** 裁判接口：对一条 AC + bound evidence 给出裁决（Bobby 移植）。 */
interface Oracle {
    readonly tier: OracleTier;
    readonly name: string;
    canJudge(ac: AcceptanceCriterion, evidence: Evidence[]): boolean;
    judge(ac: AcceptanceCriterion, evidence: Evidence[]): Promise<VerdictBody>;
}
declare function tierRank(tier: OracleTier): number;
declare function stampVerdict(body: VerdictBody, identity: ContractIdentity): Verdict;

/**
 * 验证引擎（v9）：只接受 bound evidence（acId 精确匹配）；
 * 按裁判硬度从硬到软选择，并把 contractIdentity 统一盖章进裁决。
 */
declare class VerificationEngine {
    private readonly oracles;
    constructor(oracles: Oracle[]);
    verify(ac: AcceptanceCriterion, evidence: Evidence[], contractIdentity: ContractIdentity): Promise<Verdict>;
}

interface ExecContext {
    touchedPaths: string[];
    networkCalls?: string[];
}
interface ConstraintResult {
    id: string;
    result: 'pass' | 'fail' | 'need_human';
    detail?: string;
}
interface ConstraintChecker {
    matches(c: Constraint): boolean;
    check(c: Constraint, ctx: ExecContext): ConstraintResult;
}
/** 当前支持的机器可检禁令语法：`path:<forbidden-prefix>`（移植）与 `network:`（扩展）。 */
declare function isMachineCheckableConstraintCheck(check: string): boolean;
declare class NoForbiddenPathChecker implements ConstraintChecker {
    matches(c: Constraint): boolean;
    check(c: Constraint, ctx: ExecContext): ConstraintResult;
}
declare class NoNetworkChecker implements ConstraintChecker {
    matches(c: Constraint): boolean;
    check(c: Constraint, ctx: ExecContext): ConstraintResult;
}
declare function enforceConstraints(constraints: Constraint[], ctx: ExecContext, checkers: ConstraintChecker[]): ConstraintResult[];
declare const DEFAULT_CHECKERS: ConstraintChecker[];

/**
 * 完成闸门：任务不得显示"完成"，除非每条验收标准都有 pass 裁决、
 * 每条禁令后置校验通过、任何 need_human 项都已获人类确认。
 * 移植自 Bobby `conscience/gate.ts`。
 */
declare class CompletionGate {
    evaluate(contract: TaskContract, verdicts: Map<string, Verdict>, constraints: ConstraintResult[]): GateResult;
}

/** 全局禁令库：把部署级禁令合入每个意图契约（Bobby `config/constraints-library.ts` 移植）。 */
declare class ConstraintsLibrary {
    private readonly global;
    constructor(global: Constraint[]);
    applyTo(contract: TaskContract): TaskContract;
}

interface GateHookConfig {
    mode: 'enforce' | 'advisory';
    readOnlyAllowlist: string[];
    /**
     * P0-1 review（定位修正）：明确写入类工具集——只有这些工具在
     * enforce + requireContractBeforeExecution + 无契约时才被 missing_contract 拒绝。
     * 缺省使用内置 DEFAULT_WRITE_TOOLS；显式传入可覆盖。
     */
    writeTools?: string[];
    /**
     * 2026-08-15（P0 修复 #3）：把"是否在未声明契约时拦截副作用工具"从 mode 中拆出。
     * P0-1 review：默认按 mode 推演（仅 enforce → true）。read/grep 等只读工具**永不拦**，
     * 拦截只作用于 writeTools 内名单。
     */
    requireContractBeforeExecution?: boolean;
}
/** 固定 bootstrap 白名单（v10：内置枚举，不可扩展；create 建 goal-bound epoch，plan 只 attach）。 */
declare const BOOTSTRAP_WHITELIST: string[];
declare function renderDefects(gate: GateResult): string;
/**
 * 完成闸门 + 冻结（v9）。
 * `tools/pre-execute`：
 *  - bootstrap 白名单 → 放行；
 *  - 只读 allowlist → 放行（不触发冻结）；
 *  - 其余工具（含未知/MCP/Code Mode 嵌套）：
 *      enforce 无契约 → deny missing_contract；有契约未冻结 → 先冻结再放行；
 *      advisory 无契约 → 放行。
 *  - update_goal complete：enforce = evaluate（异常 deny evaluation_error）→ done 才解析 goal_id/revision → mint permit → 放行；
 *      advisory = 包住整个 evaluate（异常记 evaluation_error），无论成败只 next 一次。
 */
declare function installCompleteGateHook(ctx: Context, service: VerificationService, config: GateHookConfig): void;

/**
 * 证据采集（v9）：`tools/post-execute` 派生 **CapturedEvidence**（unbound）→
 * 服务端持久化为内容寻址 blob + 追加 evidence 记录。
 * 无契约 identity → unbound telemetry，不触发 capture failure。
 * 本监听器 pass-through：内部任何失败都被 captureEvidence 收敛或在此吞掉，绝不断链 `next()`。
 * network: 禁令的数据源已移到 durable `tool/call` 折叠（service.reconcileDurableCalls 同源重建），
 * 此处不再重复记录。
 */
declare function installEvidenceCapture(ctx: Context, service: VerificationService): void;

/** 注册 set_verification_plan / get_verification_plan / reset_verification_plan。 */
declare function installIntentTools(ctx: Context, service: VerificationService): void;

/**
 * `pro_review` 工具（v9）：模型可主动请求 Pro 对抗审查（独立于完成闸门自动 T2 路径）。
 * 对指定 AC（或整个计划）以 spawn（non-inheriting，T2 决策门）跑敌意审查，返回结构化缺陷清单。
 */

declare function installProReviewTool(ctx: Context, service: VerificationService, provider: string): void;

/**
 * GoalTransitionGuard seam 安装器（v9 §4.2 / v11 §1 第 9 条）。
 * 依赖 vendored dsh-goal 提供的 `registerTransitionGuard`（同步 pre-commit 校验，向后兼容）。
 * seam 未合入（上游原包）时返回 undefined——模型路径仍由 tools/pre-execute 护栏承载，
 * 且 strict replay（validatePermitForCompletion）不依赖该 seam 即可在重放时强制执行。
 */

interface GoalTransitionGuardRequest {
    agent: Agent;
    operation: string;
    goalId: string;
    /** 完成前的 goal revision（permit 绑定的是完成前 revision）。 */
    currentRevision: number;
}
type GoalTransitionGuardVerdict = {
    kind: 'allow';
    permitRef?: string;
} | {
    kind: 'deny';
    reason: string;
};
type GoalTransitionGuard = (request: GoalTransitionGuardRequest) => GoalTransitionGuardVerdict | undefined;
declare module '@deepseek-ai/dsh-goal' {
    interface GoalService {
        registerTransitionGuard?(guard: GoalTransitionGuard): () => void;
    }
}
/**
 * 把 verification 的完成许可校验注册为 GoalService 的同步 pre-commit guard。
 * 直接调用 `ctx.goals.complete()`（绕过工具 hook）也会被兜住。
 */
declare function installGoalTransitionGuard(ctx: Context, service: VerificationService): (() => void) | undefined;

/**
 * T2 Pro 对抗审查输入/输出契约（移植自 Bobby `conscience/oracles/pro-review.ts` 的 ReviewSchema）。
 * runner 由服务注入（subagents fork 实现），使 oracle 保持纯逻辑、可单测。
 */
interface ProReviewInput {
    ac: AcceptanceCriterion;
    evidence: Evidence[];
}
interface ReviewDefect {
    severity: 'critical' | 'high' | 'medium';
    acId: string;
    evidence: string;
    mustFix: boolean;
}
interface ReviewOutput {
    verdict: 'pass' | 'fail';
    defects: ReviewDefect[];
    unverifiable: string[];
}
type ProReviewRunner = (input: ProReviewInput) => Promise<ReviewOutput>;
/** 审查者不得读取的执行者自述字段（反共谋）。 */
declare const PROHIBITED_PAYLOAD_FIELDS: Set<string>;
declare function stripSelfNarration(payload: unknown): Record<string, unknown>;
/** 组装给审查者的完整指令（敌意审查 + JSON-only 输出）。 */
declare function buildReviewPrompt(ac: AcceptanceCriterion, evidence: Evidence[]): string;
declare class ProReviewOracle implements Oracle {
    private readonly runner;
    readonly tier: "T2";
    readonly name = "pro-review";
    constructor(runner: ProReviewRunner);
    canJudge(ac: AcceptanceCriterion, evidence: Evidence[]): boolean;
    judge(ac: AcceptanceCriterion, evidence: Evidence[]): Promise<VerdictBody>;
}

/**
 * Pro 对抗审查执行器（v9 §4.3 / v11）。
 * T2 为 upstream authorityIsolation 决策门：rc.6 无 capability → `proReview.enabled` 默认 false；
 * 显式开启而 provider 无能力 → 返回 `need_evidence`（fail closed），不伪造"零工具 reviewer"。
 * 走 `ctx.subagents.start(provider, …)` 一次性 run：独立上下文 + outputSchema + await result + finally dispose。
 */

interface ProReviewRunnerOptions {
    provider: string;
    agent: Agent;
    signal?: AbortSignal;
}
/**
 * 能力检查（决策门）：rc.6 `SubagentStartRequest` 无 preset/setup override，
 * `ToolRestriction` 也不覆盖 scoped/Code Mode → 除非 provider 声明 authorityIsolation，否则视为无能力。
 */
declare function providerHasAuthorityIsolation(ctx: Context, providerName: string): boolean;
declare function createSubagentProReviewRunner(ctx: Context, options: ProReviewRunnerOptions): (input: ProReviewInput) => Promise<ReviewOutput>;

/** T0 确定性裁判：命令真实退出码/输出（移植自 Bobby `oracles/deterministic.ts`）。 */
declare class CommandExitOracle implements Oracle {
    readonly tier: "T0";
    readonly name = "command-exit";
    canJudge(_ac: AcceptanceCriterion, evidence: Evidence[]): boolean;
    judge(ac: AcceptanceCriterion, evidence: Evidence[]): Promise<VerdictBody>;
    private detail;
}
/** T0 确定性裁判：文件真实存在性（移植）。 */
declare class FileExistsOracle implements Oracle {
    readonly tier: "T0";
    readonly name = "file-exists";
    canJudge(_ac: AcceptanceCriterion, evidence: Evidence[]): boolean;
    judge(ac: AcceptanceCriterion, evidence: Evidence[]): Promise<VerdictBody>;
}
/** T0 确定性裁判：文件真实写入/内容（v9.1 真机修复：适配 DSH 工具的真实 payload 形状）。
 *  - file_diff：要求 path 非空，且 (bytes>0 或 diff 非空 或 content/quote 非空) —— 真实 write/edit
 *    canonical value 是 {path, operation, before, after}，不含 bytes；放宽为承载任一实体证据均可。
 *  - quote_with_location：要求 content/quote 非空（read 类工具的自然产出），可全文精确核对。
 */
declare class FileDiffOracle implements Oracle {
    readonly tier: "T0";
    readonly name = "file-diff";
    canJudge(_ac: AcceptanceCriterion, evidence: Evidence[]): boolean;
    /** 从 AC 描述提取路径 token（v9.4：command_output 证据的路径对齐用）。 */
    private pathHints;
    judge(ac: AcceptanceCriterion, evidence: Evidence[]): Promise<VerdictBody>;
    private detail;
}

/** T0 裁判：真实测试运行（test_run 证据：退出码 0 且 failCount === 0）。 */
declare class TestRunOracle implements Oracle {
    readonly tier: "T0";
    readonly name = "test-run";
    canJudge(ac: AcceptanceCriterion, evidence: Evidence[]): boolean;
    judge(ac: AcceptanceCriterion, evidence: Evidence[]): Promise<VerdictBody>;
}
/** T0 裁判：schema 校验证据（schema_valid）。 */
declare class SchemaValidOracle implements Oracle {
    readonly tier: "T0";
    readonly name = "schema-valid";
    canJudge(ac: AcceptanceCriterion, evidence: Evidence[]): boolean;
    judge(ac: AcceptanceCriterion, evidence: Evidence[]): Promise<VerdictBody>;
}
/** T3 留痕裁判：file 类 AC 至少存在一条文件证据（反偷懒：逐项处理必须留痕）。 */
declare class CoverageOracle implements Oracle {
    readonly tier: "T3";
    readonly name = "coverage";
    canJudge(ac: AcceptanceCriterion, evidence: Evidence[]): boolean;
    judge(ac: AcceptanceCriterion, evidence: Evidence[]): Promise<VerdictBody>;
}

/** T3 留痕裁判：逐项核对场景的兜底——助手确有针对该 AC 的真实回应文本（移植）。 */
declare class AssistantResponseOracle implements Oracle {
    readonly tier: "T3";
    readonly name = "assistant-response";
    canJudge(ac: AcceptanceCriterion, evidence: Evidence[]): boolean;
    judge(ac: AcceptanceCriterion, evidence: Evidence[]): Promise<VerdictBody>;
}

/**
 * DeepSeek 专属提示词：直接移植 Bobby `brain/system-prompts.ts` 与 `prompts/system/*.md`。
 * 保留 Bobby 已调校的中文原文（L8：不沿用 Claude/GPT 套路），
 * 另附 DSH 场景的英文指引文本用于 systemPrompt.section。
 */
declare const INTENT_SYSTEM_PROMPT: string;
declare const PRO_REVIEW_SYSTEM_PROMPT: string;
declare const GRADER_INTENT_SYSTEM_PROMPT: string;
/** 注入模型 system prompt 的指引段（DSH 场景，英文，精炼）。P0-1 review：advisory 只记录不 deny。 */
declare function buildVerificationGuidance(config: {
    mode: 'enforce' | 'advisory';
    requireContract: boolean;
    blockedAfter?: number;
}): string;

/**
 * 结构化共识：多次生成 → 稳定规范化 JSON 多数投票（Bobby `brain/structured-consensus.ts` 移植，
 * 去掉 Bobby 特有的 usage/cacheMetadata 载荷，保留核心多数决逻辑）。
 */
type StructuredConsensusSuccess<T> = {
    kind: 'success';
    value: T;
    content: string;
    reasoningContent?: string;
};
type StructuredConsensusAllInvalid = {
    kind: 'all_invalid';
    error: Error;
};
type StructuredConsensusResult<T> = StructuredConsensusSuccess<T> | StructuredConsensusAllInvalid;
interface ConsensusGeneration {
    content: string;
    reasoningContent?: string;
}
declare function runStructuredConsensus<T>(input: {
    consensusCount: number;
    generate: () => Promise<ConsensusGeneration>;
    parse: (content: string) => T;
}): Promise<StructuredConsensusResult<T>>;

/**
 * 程序化 LLM 调用助手：把一次文本补全折叠成完整响应。
 * 供 structured-consensus（意图契约多次生成）与 Pro 对抗审查（T2）使用。
 * 基于 `ctx.llm.stream(GenerateOptions)` 流式接口，纯装配逻辑可单测。
 */

interface CompletionMessage {
    role: 'user' | 'assistant';
    text: string;
}
interface CompleteTextOptions {
    provider: string;
    model: string;
    system?: string;
    messages: CompletionMessage[];
    temperature?: number;
    maxTokens?: number;
    stop?: string[];
    signal?: AbortSignal;
}
interface CompleteTextResult {
    text: string;
    reasoning?: string;
    usage?: unknown;
}
/** 把流式 chunk 折叠成文本（纯函数，可单测）。 */
declare function assembleStream(chunks: Iterable<StreamChunk>): {
    text: string;
    reasoning: string;
};
/** 程序化文本补全（失败抛错；调用方负责 provider/model 的可用性）。 */
declare function completeText(ctx: Context, options: CompleteTextOptions): Promise<CompleteTextResult>;

declare const name = "verification";
declare const inject: string[];
/**
 * 只读工具（评审定位修正）：DSH 真实工具名，永不拦截。
 * 2026-08-15（P0-1 review）：旧表用的是 Bobby/Codex 工具名（read_file/list_dir/search），
 * 与 DSH 实际工具面（read/grep/glob/...）对不上，enforce 下 `read` 会以 missing_contract 误拒。
 * 语义已反转（见 DEFAULT_WRITE_TOOLS 注释）：只读工具不在此表也默认放行，此表仅作显式打磨。
 */
declare const DEFAULT_READ_ONLY_TOOLS: string[];
/**
 * 明确写入类工具（评审定位修正）：只有这些工具在 enforce + requireContractBeforeExecution
 * 且无契约时才被 missing_contract 拒绝。其余（只读 + 未识别/未知/MCP/dsh 未来新增）默认放行——
 * 验证系统是"可观测增强层"，不是"所有工具的默认 gate"。
 */
declare const DEFAULT_WRITE_TOOLS: string[];
/** 插件配置（P0-1 review：默认 advisory——可选插件，opt-in 才 enforce）。 */
declare const Config: z$1<VerificationConfig>;
interface VerificationConfig {
    mode: 'enforce' | 'advisory';
    maxCapturedEvidence: number;
    maxCapturedBytes: number;
    completionPermitTtlMs: number;
    oracles: {
        deterministic: boolean;
        assistantResponse: boolean;
        coverage: {
            enabled: boolean;
        };
        proReview: {
            enabled: boolean;
            provider: string;
            maxDefects: number;
        };
    };
    constraints: Array<{
        id: string;
        desc: string;
        check: string;
    }>;
    intent: {
        requireContractBeforeExecution?: boolean;
        contractOrigin: 'independent-capture' | 'human-confirmed';
        freezeOnHumanConfirm: boolean;
        consensusCount: number;
        provider?: string;
        model?: string;
        readOnlyToolAllowlist: string[];
        sourceBasis: {
            includeAttachments: boolean;
            includeControlDocs: boolean;
            maxEntries: number;
        };
    };
    blobDir?: string;
    systemPromptSection: boolean;
    binderFamilyFallback: boolean;
}
declare function resolveConfig(config: Partial<VerificationConfig>): VerificationConfig;
/** 冻结配置 hash：permit strict replay 的 configHash 权威（ttl + oracle 版本 + schema 版本）。 */
declare function computeConfigHash(config: VerificationConfig): string;
declare function apply(ctx: Context, config: Partial<VerificationConfig>): void;
/**
 * P0-1 review：人类确认复用 DSH 官方 approval/permission 通道（`ctx.approval.request`）——
 * 带 `approval/asked` + `approval/decided` 审计、session policy（ask/never）、fail-closed 语义，
 * 不再自建 askUser 通道。approval 未挂载时兜底回退 dsh userQuestions.ask（向后兼容）。
 * `allowed-once` → `approve`；其余（rejected/cancelled/unavailable）→ `decline`。
 */
declare function resolveAskUser(ctx: Context): VerificationService['config']['askUser'];

export { type AcProposal, AssistantResponseOracle, type AuthorityScope, AuthorityScopeSchema, BOOTSTRAP_WHITELIST, type BasisRuntimeEntry, type BindingContext, type BlobStore, type BoundOutcome, type CaptureFailureRecord, CaptureFailureRecordSchema, type ChallengeRecord, ChallengeRecordSchema, CommandExitOracle, type CompleteTextOptions, type CompleteTextResult, type CompletedGoalFacts, CompletionGate, type CompletionMessage, type CompletionPermitRecord, CompletionPermitRecordSchema, Config, type ConsensusGeneration, type ConstraintChecker, type ConstraintResult, ConstraintsLibrary, CoverageOracle, DEFAULT_CHECKERS, DEFAULT_READ_ONLY_TOOLS, DEFAULT_WRITE_TOOLS, type EvidenceRef, EvidenceRefSchema, type ExecContext, FileDiffOracle, FileExistsOracle, type FoldedEpoch, type FrozenPermitPolicy, GRADER_INTENT_SYSTEM_PROMPT, type GateHookConfig, type GateSummary, GateSummarySchema, type GoalTransitionGuard, type GoalTransitionGuardRequest, type GoalTransitionGuardVerdict, INTENT_SYSTEM_PROMPT, NoForbiddenPathChecker, NoNetworkChecker, type Oracle, PROHIBITED_PAYLOAD_FIELDS, PRO_REVIEW_SYSTEM_PROMPT, type PermitLogEntry, type PermitValidation, type PlanProposal, type PolicyFacts, PolicyFactsSchema, type ProReviewInput, ProReviewOracle, type ProReviewRunner, type ProReviewRunnerOptions, type ReviewDefect, type ReviewOutput, SchemaValidOracle, type ServiceDeps, type StoredPayload, type StructuredConsensusResult, type TaskEpochRecord, TaskEpochRecordSchema, TestRunOracle, VERIFICATION_CHANGE_VERSION, type VerdictBody, type VerificationChangeEventData, type VerificationConfig, VerificationEngine, VerificationError, type VerificationPlanView, VerificationPlanViewSchema, type VerificationProjection, VerificationProjectionSchema, type VerificationRecord, VerificationRecordSchema, type VerificationRuntimeConfig, VerificationService, apply, applyEpochEvent, applyVerificationRecord, assembleStream, basisPromptText, bindSelectorForAc, buildReviewPrompt, buildVerificationGuidance, collectBasisEntries, completeText, computeConfigHash, computeGateSnapshotHash, createContractChallenge, createFileBlobStore, createMemoryBlobStore, createSubagentProReviewRunner, currentActiveEpoch, emptyVerificationProjection, enforceConstraints, extractVerificationRecords, findDuplicateSelectors, foldTaskEpochs, foldVerificationRecords, gateResultOf, inject, installCompleteGateHook, installEvidenceCapture, installGoalTransitionGuard, installIntentTools, installProReviewTool, isMachineCheckableConstraintCheck, materializeBasis, mintContract, name, newPermitRef, providerHasAuthorityIsolation, rebaseContract, renderDefects, resolveAskUser, resolveConfig, runStructuredConsensus, stampVerdict, storePayload, stripSelfNarration, taskEpochViews, tierRank, validatePermitForCompletion };
