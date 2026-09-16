import expoCore from 'eslint-config-expo/flat/utils/core.js';
import expoReact from 'eslint-config-expo/flat/utils/react.js';
import expoRules from 'eslint-config-expo/flat/utils/expo.js';
import globals from 'globals';
import { base, noPrismaOutsideApi } from '@unigate/eslint-config/base';

/**
 * Expo's flat config pieces (core import rules, React / React Native, the `expo/*` rules and the
 * RN globals) composed with the monorepo baseline (typescript-eslint strict + type-checked,
 * Prisma ban, money rules). Expo's own TypeScript slice is deliberately left out: it registers
 * a second copy of `@typescript-eslint` (pnpm isolates one per TypeScript major) and ESLint
 * refuses to redefine a plugin — the baseline already provides the parser and plugin.
 * Config files (*.config.*, babel/metro/tailwind) are ignored by the baseline; the JS token
 * file is plain CommonJS read by Tailwind and is excluded from type-aware linting.
 */
export default [
  ...expoCore,
  ...expoReact,
  ...expoRules,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        __DEV__: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
      },
    },
  },
  ...base,
  noPrismaOutsideApi,
  {
    ignores: [
      '.expo/**',
      'dist/**',
      'android/**',
      'ios/**',
      'expo-env.d.ts',
      'src/theme/tokens.js',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // TypeScript resolves modules (bundler resolution + the `@/` alias); eslint-plugin-import's node resolver cannot.
      'import/no-unresolved': 'off',
      'import/namespace': 'off',
      'import/default': 'off',
      'import/no-named-as-default-member': 'off',
      // Expo Router screens are default exports by convention.
      'import/no-default-export': 'off',
      // RN components take `style` objects; the strict boolean rules fight `?.` on optional DTO fields.
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
];
