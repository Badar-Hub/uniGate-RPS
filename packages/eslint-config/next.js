import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';
import { base, noPrismaOutsideApi } from './base.js';

/**
 * apps/web. Two rules are security/i18n controls, not style:
 *  - react/no-danger is an error (security.md T-37).
 *  - Physical Tailwind direction utilities (ml-, pl-, left-, text-left …) are banned so RTL
 *    cannot silently break; use logical equivalents (ms-, ps-, start-, text-start).
 */
const PHYSICAL_DIRECTION =
  '/\\b(?:-?[mp][lr]-|-?(?:left|right)-|text-(?:left|right)\\b|rounded-(?:l|r|tl|tr|bl|br)-|border-[lr]-|scroll-[mp][lr]-|float-(?:left|right)\\b)/';

export default [
  ...base,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { react, 'react-hooks': reactHooks, '@next/next': nextPlugin },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      'react/no-danger': 'error',
      'react/prop-types': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: `JSXAttribute[name.name='className'] > Literal[value=${PHYSICAL_DIRECTION}]`,
          message:
            'Physical direction utility. Use the logical equivalent (ms-/me-/ps-/pe-/start-/end-/text-start/text-end) so RTL works (architecture.md §11).',
        },
        {
          selector: `JSXAttribute[name.name='className'] TemplateElement[value.raw=${PHYSICAL_DIRECTION}]`,
          message:
            'Physical direction utility. Use the logical equivalent so RTL works (architecture.md §11).',
        },
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message:
            'parseFloat on money is a bug. Money is a string on the wire; format with Intl.NumberFormat.',
        },
      ],
    },
  },
  noPrismaOutsideApi,
];
