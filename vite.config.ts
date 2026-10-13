import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Content-Security-Policy for production builds. Only applied on build: the dev server
 * relies on inline scripts for React Fast Refresh.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'pixelsoup:csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig({
  // The path the site is served under: `/` for dev, preview and Cloudflare. The GitHub Pages
  // workflow sets VITE_BASE to the repository's path (docs/deploy.md).
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), contentSecurityPolicy()],
  server: {
    port: 1619,
    strictPort: true,
  },
  preview: {
    port: 1619,
    strictPort: true,
  },
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
