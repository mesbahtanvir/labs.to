#!/usr/bin/env node
// Points git at the tracked hooks in .githooks/ (runs from `pnpm install` via
// the root "prepare" script). No hook framework needed. Skipped in CI.

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.CI) process.exit(0);

const root = fileURLToPath(new URL("..", import.meta.url));
const git = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });

if (git(["rev-parse", "--git-dir"]).status !== 0) process.exit(0); // not a git checkout (e.g. a tarball)
const hooks = join(root, ".githooks");
if (!existsSync(hooks)) process.exit(0);

for (const f of readdirSync(hooks)) chmodSync(join(hooks, f), 0o755);
if (git(["config", "core.hooksPath", ".githooks"]).status === 0) {
  console.log("git hooks installed (.githooks: pre-commit, pre-push)");
}
