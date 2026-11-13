#!/usr/bin/env node
// Scans for committed secrets.
//
//   pnpm scan              every file that is not git-ignored (tracked + untracked)
//   pnpm scan --staged     only what is staged for commit (used by the pre-commit hook)
//
// Exits 1 on any finding. Output never includes the matched value.

import { findSecrets, listFiles } from "./lib/secrets.mjs";

const staged = process.argv.includes("--staged");
const files = listFiles({ staged });
const findings = findSecrets({ files, staged });

if (findings.length === 0) {
  console.log(`secrets: none found (${files.length} file${files.length === 1 ? "" : "s"} scanned${staged ? ", staged only" : ""})`);
  process.exit(0);
}

console.error("secrets: possible secrets found (values not shown):");
for (const f of findings) console.error(`  ${f.file}${f.line ? `:${f.line}` : ""}  ${f.rule}`);
console.error("\nRemove them (and rotate anything real). A deliberate false positive can carry `labs:allow-secret` on its line.");
process.exit(1);
