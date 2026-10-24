import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/', 'web/dist/', 'coverage/'] },
  tseslint.configs.recommended,
  {
    rules: {
      // Allow intentionally unused parameters when prefixed with "_" (e.g. `_request`).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
