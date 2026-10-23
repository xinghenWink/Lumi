import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import ts from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default ts.config(
  { ignores: ['src/api/schema.d.ts', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...ts.configs.strict,
  ...vue.configs['flat/recommended'],
  {
    files: ['src/react/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: ts.parser } },
  },
  {
    languageOptions: {
      globals: {
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        DOMException: 'readonly',
        Headers: 'readonly',
        FormData: 'readonly',
        File: 'readonly',
        HTMLTextAreaElement: 'readonly',
        ClipboardEvent: 'readonly',
        DragEvent: 'readonly',
        Event: 'readonly',
        MediaQueryListEvent: 'readonly',
        HTMLSelectElement: 'readonly',
        URLSearchParams: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        window: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        Response: 'readonly',
        crypto: 'readonly',
        KeyboardEvent: 'readonly',
        MouseEvent: 'readonly',
        Element: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLElement: 'readonly',
        HTMLScriptElement: 'readonly',
        HTMLLinkElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLInputElement: 'readonly',
        IntersectionObserver: 'readonly',
        ResizeObserver: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      'vue/multiline-html-element-content-newline': 'off',
      'vue/multi-word-component-names': 'error',
      'vue/html-self-closing': ['error', { html: { void: 'always' } }],
      'vue/max-attributes-per-line': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-indent': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
)
