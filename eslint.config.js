import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['artifacts/**', 'coverage/**', 'node_modules/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
);
