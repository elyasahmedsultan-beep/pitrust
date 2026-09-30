import path from 'path';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

const validationKeyPath = path.resolve(import.meta.dirname, '../../validation-key.txt');

function validationKeyMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: (error?: Error) => void,
): void {
  const requestedPath = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (requestedPath !== '/validation-key.txt' || (req.method !== 'GET' && req.method !== 'HEAD')) {
    next();
    return;
  }

  void readFile(validationKeyPath).then((contents) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Length', contents.byteLength);
    res.setHeader('Cache-Control', 'no-store');
    res.end(req.method === 'HEAD' ? undefined : contents);
  }).catch((error: unknown) => {
    next(error instanceof Error ? error : new Error('Could not read domain validation key'));
  });
}

function validationKeyServerPlugin() {
  return {
    name: 'pi-domain-validation-key-server',
    configureServer(server: { middlewares: { use: (handler: typeof validationKeyMiddleware) => void } }) {
      server.middlewares.use(validationKeyMiddleware);
    },
    configurePreviewServer(server: { middlewares: { use: (handler: typeof validationKeyMiddleware) => void } }) {
      server.middlewares.use(validationKeyMiddleware);
    },
  };
}

function validationKeyBuildPlugin() {
  return {
    name: 'pi-domain-validation-key-build',
    apply: 'build' as const,
    async writeBundle() {
      const publicDir = path.resolve(import.meta.dirname, 'dist/public');
      await mkdir(publicDir, { recursive: true });
      await copyFile(validationKeyPath, path.join(publicDir, 'validation-key.txt'));
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    validationKeyServerPlugin(),
    validationKeyBuildPlugin(),
    react(),
    tailwindcss({ optimize: false }),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
    sourcemap: false,
    reportCompressedSize: false,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
