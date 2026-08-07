import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Next's build swaps this package for its no-op `empty.js` export via
      // the "react-server" condition, applied only inside Next's own
      // webpack/RSC pipeline. Vitest has no such condition, so without this
      // alias every test importing the "server-only"-guarded `ledger.ts` hits
      // the package's default export, which unconditionally throws. These
      // tests exercise server-side code, so the no-op is correct here too.
      // Same alias as apps/rough-cut and apps/wallet.
      "server-only": fileURLToPath(
        new URL("../../node_modules/server-only/empty.js", import.meta.url)
      ),
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
