import { defineConfig } from 'vitest/config';
import fs from 'node:fs';
import path from 'node:path';

// Load root .env into process.env so live provider contract tests execute when keys are available
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim();
      if (k && process.env[k] === undefined) {
        process.env[k] = v;
      }
    }
  }
}

/** Monorepo-wide Vitest configuration with workspace path resolution. */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 30000,
    include: [
      'packages/**/test/**/*.test.ts',
      'tests/api/**/*.test.ts',
      'apps/web/test/**/*.{test.ts,test.tsx}',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'packages/rules/src/**/*.ts',
        'packages/carbon/src/**/*.ts',
        'api/**/*.ts',
        'apps/web/src/**/*.ts',
        'apps/web/src/**/*.tsx',
      ],
      exclude: [
        '**/*.d.ts',
        '**/node_modules/**',
        '**/test/**',
        'apps/web/vite.dev-api.ts',
        'apps/web/src/vite-env.d.ts',
        'tests/api/**',
      ],
      thresholds: {
        'packages/rules/src/**': {
          lines: 95,
          statements: 95,
        },
        'api/**': {
          lines: 85,
          statements: 85,
        },
        'packages/carbon/src/**': {
          lines: 95,
          statements: 95,
        },
        'apps/web/src/**': {
          lines: 70,
          statements: 70,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@zerowastein/contract': path.resolve(__dirname, 'packages/contract/src/index.ts'),
      '@zerowastein/rules': path.resolve(__dirname, 'packages/rules/src/index.ts'),
      '@zerowastein/carbon': path.resolve(__dirname, 'packages/carbon/src/index.ts'),
    },
  },
});
