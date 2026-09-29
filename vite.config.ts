import { defineConfig } from 'vitest/config';
import { rendererPlugins } from './vite.shared';

// Browser build. The Electron build lives in electron.vite.config.ts and reuses rendererPlugins().
export default defineConfig({
  plugins: rendererPlugins(),
  build: {
    outDir: 'dist',
    target: 'es2023',
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
});
