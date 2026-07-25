import path from "node:path";

/**
 * Each app owns its own flat ESLint config (`apps/*\/eslint.config.mjs`) and
 * there is none at the repo root, so ESLint has to be invoked from inside the
 * app directory or it will not find a config. `npm --workspace <name> exec`
 * does that cross-platform, which matters because the hooks run under Git Bash
 * on Windows and cmd/sh elsewhere.
 *
 * Packages (`packages/db`, `packages/ui`, `packages/server-shared`) have no
 * lint script and no ESLint config, so staged files there are skipped here —
 * they are still typechecked and tested by CI.
 */
const WORKSPACES = [
  { dir: "apps/rough-cut", name: "@repo/rough-cut" },
  { dir: "apps/wallet", name: "wallet" },
  { dir: "apps/founders-frame", name: "@repo/founders-frame" },
];

export default {
  "*.{ts,tsx,js,jsx,mjs}": (files) => {
    const commands = [];

    for (const { dir, name } of WORKSPACES) {
      const root = path.resolve(dir);
      const owned = files.filter((f) => f.startsWith(root + path.sep));
      if (owned.length === 0) continue;

      // ESLint runs with cwd = the workspace, so paths must be relative to it.
      const relative = owned.map((f) =>
        path.relative(root, f).split(path.sep).join("/")
      );

      commands.push(
        `npm --workspace ${name} exec -- eslint --fix --no-warn-ignored --max-warnings=0 ${relative.join(" ")}`
      );
    }

    return commands;
  },
};
