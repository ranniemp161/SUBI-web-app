import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Regression guard for a production-only 500 on every `loadMoreProjects` call.
//
// `actions.ts` re-exported a type it had imported (`export type
// { ProjectSummary }`). That is erased by TypeScript, so lint, typecheck, the
// test suite and `next build` all stayed green. Turbopack's "use server"
// transform does not erase it: it read the name as one more runtime export of
// the module and emitted
//
//   ensureServerEntryExports([loadMoreProjects, ProjectSummary])
//   registerServerReference(ProjectSummary, "<id>", null)
//
// against an identifier that never exists at runtime. Evaluating the module
// threw `ReferenceError: ProjectSummary is not defined`, which the client saw
// as a 500 and the generic "An error occurred in the Server Components render".
//
// The webpack pipeline erases it correctly, and `dev` runs `next dev
// --webpack`, so this shape is invisible locally and only ever fails in a
// built deployment. Nothing else in CI evaluates a built server chunk, which
// is why a source-level check is the guard that actually holds.

// `import.meta.url` is not a file: URL under the jsdom environment this suite
// runs in, so resolve from the workspace root vitest is invoked from instead.
const SRC = join(process.cwd(), "src");

/** Every .ts/.tsx file under src, recursively. */
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
    // If this drops to zero the checks below pass vacuously.
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
