/**
 * 工具定义自编译（避免对 @deepseek-ai/dsh-tools 的运行时依赖）。
 * DSH 插件 loader/profile 场景下，profile 内安装 dsh-tools 副本会导致运行时符号分裂
 * （tools 注册表与 agent-loop 使用不同 TOOL_RUNTIME_SCHEDULER 实例，工具调度即崩）。
 * 因此本插件只依赖 @deepseek-ai/cordis + @deepseek-ai/schemastery（经真机验证安全），
 * 在这里把 ParameterPropertySpec 映射编译成 vLLM/OpenAI 接受的 JSON Schema（根为 object）。
 */

export interface CompiledToolParameters {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  /** 允许记入附加 JSON Schema 键；同时使本类型可赋值给 dsh-llm 的 Record<string,unknown> 工序字段。 */
  [key: string]: unknown;
}

type Spec = Record<string, unknown>;

function compileNode(spec: unknown): Record<string, unknown> {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return {};
  }
  const record = spec as Spec;
  const type = record.type;
  const { required: _r, ...schema } = { ...record } as Spec;
  if (type === 'object') {
    const out: Record<string, unknown> = { ...schema, type: 'object' };
    if (record.properties && typeof record.properties === 'object') {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(record.properties as Spec)) {
        const node = (value as Spec) ?? {};
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
    if (out.additionalProperties === undefined) {
      out.additionalProperties = true;
    }
    return out;
  }
  if (type === 'array') {
    const out: Record<string, unknown> = { ...schema, type: 'array' };
    if (record.items !== undefined) {
      out.items = compileNode(record.items);
    }
    return out;
  }
  if (typeof type === 'string') {
    return { ...schema, type };
  }
  return { ...schema };
}

/** 把参数 spec（属性映射）编译成 JSON Schema（根 object）。 */
export function compileParameterJsonSchema(spec: Spec): CompiledToolParameters {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, value] of Object.entries(spec)) {
    const node = (value as Spec) ?? {};
    properties[key] = compileNode(node);
    if (node.required === true) {
      required.push(key);
    }
  }
  const out: CompiledToolParameters = { type: 'object', properties };
  if (required.length > 0) {
    out.required = required;
  }
  return out;
}

/** 本地工具错误（message 透出；code 供诊断）。 */
export class VerificationToolError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'VerificationToolError';
    this.code = code;
  }
}
