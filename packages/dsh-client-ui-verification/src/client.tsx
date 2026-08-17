/**
 * Client 插件入口：验证状态仅保留在设置节（settings.section）。
 * 不再注入对话输入坞（conversation.input.dock）——用户反馈验证卡片在目标栏与输入框之间
 * 渲染大量文字（验收标准/验证/未裁决/证据），判定为干扰；引擎功能与设置页查看不受影响。
 * 数据经会话投影系统（useProjection('verification')）读取，无需额外 RPC。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ReactElement } from 'react';
import type { VerificationProjection } from '@bpc-oss/dsh-verification';

import { en, zh } from './locales';

export const name = 'client-ui-verification';

export const inject = ['slots', 'sessions', 'locale'];

export function SettingsPanel({ useProjection, t }: { useProjection?: (key: string) => unknown; t?: (key: string) => string }): ReactElement {
  const projection = useProjection ? (useProjection('verification') as VerificationProjection | null | undefined) : undefined;
  const t_ = t ?? ((key: string) => key);
  // P0 修复 #2：设置面板无会话上下文（投影为 null）时渲染说明占位，绝不返回空白
  if (projection == null) {
    return (
      <div data-verification-settings>
        <div className="verification-section-title">{t_('settings.title')}</div>
        <div className="verification-settings-note">{t_('settings.noSessionNote')}</div>
      </div>
    );
  }
  return (
    <div data-verification-settings>
      <div>{t_('settings.title')}</div>
      <div>
        {projection.plan ? (projection.plan.frozenAt ? t_('settings.frozen') : t_('settings.unfrozen')) : '—'}
      </div>
      <div>
        {t_('settings.evidenceCount')}: {projection.evidenceRefs.length} · {t_('settings.failuresCount')}: {projection.captureFailures.length} ·{' '}
        {t_('settings.epochs')}: {projection.taskEpochs.length}
      </div>
    </div>
  );
}

export function apply(ctx: Context): void {
  const slots = ctx.get('slots');
  if (!slots) {
    return;
  }

  const localeAny = ctx.get('locale') as
    | { bind?: (ns: string) => (key: string) => string; register?: (ns: string, dict: unknown) => unknown }
    | undefined;
  // P0 修复 #2：label 与内容区共用绑定翻译；无 locale 通道时退化为 key 直返
  const t: (key: string) => string = typeof localeAny?.bind === 'function' ? localeAny.bind('verification') : (key: string) => key;

  ctx.effect(() => {
    // register 返回的可解绑值交由 effect 生命周期（cordis SyncEffect 类型兼容用 any 桥接）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return localeAny?.register?.('verification', { en, zh }) as any;
  });

  // 设置节（P0 修复 #2：补齐 order/label/inject，导航项不再空白）
  slots.inject('settings.section', () =>
    slots.register(
      {
        name: 'settings.section',
        id: 'verification',
        order: 25,
        locale: 'verification',
        label: () => t('settings.title'),
        inject: () => ({ t })
      },
      SettingsPanel
    )
  );
}
