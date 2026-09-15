import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import prettier from 'eslint-config-prettier';

/**
 * Baseline for every TypeScript package in the monorepo.
 *
 * Two rules here are architectural, not stylistic (architecture.md §3):
 *  - `@prisma/client` may only be imported inside apps/api. packages/types is hand-written
 *    and must never derive from the database schema (T-07 in security.md).
 *  - `$queryRawUnsafe` / `$executeRawUnsafe` are banned outright, everywhere (T-38).
 */
export const base = tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.config.*',
      '**/prisma/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    plugins: { 'import-x': importX },
    languageOptions: {
      parserOptions: { projectService: true },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-extraneous-class': 'off',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'no-param-reassign': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/first': 'error',
      // T-38 — unsafe raw SQL has no exemption path.
      'no-restricted-properties': [
        'error',
        {
          property: '$queryRawUnsafe',
          message:
            'Banned (security.md T-38). Use tagged-template $queryRaw inside a *.repository.ts with a // @raw-sql-reviewed annotation.',
        },
        {
          property: '$executeRawUnsafe',
          message:
            'Banned (security.md T-38). Use tagged-template $executeRaw inside a *.repository.ts with a // @raw-sql-reviewed annotation.',
        },
      ],
      // Never trust floating point for money (database.md D2).
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: 'parseFloat on money is a bug. Use Money from @unigate/types.',
        },
      ],
    },
  },
  prettier,
);

/**
 * Applied to every package that is NOT apps/api: Prisma types must not leak
 * into shared DTOs or the web app.
 */
export const noPrismaOutsideApi = {
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '@prisma/client',
            message:
              'Prisma is confined to apps/api. DTOs in @unigate/types are hand-written (architecture.md §3).',
          },
          { name: '.prisma/client', message: 'Prisma is confined to apps/api.' },
        ],
      },
    ],
  },
};

export default base;
