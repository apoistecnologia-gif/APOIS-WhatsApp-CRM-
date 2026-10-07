import globals from 'globals';
export default [
  {ignores: ['vendor/**', '**/node_modules/**']},
  {files: ['src/*.js'], languageOptions: {ecmaVersion: 'latest', sourceType: 'script', globals: {...globals.browser, ...globals.webextensions, ...globals.worker, module: 'readonly'}}, rules: {'no-undef': 'error'}},
  {files: ['scripts/*.cjs', 'tests/*.cjs', 'apois-multiconta-bridge/*.mjs'], languageOptions: {ecmaVersion: 'latest', globals: globals.node}, rules: {'no-undef': 'error'}},
  {files: ['tests/browser.cjs'], languageOptions: {globals: {...globals.node, ...globals.browser, ...globals.webextensions}}, rules: {'no-undef': 'error'}},
  {files: ['tests/fixture-worker.js'], languageOptions: {globals: {...globals.worker, ...globals.webextensions}}, rules: {'no-undef': 'error'}}
];
