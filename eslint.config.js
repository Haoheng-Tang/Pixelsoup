import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const NODE_BUILTINS = ['node:*', 'fs', 'fs/*', 'path', 'os', 'child_process', 'crypto', 'url'];

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  // src/core: pure document/pixel logic. No DOM, React, Node, Electron, or UI imports.
  {
    files: ['src/core/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-*', 'react/*', 'electron', ...NODE_BUILTINS],
              message: 'src/core must stay free of React, Node and Electron.',
            },
            {
              group: ['**/ui/**', '../ui'],
              message: 'src/core must not depend on UI code.',
            },
          ],
        },
      ],
    },
  },
  // Browser code: browser globals, React hooks rules, and never Node/Electron.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/core/**'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['electron', ...NODE_BUILTINS],
              message: 'Pixelsoup is a pure web app: src/ must not import Node or Electron APIs.',
            },
          ],
        },
      ],
    },
  },
  // Node-side code: build and tool configs.
  {
    files: ['*.config.ts'],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
