import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'lumi-react-production',
      generateBundle(
        _options: unknown,
        bundle: Record<string, { type: string; modules?: Record<string, unknown> }>,
      ) {
        const legacy =
          /[/\\]node_modules[/\\](?:@vue[/\\]|vue[/\\]|vue-router[/\\]|pinia[/\\]|vue-i18n[/\\]|reka-ui[/\\]|lucide-vue-next[/\\]|@tanstack[/\\]vue-virtual[/\\])/
        for (const chunk of Object.values(bundle)) {
          if (
            chunk.type === 'chunk' &&
            Object.keys(chunk.modules ?? {}).some((id) => legacy.test(id))
          )
            throw new Error('Production build includes a legacy Vue dependency')
        }
      },
    },
  ],
  resolve: {
    alias: {
      '@lumi/session': fileURLToPath(
        new URL('./src/react/features/auth/session-adapter.ts', import.meta.url),
      ),
      '@': fileURLToPath(new URL('./src/react', import.meta.url)),
    },
  },
  build: {
    outDir: '../backend/web/dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
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
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**'],
    restoreMocks: true,
    unstubGlobals: true,
  },
})
