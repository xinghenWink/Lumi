import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig(({ mode }) => {
  const candidate = mode === 'react'
  return {
    plugins: [
      candidate ? react() : vue(),
      tailwindcss(),
      ...(candidate
        ? [
            {
              name: 'lumi-react-candidate',
              transformIndexHtml: {
                order: 'pre' as const,
                handler: (html: string) => html.replace('/src/main.ts', '/src/react/main.tsx'),
              },
              generateBundle(
                _options: unknown,
                bundle: Record<string, { type: string; modules?: Record<string, unknown> }>,
              ) {
                const legacy =
                  /[/\\]node_modules[/\\](?:@vue[/\\]|vue[/\\]|pinia[/\\]|vue-i18n[/\\]|reka-ui[/\\]|lucide-vue-next[/\\])/
                for (const chunk of Object.values(bundle)) {
                  if (
                    chunk.type === 'chunk' &&
                    Object.keys(chunk.modules ?? {}).some((id) => legacy.test(id))
                  )
                    throw new Error('React candidate includes a legacy Vue dependency')
                }
              },
            },
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@lumi/session': fileURLToPath(
          new URL(
            candidate
              ? './src/react/features/auth/session-adapter.ts'
              : './src/api/session.legacy.ts',
            import.meta.url,
          ),
        ),
        '@': fileURLToPath(new URL('./src/react', import.meta.url)),
      },
    },
    build: {
      outDir: '../backend/web/dist',
      emptyOutDir: true,
      // Keep small KaTeX fonts on the same origin instead of data URLs blocked by CSP.
      assetsInlineLimit: 0,
      // Keep the entry budget comfortably below the 250 KB gzip requirement.
      chunkSizeWarningLimit: 250,
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': 'http://127.0.0.1:8080',
        '/healthz': 'http://127.0.0.1:8080',
        '/readyz': 'http://127.0.0.1:8080',
      },
    },
    test: {
      environment: 'jsdom',
      include: candidate
        ? ['src/react/**/*.test.{ts,tsx}', 'src/api/session.test.ts']
        : ['src/**/*.test.ts'],
      exclude: candidate ? ['node_modules/**'] : ['node_modules/**', 'src/react/**'],
      restoreMocks: true,
      unstubGlobals: true,
    },
  }
})
