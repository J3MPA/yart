import js from '@eslint/js'
import checkFile from 'eslint-plugin-check-file'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * Naming rules are the project's, not stylistic defaults — see AGENTS.md.
 *
 * The distinction the rule set turns on is semantic rather than syntactic: a
 * `const` holding a function is a function and stays camelCase, while a `const`
 * holding data is a variable and becomes snake_case. That requires type
 * information, which is why linting runs against the projects.
 *
 * `function_formats` exists because React components are PascalCase by
 * framework requirement, and a component is just a const holding a function.
 */
const namingRules = (function_formats) => [
  'error',
  { selector: 'typeLike', format: ['PascalCase'] },
  { selector: 'enumMember', format: ['UPPER_CASE'] },

  { selector: 'typeMethod', format: ['camelCase'] },
  { selector: 'objectLiteralMethod', format: ['camelCase'] },
  { selector: 'classMethod', format: ['camelCase'] },
  { selector: 'variable', types: ['function'], format: function_formats },
  // A parameter holding a function is a function too — React event props and
  // callback arguments such as Redux Toolkit's `getDefaultMiddleware`.
  { selector: 'parameter', types: ['function'], format: ['camelCase'] },

  // PascalCase is permitted here only for singletons; the linter cannot tell a
  // singleton from any other object, so that part rests on review.
  { selector: 'variable', format: ['snake_case', 'UPPER_CASE', 'PascalCase'] },
  { selector: 'parameter', format: ['snake_case'], leadingUnderscore: 'allow' },

  { selector: 'typeProperty', format: ['snake_case'] },
  { selector: 'objectLiteralProperty', format: ['snake_case'] },
  { selector: 'classProperty', format: ['snake_case', 'UPPER_CASE'] },

  // Imports and third-party shapes keep their source's casing.
  { selector: 'import', format: null },
  // Keys that are not valid identifiers, such as a path alias, are not names.
  { selector: 'objectLiteralProperty', modifiers: ['requiresQuotes'], format: null },
]

/**
 * Callables are declared as const arrows.
 *
 * `func-style` bans the declaration form, and the selector bans the remaining
 * non-arrow expression form. Class and object methods are untouched: method
 * shorthand is not a hoisting question and arrows would change `this`.
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
          // Build configs live outside the app's tsconfig include path.
          allowDefaultProject: ['apps/web/vite.config.ts'],
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
    // Files and directories are kebab-case, including React components — the
    // component inside app.tsx is still PascalCase, only its file is not.
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
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    rules: {
      '@typescript-eslint/naming-convention': namingRules(['camelCase', 'PascalCase']),
    },
  },
)
