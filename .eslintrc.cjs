const vitestFiles = ['app/**/__tests__/**/*', 'app/**/*.{spec,test}.*']
const testFiles = ['**/tests/**', ...vitestFiles]
const appFiles = ['app/**']

/**
 * This configuration follows the streamlined ESLint structure used by the
 * official React Router templates. Project-specific rules are kept here so the
 * migration does not discard Veud's existing lint policy.
 *
 * @type {import('@types/eslint').Linter.Config}
 */
module.exports = {
	root: true,
	parserOptions: {
		ecmaVersion: 'latest',
		sourceType: 'module',
		ecmaFeatures: { jsx: true },
	},
	env: {
		browser: true,
		commonjs: true,
		es6: true,
		node: true,
	},
	ignorePatterns: ['!**/.server', '!**/.client'],
	extends: ['eslint:recommended', 'prettier'],
	plugins: ['import'],
	rules: {
		// Playwright requires destructuring in fixtures even if nothing is used.
		'no-empty-pattern': 'off',
		'no-async-promise-executor': 'off',
		'no-empty': ['warn', { allowEmptyCatch: true }],
		'no-useless-concat': 'warn',
		'@typescript-eslint/consistent-type-imports': [
			'warn',
			{
				prefer: 'type-imports',
				disallowTypeAnnotations: true,
				fixStyle: 'inline-type-imports',
			},
		],
		'import/no-duplicates': ['warn', { 'prefer-inline': true }],
		'import/consistent-type-specifier-style': ['warn', 'prefer-inline'],
		'import/order': [
			'warn',
			{
				alphabetize: { order: 'asc', caseInsensitive: true },
				groups: [
					'builtin',
					'external',
					'internal',
					'parent',
					'sibling',
					'index',
				],
			},
		],
	},
	overrides: [
		{
			files: ['**/*.{js,jsx,ts,tsx}'],
			plugins: ['react', 'react-hooks', 'jsx-a11y'],
			extends: [
				'plugin:react/recommended',
				'plugin:react/jsx-runtime',
				'plugin:react-hooks/recommended',
				'plugin:jsx-a11y/recommended',
				'prettier',
			],
			settings: {
				react: {
					version: 'detect',
					formComponents: ['Form'],
					linkComponents: [
						{ name: 'Link', linkAttribute: 'to' },
						{ name: 'NavLink', linkAttribute: 'to' },
					],
				},
			},
			rules: {
				'jsx-a11y/alt-text': 'warn',
				'jsx-a11y/click-events-have-key-events': 'off',
				'jsx-a11y/no-autofocus': 'off',
				'jsx-a11y/no-static-element-interactions': 'off',
				'react/jsx-key': 'warn',
				'react/no-unescaped-entities': 'off',
			},
		},
		{
			files: ['**/*.{ts,tsx}'],
			parser: '@typescript-eslint/parser',
			plugins: ['@typescript-eslint', 'import'],
			extends: [
				'plugin:@typescript-eslint/recommended',
				'plugin:import/recommended',
				'plugin:import/typescript',
				'prettier',
			],
			settings: {
				'import/ignore': ['node_modules', '\\.(css|md|svg|json)$'],
				'import/parsers': {
					'@typescript-eslint/parser': ['.ts', '.tsx', '.d.ts'],
				},
				'import/resolver': {
					node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] },
					typescript: { alwaysTryTypes: true },
				},
			},
			rules: {
				'@typescript-eslint/ban-ts-comment': 'off',
				'@typescript-eslint/ban-types': 'off',
				'@typescript-eslint/no-empty-function': 'off',
				'@typescript-eslint/no-empty-interface': 'off',
				'@typescript-eslint/no-explicit-any': 'off',
				'@typescript-eslint/no-inferrable-types': 'off',
				'@typescript-eslint/no-namespace': 'off',
				'@typescript-eslint/no-non-null-assertion': 'off',
				'@typescript-eslint/no-var-requires': 'off',
				'@typescript-eslint/no-use-before-define': [
					'error',
					{
						functions: false,
						classes: false,
						variables: false,
						typedefs: false,
					},
				],
				'@typescript-eslint/no-unused-expressions': [
					'error',
					{
						allowShortCircuit: true,
						allowTernary: true,
						allowTaggedTemplates: true,
					},
				],
				'@typescript-eslint/no-unused-vars': [
					'error',
					{ args: 'none', ignoreRestSiblings: true },
				],
				'@typescript-eslint/consistent-type-assertions': 'warn',
				'no-dupe-class-members': 'off',
				'no-undef': 'off',
				'no-use-before-define': 'off',
				'no-unused-vars': 'off',
				'no-var': 'off',
				'prefer-const': 'off',
				'prefer-rest-params': 'off',
			},
		},
		{
			files: appFiles,
			excludedFiles: testFiles,
			rules: {
				'no-restricted-imports': [
					'error',
					{
						patterns: [
							{
								group: testFiles,
								message: 'Do not import test files in app files',
							},
						],
					},
				],
			},
		},
		{
			files: vitestFiles,
			plugins: ['jest', 'jest-dom', 'testing-library'],
			extends: [
				'plugin:jest/recommended',
				'plugin:jest-dom/recommended',
				'plugin:testing-library/react',
				'prettier',
			],
			rules: {
				'testing-library/no-await-sync-events': 'off',
				'testing-library/no-container': 'off',
				'testing-library/no-node-access': 'off',
				'jest-dom/prefer-in-document': 'off',
			},
			settings: {
				jest: { version: 28 },
			},
		},
	],
}
