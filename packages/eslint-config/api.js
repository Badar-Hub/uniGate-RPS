import globals from 'globals';
import { base } from './base.js';

/**
 * apps/api — the module-boundary rules from architecture.md §2 and ADR-010, enforced by lint.
 *
 *  1. Cross-module reads go through the owning module's *service*, never its repository.
 *  2. Core modules never import a vertical module (passenger / goods); verticals never import
 *     each other.
 *  3. Core modules never branch on transport_type — that is what VerticalPlugin is for.
 *  4. Every exported repository function takes an ActorScope first (security.md §4).
 *  5. Mappers never spread an entity into a DTO (T-07).
 *  6. Controllers never import Prisma or the database client.
 */
const CORE_MODULES = [
  'iam',
  'profiles',
  'reference',
  'documents',
  'fleet',
  'demand',
  'bidding',
  'bookings',
  'trips',
  'tracking',
  'payments',
  'finance',
  'maintenance',
  'engagement',
  'notifications',
  'reporting',
  'admin',
  'platform',
];
const VERTICALS = ['passenger', 'goods'];

const CROSS_MODULE_REPOSITORY = {
  group: ['**/modules/*/*.repository', '**/modules/*/*.repository.js', '../*/**/*.repository*'],
  message: "Cross-module reads go through the owning module's service (architecture.md §2 rule 2).",
};

const PARSE_FLOAT = {
  selector: "CallExpression[callee.name='parseFloat']",
  message: 'parseFloat on money is a bug. Use Money from @unigate/types.',
};

const crossModuleRepositoryImport = {
  files: ['src/modules/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', { patterns: [CROSS_MODULE_REPOSITORY] }],
  },
};

const coreMayNotImportVerticals = {
  files: CORE_MODULES.map((m) => `src/modules/${m}/**/*.ts`),
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          ...VERTICALS.map((v) => ({
            group: [`**/modules/${v}/**`, `../${v}/**`, `../../modules/${v}/**`],
            message: `Core modules reach vertical behaviour only through VerticalPlugin (ADR-010). Do not import modules/${v} directly.`,
          })),
          CROSS_MODULE_REPOSITORY,
        ],
      },
    ],
    'no-restricted-syntax': [
      'error',
      // ADR-010 §7: a transport_type comparison inside a core module is a lint error.
      {
        selector:
          "BinaryExpression[operator=/^(===|!==|==|!=)$/] > MemberExpression[property.name=/^(transportType|transport_type)$/]",
        message:
          'Core modules never branch on transport_type. Resolve the VerticalPlugin and call it (ADR-010).',
      },
      {
        selector:
          "SwitchStatement > MemberExpression.discriminant[property.name=/^(transportType|transport_type)$/]",
        message:
          'Core modules never switch on transport_type. Resolve the VerticalPlugin and call it (ADR-010).',
      },
      PARSE_FLOAT,
    ],
  },
};

const verticalsMayNotImportEachOther = VERTICALS.map((v) => ({
  files: [`src/modules/${v}/**/*.ts`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: VERTICALS.filter((o) => o !== v).map((o) => ({
          group: [`**/modules/${o}/**`, `../${o}/**`],
          message: 'Vertical modules never import each other (ADR-010). Shared behaviour belongs in core.',
        })),
      },
    ],
  },
}));

const mappersNeverSpread = {
  files: ['src/modules/**/*.mapper.ts'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: 'ReturnStatement > ObjectExpression > SpreadElement',
        message:
          'Mappers allow-list fields explicitly; spreading an entity into a DTO is how PII leaks (security.md T-07).',
      },
      {
        selector: 'ArrowFunctionExpression > ObjectExpression > SpreadElement',
        message:
          'Mappers allow-list fields explicitly; spreading an entity into a DTO is how PII leaks (security.md T-07).',
      },
      PARSE_FLOAT,
    ],
  },
};

const controllersHaveNoPrisma = {
  files: ['src/modules/**/*.controller.ts', 'src/modules/**/*.routes.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '@prisma/client',
            message:
              'Controllers parse, delegate and map. Prisma belongs in repositories (architecture.md §4).',
          },
        ],
        patterns: [
          { group: ['**/database/**'], message: 'Controllers never touch the database client.' },
        ],
      },
    ],
  },
};

// `unigate/require-actor-scope` (security.md §4): every exported function in a repository must
// take an ActorScope as its first parameter. Implemented as a syntax selector on the first
// parameter's type annotation, so it needs no custom plugin. Genuinely unscoped access
// (seeds, system jobs) lives in `*.unscoped.repository.ts`, which this rule does not match.
const repositoriesTakeActorScope = {
  files: ['src/modules/**/*.repository.ts'],
  ignores: ['src/modules/**/*.unscoped.repository.ts'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector:
          "ExportNamedDeclaration > FunctionDeclaration:not([params.0.typeAnnotation.typeAnnotation.typeName.name=/^(ActorScope|AnyScope)$/])",
        message:
          'Every exported repository function takes an ActorScope as its first parameter (security.md §4). Genuinely unscoped access belongs in *.unscoped.repository.ts with a // @unscoped-repository-method: <justification> comment.',
      },
      PARSE_FLOAT,
    ],
  },
};

export default [
  ...base,
  { languageOptions: { globals: { ...globals.node } } },
  crossModuleRepositoryImport,
  coreMayNotImportVerticals,
  ...verticalsMayNotImportEachOther,
  mappersNeverSpread,
  controllersHaveNoPrisma,
  repositoriesTakeActorScope,
];
