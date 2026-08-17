export * from './evidence-format';
export * from './components';
export * from './locales';

/**
 * Host loader entry for the browser implementation exported from `./client`.
 * Host plugin body — no host-side behavior for this package's domain; the
 * cordis entry must carry an `apply` so the Loader can mount it (mirroring
 * `@deepseek-ai/dsh-client-ui-settings`), while the browser half is served
 * by client-modules from the `dsh.client` declaration.
 */
export function apply(): void {
  // no host-side behavior
}
