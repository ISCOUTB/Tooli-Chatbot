// ESLint 9 flat config. El backend TypeScript se verifica con `tsc --noEmit`;
// este lint cubre los módulos JavaScript que se sirven directamente al panel.
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    files: ['src/public/app/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, Chart: 'readonly' },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': 'off',
    },
  },
];
