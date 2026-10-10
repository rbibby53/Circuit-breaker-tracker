import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/data/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['apps/server/**/*.{ts,mjs}', '*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // Tests poke at JSON responses; typing every one adds noise without catching bugs.
    files: ['**/*.test.ts', 'apps/server/test/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
