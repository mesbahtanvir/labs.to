#!/usr/bin/env node
// Generates client types from an idea's LOCAL Supabase database (the schema is
// the contract between platforms) and writes them into each platform folder.
//
//   pnpm types <idea>            regenerate and write
//   pnpm types <idea> --check    exit 1 if the committed types are stale
//
// Requires the idea's dev stack to be running: pnpm sb <idea> start
// (`pnpm verify` runs this check itself, against its own throwaway stack.)

import { join } from "node:path";
import { APPS_DIR, isValidName, loadIdea } from "./lib/manifest.mjs";
import { generateTypes } from "./lib/types.mjs";

const [idea, ...flags] = process.argv.slice(2);
if (!idea || !isValidName(idea)) {
  console.error("usage: pnpm types <idea> [--check]");
  process.exit(1);
}

const { manifest, errors } = loadIdea(idea);
if (errors.length > 0 || !manifest) {
  console.error(`apps/${idea} is invalid:\n  - ${errors.join("\n  - ")}`);
  process.exit(1);
}
if (manifest.backend !== "supabase") {
  console.error(`apps/${idea} does not use the supabase backend; nothing to generate.`);
  process.exit(1);
}

const result = generateTypes({ idea, manifest, workdir: join(APPS_DIR, idea), check: flags.includes("--check") });
for (const m of result.messages) (result.ok && result.stale === 0 ? console.log : console.error)(m);
if (!result.ok) console.error(`is the stack running? pnpm sb ${idea} start`);
process.exit(result.ok && result.stale === 0 ? 0 : 1);
