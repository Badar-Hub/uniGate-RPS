import node from '@unigate/eslint-config/node';
export default [
  ...node,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
];
