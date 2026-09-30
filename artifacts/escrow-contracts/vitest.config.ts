import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const artifactRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(artifactRoot, 'src'),
      '@assets': path.resolve(artifactRoot, '..', '..', 'attached_assets'),
    },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.ui.test.tsx', 'src/pages/profile.test.tsx'],
    clearMocks: true,
    restoreMocks: true,
  },
});
