import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/_tests_/**/*.test.ts'],
  },
  server: {
    // Prevent tailwindcss/react plugin conflicts in test environment
  },
} as Parameters<typeof defineConfig>[0] & { server?: unknown });
