import js from '@eslint/js'
import checkFile from 'eslint-plugin-check-file'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * The naming rules belong to the project. They are not default styles. See
 * AGENTS.md.
 *
 * The rules look at meaning, not at syntax. A `const` that holds a function is a
 * function, and uses camelCase. A `const` that holds data is a variable, and
 * uses snake_case. This needs type information. Thus the lint runs against the
 * projects.
 *
 * `function_formats` exists because the framework requires PascalCase for React
 * components, and a component is a const that holds a function.
 */
const namingRules = (function_formats) => [
  'error',
  { selector: 'typeLike', format: ['PascalCase'] },
  { selector: 'enumMember', format: ['UPPER_CASE'] },

  { selector: 'typeMethod', format: ['camelCase'] },
  { selector: 'objectLiteralMethod', format: ['camelCase'] },
  { selector: 'classMethod', format: ['camelCase'] },
  { selector: 'variable', types: ['function'], format: function_formats },
  // A parameter that holds a function is also a function. Examples are React event
  // props, and callback arguments such as `getDefaultMiddleware` of Redux Toolkit.
  { selector: 'parameter', types: ['function'], format: ['camelCase'] },

  // PascalCase is permitted here only for singletons. The linter cannot tell a
  // singleton from other objects. Thus the review must examine that part.
  { selector: 'variable', format: ['snake_case', 'UPPER_CASE', 'PascalCase'] },
  { selector: 'parameter', format: ['snake_case'], leadingUnderscore: 'allow' },

  { selector: 'typeProperty', format: ['snake_case'] },
  { selector: 'objectLiteralProperty', format: ['snake_case'] },
  { selector: 'classProperty', format: ['snake_case', 'UPPER_CASE'] },

  // Imports and third-party shapes keep the case of their source.
  { selector: 'import', format: null },
  // Keys that are not valid identifiers, such as a path alias, are not names.
  { selector: 'objectLiteralProperty', modifiers: ['requiresQuotes'], format: null },
]

/**
 * Callables are const arrows.
 *
 * `func-style` prohibits the declaration form. The selector prohibits the other
 * form that is not an arrow. Class methods and object methods do not change.
 * Hoisting is not a problem for method shorthand, and arrows would change
 * `this`.
 */
const ARROW_ONLY = {
  'func-style': ['error', 'expression'],
  'no-restricted-syntax': [
    'error',
    {
      selector: 'VariableDeclarator > FunctionExpression',
      message: 'Use an arrow function: const name = () => {}.',
    },
  ],
}

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.config.{js,mjs}'] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Build configs are outside the include path of the tsconfig of the app.
          allowDefaultProject: ['apps/web/vite.config.ts', 'apps/desktop/src/preload.cjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/naming-convention': namingRules(['camelCase']),
      ...ARROW_ONLY,
    },
  },
  {
    // Files and directories use kebab-case, also for React components. The
    // component in app.tsx still uses PascalCase. Only its file does not.
    files: ['**/*.{ts,tsx}'],
    plugins: { 'check-file': checkFile },
    rules: {
      'check-file/filename-naming-convention': [
        'error',
        { '**/*.{ts,tsx}': 'KEBAB_CASE' },
        // Lets line-map.test.ts and app.module.css keep their middle extension.
        { ignoreMiddleExtensions: true },
      ],
      'check-file/folder-naming-convention': [
        'error',
        { 'apps/**/src/**/': 'KEBAB_CASE', 'packages/**/src/**/': 'KEBAB_CASE' },
      ],
    },
  },
  {
    files: ['apps/desktop/src/preload.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    // A preload in a sandbox can load what it needs only with require().
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    rules: {
      '@typescript-eslint/naming-convention': namingRules(['camelCase', 'PascalCase']),
    },
  },
)
