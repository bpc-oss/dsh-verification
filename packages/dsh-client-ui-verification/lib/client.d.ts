import { Context } from '@deepseek-ai/cordis';
import { ReactElement } from 'react';

/**
 * Client 插件入口：验证状态仅保留在设置节（settings.section）。
 * 不再注入对话输入坞（conversation.input.dock）——用户反馈验证卡片在目标栏与输入框之间
 * 渲染大量文字（验收标准/验证/未裁决/证据），判定为干扰；引擎功能与设置页查看不受影响。
 * 数据经会话投影系统（useProjection('verification')）读取，无需额外 RPC。
 */

declare const name = "client-ui-verification";
declare const inject: string[];
declare function SettingsPanel({ useProjection, t }: {
    useProjection?: (key: string) => unknown;
    t?: (key: string) => string;
}): ReactElement;
declare function apply(ctx: Context): void;

export { SettingsPanel, apply, inject, name };
