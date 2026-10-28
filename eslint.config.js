import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Monorepo ESLint flat configuration for TypeScript and JavaScript files. */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['**/dist/**', '**/build/**', '**/node_modules/**', '**/.vercel/**'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
  // Relax strict typing rules in test, eval, and e2e files
  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      'eval/**/*.ts',
      'e2e/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  }
);
