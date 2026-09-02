import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Live provider verification against the real vendor APIs.
 * Separate from vitest.config.ts so the default suite never hits the network.
 * Run with: npm run verify:providers
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/__live__/**/*.live.test.ts'],
    exclude: ['node_modules', 'dist', 'dist-electron', 'scripts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    reporters: ['verbose'],
  },
  resolve: {
    alias: {
      '@main': path.resolve(__dirname, 'src/main'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
