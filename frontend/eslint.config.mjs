import js from '@eslint/js'
import ts from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default ts.config(
  { ignores: ['src/api/schema.d.ts', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...ts.configs.strict,
  {
    files: ['src/react/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
    },
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
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
)
