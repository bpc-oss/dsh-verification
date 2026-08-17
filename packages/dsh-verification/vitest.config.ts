import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@bpc-oss/dsh-evidence': fileURLToPath(new URL('../dsh-evidence/src/index.ts', import.meta.url))
    }
  },
  test: {
    pool: 'forks'
  }
});
