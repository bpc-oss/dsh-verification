/**
 * P0 #2 回归：设置页 section 的 SettingsPanel——无投影时必须渲染说明占位，绝不返回空白；
 * 有投影时渲染契约状态（不回归）。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SettingsPanel } from '../src/client';

describe('SettingsPanel (settings.section)', () => {
  it('renders an explanatory placeholder instead of nothing when no projection is available', () => {
    const html = renderToStaticMarkup(<SettingsPanel useProjection={() => null} t={(k) => k} />);
    expect(html).not.toBe('');
    expect(html).toContain('data-verification-settings');
    expect(html).toContain('verification-section-title');
    expect(html).toContain('settings.title');
    expect(html).toContain('settings.noSessionNote');
  });

  it('renders contract state when a projection exists', () => {
    const projection = {
      taskEpochs: [],
      plan: { contract: undefined, frozenAt: { callId: 'f', at: 1 } },
      evidenceRefs: [],
      captureFailures: [],
      challenges: {},
      completionPermits: [],
      verdicts: {},
      gateLog: [],
      updatedAt: 1
    };
    const html = renderToStaticMarkup(<SettingsPanel useProjection={() => projection} t={(k) => k} />);
    expect(html).toContain('data-verification-settings');
    expect(html).toContain('settings.evidenceCount');
  });
});
