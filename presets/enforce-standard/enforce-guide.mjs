/**
 * enforce-guide — DISABLED injection (stability fallback).
 *
 * The pre-step injection previously corrupted the session projection (session.list
 * 500: Cannot read properties of undefined (reading 'kind')). Until the injection
 * message structure is validated against the pre-step waterfall contract, this
 * plugin registers nothing and injects nothing. The workflow guidance is instead
 * carried by the adapter steer text.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'enforce-guide'

/** Register a no-op. */
export function apply(ctx, config) {
  // Intentionally empty: injection disabled for stability.
  void ctx
  void config
}