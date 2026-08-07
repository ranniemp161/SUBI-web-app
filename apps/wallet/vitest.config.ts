import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Same reason as apps/rough-cut's config: Vitest has no "react-server"
      // condition, so a "server-only"-guarded module (now `@repo/billing`'s
      // ledger) would hit the package's throwing default export. These tests
      // exercise server-side code, so the no-op export is correct here.
      "server-only": fileURLToPath(
        new URL("../../node_modules/server-only/empty.js", import.meta.url)
      ),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
  }
});
