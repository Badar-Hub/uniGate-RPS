import next from '@unigate/eslint-config/next';
export default [
  ...next,
  { languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } } },
  { ignores: ['next-env.d.ts', '.next/**'] },
];
