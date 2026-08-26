/**
 * readonly-guard — Autoprompt Reviewer read-only enforcement (plan v8 §3.3/D8).
 * Two mechanisms in one plugin (mounted ONLY by autoprompt-reviewer, row placed
 * BEFORE any cordis:group because loader skips rows after a group):
 *
 *   Layer ② assembly allowlist — model-visible catalog collapses to config.allow.
 *   Layer ③ execution default-deny guard (THE authoritative boundary).
 *
 * Fail-closed on purpose: internal errors yield an empty catalog/rethrow,
 * never full catalog exposure.
 * Zero bare imports on purpose (preset-relative module cache friendly).
 */

export const name = 'readonly-guard'

export const inject = ['tools', 'systemPrompt']

const ALLOWED_KEYS = new Set(['allow'])

function stringList(value, field) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`${name}: ${field} must be a non-empty array of non-empty strings`)
  }
  return [...new Set(value)]
}

export function apply(ctx, config) {
  const source = config === undefined ? {} : config
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    throw new TypeError(`${name}: config must be an object`)
  }
  const unknownKeys = Object.keys(source).filter((key) => !ALLOWED_KEYS.has(key))
  if (unknownKeys.length > 0) {
    throw new TypeError(`${name}: unknown config key(s) ${unknownKeys.join(', ')} — allowed keys: allow`)
  }
  const allow = new Set(stringList(source.allow, 'allow'))

  ctx.tools.guard((exec) =>
    allow.has(exec.name)
      ? undefined
      : `readonly-guard: tool "${exec.name}" is outside the reviewer read-only surface (allowed: ${[...allow].sort().join(', ')})`,
  )

  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembled = await next()
    try {
      if (!assembled || !Array.isArray(assembled.tools)) return assembled
      return { ...assembled, tools: assembled.tools.filter((tool) => tool && allow.has(tool.name)) }
    } catch (error) {
      return { ...assembled, tools: [] }
    }
  })
}