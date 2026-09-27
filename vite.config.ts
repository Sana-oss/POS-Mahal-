import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
// vitest/config re-exports Vite's defineConfig with the `test` key typed.
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        manifest: false, // We provide /manifest.webmanifest directly in public/
        devOptions: {
          enabled: true,
        },
      }),
    ],
    resolve: {
      alias: {
        // import.meta.dirname, not __dirname: the CJS global is unavailable under
        // Vite's native ESM config loader and triggers a deprecation warning.
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    test: {
      // Default to node: the business-logic tests (calculations, store) need no
      // DOM and run faster. Component test files opt in with a
      // `// @vitest-environment jsdom` docblock, so jsdom is only paid for where
      // a DOM is actually required.
      environment: 'node',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.test.mjs'],
      restoreMocks: true,
      // Pin the suite to local-only mode. Vite loads the real .env in tests too,
      // and a configured Supabase makes dataSource route every write to Postgres,
      // so component tests silently stopped exercising the local store they
      // assert against. Cloud behaviour is covered by mocking ./supabase in the
      // two suites that care about it (dataSource, realtime) rather than by
      // talking to a live project, so no test needs real credentials.
      env: {
        VITE_SUPABASE_URL: '',
        VITE_SUPABASE_ANON_KEY: '',
      },
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

