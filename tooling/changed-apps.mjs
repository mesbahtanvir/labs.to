#!/usr/bin/env node
// CI planner CLI: decides which (idea, platform | backend) pairs need a run.
//
//   node tooling/changed-apps.mjs --base <git-ref>   only what changed since <ref>
//   node tooling/changed-apps.mjs --all              everything that is active
//   ... --stages live                                only ideas in these stages
//
// Prints JSON like {"web":[{idea,path,stage,run_tests}],"ios":[],"android":[],"supabase":[]}.
// When $GITHUB_OUTPUT is set, also writes one output per kind for workflow
// matrices. Exits 1 if any manifest is invalid, so a broken idea.yaml fails the
// run instead of silently skipping it.

import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ACTIVE_STAGES, STAGES } from "./lib/manifest.mjs";
import { computePlan } from "./lib/plan.mjs";

const { values } = parseArgs({
  options: { base: { type: "string" }, all: { type: "boolean" }, stages: { type: "string" } },
});

const stages = values.stages ? values.stages.split(",").map((s) => s.trim()).filter(Boolean) : ACTIVE_STAGES;
for (const s of stages) {
  if (!STAGES.includes(s)) {
    console.error(`unknown stage "${s}" (use ${STAGES.join(", ")})`);
    process.exit(1);
  }
}

const plan = computePlan({ base: values.all ? null : (values.base ?? null), stages });
if (plan.invalid) {
  for (const { dirName, errors } of plan.invalid) {
    console.error(`invalid apps/${dirName}:`);
    for (const e of errors) console.error(`  - ${e}`);
  }
  process.exit(1);
}
if (plan.warning) console.error(`warning: ${plan.warning}`);

const kinds = Object.keys(plan.result);
console.log(JSON.stringify(plan.result));
console.error(kinds.map((k) => `${k}: ${plan.result[k].length}`).join("  "));

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, kinds.map((k) => `${k}=${JSON.stringify(plan.result[k])}\n`).join(""));
}
