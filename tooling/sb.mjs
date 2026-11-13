#!/usr/bin/env node
// Runs the repo-pinned Supabase CLI against one idea's backend.
//
//   pnpm sb <idea> <supabase args...>      e.g.  pnpm sb my-idea start
//                                                pnpm sb my-idea db reset
//                                                pnpm sb my-idea test db
//
// Using this wrapper (instead of a globally installed `supabase`) keeps every
// machine and agent on the same CLI version, and points it at the right folder.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { APPS_DIR, ROOT, isValidName } from "./lib/manifest.mjs";

const [idea, ...args] = process.argv.slice(2);
if (!idea || args.length === 0) {
  console.error("usage: pnpm sb <idea> <supabase args...>   e.g. pnpm sb my-idea start");
  process.exit(1);
}
if (!isValidName(idea) || !existsSync(join(APPS_DIR, idea, "supabase", "config.toml"))) {
  console.error(`apps/${idea}/supabase/config.toml not found. Is "${idea}" an idea with the supabase backend?`);
  process.exit(1);
}
const bin = join(ROOT, "node_modules", ".bin", "supabase");
if (!existsSync(bin)) {
  console.error("The Supabase CLI is not installed. Run: pnpm install");
  process.exit(1);
}

const result = spawnSync(bin, ["--workdir", join(APPS_DIR, idea), ...args], { stdio: "inherit" });
process.exit(result.status ?? 1);
