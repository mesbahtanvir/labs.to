#!/usr/bin/env node
// Prepares the GitHub Release for a release tag. Used by .github/workflows/release.yml,
// and runnable anywhere to see what a release would say.
//
//   node tooling/release-notes.mjs <idea>/<platform>/vX.Y.Z [--out notes.md]
//
// Exits 1, saying why, when the tag is not on origin/main (it was not made by `pnpm
// release`). When $GITHUB_OUTPUT is set it writes release, title and prerelease for the
// workflow's next step.

import { appendFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { describeRelease } from "./lib/release-notes.mjs";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: "string" } } });
if (positionals.length !== 1) {
  console.error("usage: node tooling/release-notes.mjs <idea>/<platform>/vX.Y.Z [--out notes.md]");
  process.exit(2);
}

const r = describeRelease(positionals[0]);
if (!r.ok) {
  console.error(r.out);
  process.exit(1);
}

const outputs = r.release ? { release: "true", title: r.title, prerelease: String(r.prerelease) } : { release: "false" };
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([k, v]) => `${k}=${v}\n`).join(""));

if (!r.release) {
  console.log(r.out);
  process.exit(0);
}
if (values.out) writeFileSync(values.out, r.notes);
else process.stdout.write(r.notes);
console.error(`${r.title}${r.prerelease ? " (prerelease)" : ""}`);
