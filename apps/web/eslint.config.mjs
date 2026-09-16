import next from '@unigate/eslint-config/next';
export default [
  ...next,
  { languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } } },
  {
    // next-intl 4.14 deprecates setRequestLocale / requestLocale in favour of Next 16 root params;
    // on Next 15 they remain the supported mechanism. Lift the allowance with the Next 16 upgrade.
    rules: {
      '@typescript-eslint/no-deprecated': [
        'error',
        { allow: [{ from: 'package', package: 'next-intl', name: 'setRequestLocale' }] },
      ],
    },
  },
  { ignores: ['next-env.d.ts', '.next/**', 'public/**'] },
];
