module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module'
    },
    plugins: [
        '@typescript-eslint'
    ],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended'
    ],
    rules: {
        '@typescript-eslint/naming-convention': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
        '@typescript-eslint/semi': 'warn',
        'curly': 'off',
        'eqeqeq': 'warn',
        'no-throw-literal': 'warn',
        'no-case-declarations': 'off',
        'prefer-const': 'error',
        'semi': 'off'
    },
    ignorePatterns: [
        'out',
        'dist',
        '**/*.d.ts'
    ]
};
