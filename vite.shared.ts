import react from '@vitejs/plugin-react';
import type { Plugin, PluginOption } from 'vite';

/**
 * Content-Security-Policy for production renderer builds (browser and Electron).
 * Only applied on build: the dev server relies on inline scripts for React Fast Refresh.
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

/** Plugins shared by the browser build and the Electron renderer build. */
export function rendererPlugins(): PluginOption[] {
  return [react(), contentSecurityPolicy()];
}
