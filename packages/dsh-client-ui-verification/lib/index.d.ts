import { Evidence, Verdict, TaskContract } from '@bpc-oss/dsh-evidence';
import { EvidenceRef, GateSummary } from '@bpc-oss/dsh-verification';
import { ReactElement } from 'react';

/** 人话版证据（Bobby GUI `lib/evidence-format.ts` 移植）。 */
interface PlainEvidence {
    summary: string;
    ok: boolean;
    detail: string;
}
/** 完整证据 → 人话（Bobby 移植）。 */
declare function toPlainLanguage(ev: Evidence): PlainEvidence;
/** 投影中的证据 ref → 人话（UI 直接消费；ok 由类型/摘要推断展示）。 */
declare function summarizeEvidence(ref: EvidenceRef): PlainEvidence;
type VerdictLabel = 'pass' | 'fail' | 'need_human' | 'missing';
/** 裁决 → 状态标签（组件按 label 取 i18n）。 */
declare function verdictLabel(verdict: Verdict | undefined): VerdictLabel;

/**
 * 验证面板组件（纯 React，props 驱动，可单测）。
 * 数据来自 `verification` projection：契约卡片（含 frozen selector 展示）/ 逐 AC 裁决摘要 / 证据面板。
 */

type Translator = (key: string) => string;
/**
 * @deprecated 2026-08-17：对话输入坞的验证卡片已移除（client.tsx 不再注入 conversation.input.dock）。
 * 组件保留仅为 API 兼容与单测引用；如需恢复 dock，在 client.tsx 重新注入即可。
 */
declare function ContractCard({ contract, t }: {
    contract: TaskContract;
    t?: Translator;
}): ReactElement;
/**
 * @deprecated 2026-08-17：dock 卡片已移除，保留仅为 API 兼容（见 ContractCard 说明）。
 */
declare function VerdictSummary({ contract, verdicts, gateLog, t }: {
    contract: TaskContract;
    verdicts: Record<string, Verdict>;
    gateLog: GateSummary[];
    t?: Translator;
}): ReactElement;
/**
 * @deprecated 2026-08-17：dock 卡片已移除，保留仅为 API 兼容（见 ContractCard 说明）。
 */
declare function EvidencePanel({ evidence, t }: {
    evidence: EvidenceRef[];
    t?: Translator;
}): ReactElement;
/**
 * Dock 适配器：从会话投影系统读取 `verification` projection（标准 props 提供 `useProjection`）。
 * 无计划（null/undefined）时渲染空。
 * @deprecated 2026-08-17：client.tsx 不再注入 conversation.input.dock，本组件在生产路径为死代码；
 * 保留仅为 API 兼容与单测引用。如需恢复 dock，在 client.tsx 重新注入。
 */
declare function VerificationDock({ useProjection, t }: {
    useProjection?: (key: string) => unknown;
    t?: Translator;
}): ReactElement | null;

/** client 插件词典：en / zh（Bobby GUI 中英双语文案移植）。 */
declare const en: {
    'dock.title': string;
    'contract.goal': string;
    'contract.ac': string;
    'contract.constraints': string;
    'contract.outOfScope': string;
    'hint.test': string;
    'hint.run': string;
    'hint.file': string;
    'hint.schema': string;
    'hint.review': string;
    'hint.human': string;
    'verdict.pass': string;
    'verdict.fail': string;
    'verdict.need_human': string;
    'verdict.missing': string;
    'verdict.tier': string;
    'gate.done': string;
    'gate.failed': string;
    'gate.blocked': string;
    'evidence.title': string;
    'evidence.ok': string;
    'evidence.bad': string;
    'evidence.empty': string;
    'evidence.truncated': string;
    'settings.title': string;
    'settings.frozen': string;
    'settings.unfrozen': string;
    'settings.evidenceCount': string;
    'settings.failuresCount': string;
    'settings.epochs': string;
    'settings.noSessionNote': string;
};
declare const zh: {
    'dock.title': string;
    'contract.goal': string;
    'contract.ac': string;
    'contract.constraints': string;
    'contract.outOfScope': string;
    'hint.test': string;
    'hint.run': string;
    'hint.file': string;
    'hint.schema': string;
    'hint.review': string;
    'hint.human': string;
    'verdict.pass': string;
    'verdict.fail': string;
    'verdict.need_human': string;
    'verdict.missing': string;
    'verdict.tier': string;
    'gate.done': string;
    'gate.failed': string;
    'gate.blocked': string;
    'evidence.title': string;
    'evidence.ok': string;
    'evidence.bad': string;
    'evidence.empty': string;
    'evidence.truncated': string;
    'settings.title': string;
    'settings.frozen': string;
    'settings.unfrozen': string;
    'settings.evidenceCount': string;
    'settings.failuresCount': string;
    'settings.epochs': string;
    'settings.noSessionNote': string;
};

/**
 * Host loader entry for the browser implementation exported from `./client`.
 * Host plugin body — no host-side behavior for this package's domain; the
 * cordis entry must carry an `apply` so the Loader can mount it (mirroring
 * `@deepseek-ai/dsh-client-ui-settings`), while the browser half is served
 * by client-modules from the `dsh.client` declaration.
 */
declare function apply(): void;

export { ContractCard, EvidencePanel, type PlainEvidence, type Translator, type VerdictLabel, VerdictSummary, VerificationDock, apply, en, summarizeEvidence, toPlainLanguage, verdictLabel, zh };
