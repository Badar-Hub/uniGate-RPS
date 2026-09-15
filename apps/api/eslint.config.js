import api from '@unigate/eslint-config/api';
export default [
  ...api,
  { languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } } },
  { files: ['prisma/seed/**/*.ts', 'test/**/*.ts', 'src/cli/**/*.ts'], rules: { 'no-console': 'off' } },
  // supertest exposes response bodies as `any`; HTTP-level tests assert on them by design.
  {
    files: ['test/db/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
    },
  },
];
