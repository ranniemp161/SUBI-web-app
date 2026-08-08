import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The same guard apps/rough-cut carries, for the same reason, kept here rather
// than shared because it has to walk THIS app's source tree.
//
// A `"use server"` module may export nothing but async functions. Not even a
// type. TypeScript erases `export type { X }` and so does webpack, but
// Turbopack's server actions transform does not: it reads the name as one more
// runtime export and emits `registerServerReference(X, ...)` against an
// identifier that only exists in the type system. Evaluating the module then
// throws `ReferenceError: X is not defined`, so every call to every action in
// it answers 500.
//
// Nothing else catches this. lint, typecheck and the test suite never evaluate
// a built server chunk, and `next build` compiles it happily. It cost Rough Cut
// a live production outage (PR #122), which is why the check is source level.
const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** A module is a server-action module when its first directive is "use server". */
function isServerActionModule(contents: string): boolean {
  return /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(contents);
}

// `export type { X }`, `export type X =`, and `export { type X }` — every way a
// type-only export can be written.
const TYPE_EXPORT = /^\s*export\s+type\s|^\s*export\s*\{[^}]*\btype\s/m;

describe('"use server" modules', () => {
  const modules = sourceFiles(SRC)
    .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
    .map((file) => [file, readFileSync(file, "utf8")] as const)
    .filter(([, contents]) => isServerActionModule(contents));

  it("finds the app's server-action modules", () => {
    // If this drops to zero the check below passes vacuously.
    expect(modules.length).toBeGreaterThan(0);
  });

  it.each(modules.map(([file]) => file))(
    "%s exports no types (Turbopack registers them as server references)",
    (file) => {
      const contents = modules.find(([f]) => f === file)![1];
      expect(TYPE_EXPORT.test(contents)).toBe(false);
    }
  );
});
