// Flat config migrated from the old .eslintrc.js (tslint-to-eslint-config output).
// Preserves the original scope (src/**/*.ts only) and rule intent:
//  - @typescript-eslint parser, sourceType: module
//  - browser/es6/node globals
//  - member-delimiter-style + semi enforced, indent left to prettier
//  - eslint-config-prettier's rule-disabling applied last
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const prettierConfig = require('eslint-config-prettier');
const globals = require('globals');

module.exports = [
	{
		// eslint 9+/10 no longer reads .eslintignore; the old lint script only
		// ever targeted "src", so keep everything else out of scope here too.
		ignores: ['out/**', 'node_modules/**', '__tests__/**', 'test/**', '.vscode-test/**'],
	},
	{
		files: ['src/**/*.ts'],
		languageOptions: {
			parser: tsParser,
			sourceType: 'module',
			globals: {
				...globals.browser,
				...globals.es2015,
				...globals.node,
			},
		},
		plugins: {
			'@typescript-eslint': tsPlugin,
		},
		rules: {
			'@typescript-eslint/member-delimiter-style': [
				'error',
				{
					multiline: {
						delimiter: 'semi',
						requireLast: true,
					},
					singleline: {
						delimiter: 'semi',
						requireLast: false,
					},
				},
			],
			'@typescript-eslint/semi': ['error', 'always'],
			indent: 'off',
			semi: 'error',
		},
	},
	// Must come last: turns off any stylistic rules above that would conflict
	// with prettier formatting (mirrors the old "extends: ['prettier']").
	{
		files: ['src/**/*.ts'],
		rules: prettierConfig.rules,
	},
];
