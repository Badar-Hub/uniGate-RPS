import { defineConfig } from 'vitest/config';

/** Pure modules only (src/lib/tabs, …) — nothing that imports react-native runs here. */
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
});
