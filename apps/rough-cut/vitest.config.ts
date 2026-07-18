import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Next's build swaps this package for its no-op `empty.js` export via
      // the "react-server" condition, applied only inside Next's own
      // webpack/RSC pipeline. Vitest has no such condition, so without this
      // alias every test that imports a "server-only"-guarded module (e.g.
      // lib/blob.ts) hits the package's default export, which unconditionally
      // throws. Our tests exercise server-side code paths, so the no-op is
      // the correct behavior here too.
      "server-only": fileURLToPath(
        new URL("../../node_modules/server-only/empty.js", import.meta.url)
      ),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  }
});
