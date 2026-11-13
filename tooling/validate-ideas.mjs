#!/usr/bin/env node
// Validates every apps/<idea>/idea.yaml. Exits 1 if any manifest is invalid.

import { loadIdeas } from "./lib/manifest.mjs";

const ideas = loadIdeas();
let failed = 0;

for (const { dirName, manifest, errors } of ideas) {
  if (errors.length === 0) {
    console.log(`ok   apps/${dirName}  (${manifest.stage}: ${manifest.platforms.join(", ") || "no platforms"})`);
  } else {
    failed++;
    console.error(`FAIL apps/${dirName}`);
    for (const e of errors) console.error(`       - ${e}`);
  }
}

if (ideas.length === 0) console.log("no ideas yet. Create one with: pnpm new <name>");
process.exit(failed === 0 ? 0 : 1);
