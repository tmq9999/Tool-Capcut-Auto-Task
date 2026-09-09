import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import { notBundle } from 'vite-plugin-electron/plugin';
import renderer from 'vite-plugin-electron-renderer';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            minify: false,
          },
          plugins: [
            notBundle({
              /**
               * Hai package này KHÔNG được bundle vào `dist-electron/main.js`:
               *   - `better-sqlite3`: native addon.
               *   - `playwright-core`: `utilsBundle.js` có dynamic import
               *     `kerberos` (native, tuỳ chọn) nên Rollup không resolve được —
               *     build vỡ đúng chỗ đó khi engine automation được gộp vào main.
               * Để ngoài bundle thì Electron `require()` thẳng từ node_modules.
               */
              filter: (resolvedId) => {
                const normalized = resolvedId.replace(/\\/g, '/');
                return (
                  normalized.includes('/node_modules/better-sqlite3/') ||
                  normalized.includes('/node_modules/playwright-core/') ||
                  normalized.includes('/node_modules/ws/')
                );
              },
            }),
          ],
        },
      },
      {
        entry: 'src/preload/preload.ts',
        onstart(args) {
          args.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            minify: false,
            lib: false,
            rollupOptions: {
              input: 'src/preload/preload.ts',
              output: {
                format: 'cjs',
                entryFileNames: 'preload.js',
                inlineDynamicImports: true,
              },
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
