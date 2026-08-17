/**
 * 验证面板组件（纯 React，props 驱动，可单测）。
 * 数据来自 `verification` projection：契约卡片（含 frozen selector 展示）/ 逐 AC 裁决摘要 / 证据面板。
 */
import type { ReactElement } from 'react';
import type { TaskContract, Verdict } from '@bpc-oss/dsh-evidence';
import type { EvidenceRef, GateSummary, VerificationProjection } from '@bpc-oss/dsh-verification';

import { summarizeEvidence, verdictLabel } from './evidence-format';

export type Translator = (key: string) => string;

const fallbackT: Translator = (key) => key;

function shortHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash;
}

export function ContractCard({ contract, t = fallbackT }: { contract: TaskContract; t?: Translator }): ReactElement {
  return (
    <div data-verification-contract>
      <div className="verification-section-title">{t('contract.goal')}</div>
      <div className="verification-goal">{contract.goal}</div>
      <div className="verification-section-title">{t('contract.ac')}</div>
      <ul className="verification-ac-list">
        {contract.acceptanceCriteria.map((ac) => (
          <li
            key={ac.id}
            data-ac={ac.id}
            title={ac.selector ? `${t(`hint.${ac.oracleHint}`)} · ${ac.selector.toolIdentity} · ${shortHash(ac.selector.normalizedArgsHash)} · ${ac.selector.evidenceType}` : t(`hint.${ac.oracleHint}`)}
          >
            <span className="verification-ac-id">{ac.id}</span>
            <span className="verification-ac-desc">{ac.desc}</span>
          </li>
        ))}
      </ul>
      {contract.constraints.length > 0 && (
        <>
          <div className="verification-section-title">{t('contract.constraints')}</div>
          <ul className="verification-constraint-list">
            {contract.constraints.map((c) => (
              <li key={c.id} data-constraint={c.id}>
                <span className="verification-constraint-id">{c.id}</span>
                <span className="verification-constraint-desc">{c.desc}</span>
                <code className="verification-constraint-check">{c.check}</code>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function VerdictSummary({
  contract,
  verdicts,
  gateLog,
  t = fallbackT
}: {
  contract: TaskContract;
  verdicts: Record<string, Verdict>;
  gateLog: GateSummary[];
  t?: Translator;
}): ReactElement {
  const latestGate = gateLog[gateLog.length - 1];
  return (
    <div data-verification-verdicts>
      <div className="verification-section-title">{t('dock.title')}</div>
      <ul className="verification-verdict-list">
        {contract.acceptanceCriteria.map((ac) => {
          const verdict = verdicts[ac.id];
          const label = verdictLabel(verdict);
          return (
            <li key={ac.id} data-ac={ac.id} data-verdict={label} className={`verification-verdict-${label}`}>
              <span className="verification-verdict-label">{t(`verdict.${label}`)}</span>
              <span className="verification-verdict-ac">{ac.id}</span>
              {verdict && (
                <span className="verification-verdict-tier">
                  {t('verdict.tier')} {verdict.oracleTier}
                </span>
              )}
              {verdict?.detail && <div className="verification-verdict-detail">{verdict.detail}</div>}
            </li>
          );
        })}
      </ul>
      {latestGate && <div className={`verification-gate verification-gate-${latestGate.status}`}>{t(`gate.${latestGate.status}`)}</div>}
    </div>
  );
}

export function EvidencePanel({ evidence, t = fallbackT }: { evidence: EvidenceRef[]; t?: Translator }): ReactElement {
  if (evidence.length === 0) {
    return (
      <div data-verification-evidence className="verification-evidence-empty">
        {t('evidence.empty')}
      </div>
    );
  }
  return (
    <details data-verification-evidence className="verification-evidence-panel">
      <summary>
        {t('evidence.title')} ({evidence.length})
      </summary>
      <ul className="verification-evidence-list">
        {evidence.slice(-20).map((entry) => {
          const plain = summarizeEvidence(entry);
          return (
            <li key={entry.callId} data-evidence-type={entry.evidenceType} className={plain.ok ? 'verification-evidence-ok' : 'verification-evidence-bad'}>
              <span className="verification-evidence-state">{plain.ok ? t('evidence.ok') : t('evidence.bad')}</span>
              <span className="verification-evidence-type">{entry.evidenceType}</span>
              <span className="verification-evidence-summary">{plain.summary}</span>
              {entry.truncated && <span className="verification-evidence-truncated">{t('evidence.truncated')}</span>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/**
 * Dock 适配器：从会话投影系统读取 `verification` projection（标准 props 提供 `useProjection`）。
 * 无计划（null/undefined）时渲染空。
 */
export function VerificationDock({
  useProjection,
  t = fallbackT
}: {
  useProjection?: (key: string) => unknown;
  t?: Translator;
}): ReactElement | null {
  const projection = useProjection ? (useProjection('verification') as VerificationProjection | null | undefined) : undefined;
  if (projection == null || projection.plan == null) {
    return null;
  }
  const contract = projection.plan.contract;
  return (
    <div data-verification-dock>
      <ContractCard contract={contract} t={t} />
      <VerdictSummary contract={contract} verdicts={projection.verdicts} gateLog={projection.gateLog} t={t} />
      <EvidencePanel evidence={projection.evidenceRefs} t={t} />
    </div>
  );
}
