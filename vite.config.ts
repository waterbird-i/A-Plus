import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { open: false },
  build: { target: 'es2022', sourcemap: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
