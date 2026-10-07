import js from '@eslint/js';
import globals from 'globals';
export default [js.configs.recommended,{files:['src/**/*.js','scripts/**/*.mjs','tests/**/*.mjs','bridge/**/*.mjs'],languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:{...globals.browser,...globals.node,chrome:'readonly'}},rules:{'no-unused-vars':['error',{argsIgnorePattern:'^_',caughtErrors:'none',varsIgnorePattern:'^_'}],'no-empty':['error',{allowEmptyCatch:true}]}},{ignores:['vendor/**','node_modules/**','bridge/node_modules/**','dist/**']}];
