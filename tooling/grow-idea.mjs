#!/usr/bin/env node
// Grows an idea that already exists: adds platforms, or its backend.
//
//   pnpm grow <idea> [--platforms ios,android] [--backend supabase] [--force]
//
// `pnpm new` refuses a folder that exists, and copying templates by hand skips the tokens,
// the overlays and the port block. This command stamps out the same files `pnpm new` would
// have (lib/scaffold.mjs does both) and keeps idea.yaml in step:
//
//   --platforms   each one gets apps/<idea>/<platform>/ from templates/<platform>/, with the
//                 backend's overlay on top. A platform folder that exists is refused.
//                 A spark that gets its first platform becomes a prototype.
//   --backend     supabase, for an idea whose backend is none: apps/<idea>/supabase/ on a free
//                 block of local ports, and the Supabase overlay on the platforms it already
//                 has. If the overlay would replace a file that was edited, nothing is written
//                 unless --force is given.
//
// A spark that declared `backend: supabase` gets its supabase/ folder with its first platform.
// Nothing is written unless everything asked for can be.
//
// It is `grow`, not `add`, because `pnpm add <name>` is pnpm's own command for installing a
// dependency, and it wins over a script of the same name.

import { parseArgs } from "node:util";
import { BACKENDS, PLATFORMS } from "./lib/manifest.mjs";
import { applyGrowth, nextSteps, parsePlatforms, planGrowth } from "./lib/scaffold.mjs";

const usage = `usage: pnpm grow <idea> [--platforms ${PLATFORMS.join(",")}] [--backend ${BACKENDS.join("|")}] [--force]`;

const fail = (lines) => {
  const [first, ...rest] = [lines].flat();
  console.error([`error: ${first}`, ...rest].join("\n"));
  process.exit(1);
};

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      platforms: { type: "string" },
      backend: { type: "string" },
      force: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
} catch (e) {
  fail([e.message.split("\n")[0], usage]);
}
const { positionals, values } = args;

if (values.help || positionals.length !== 1) {
  console.log(usage);
  process.exit(values.help ? 0 : 1);
}

const [name] = positionals;
const plan = planGrowth(name, {
  platforms: values.platforms === undefined ? [] : parsePlatforms(values.platforms),
  backend: values.backend ?? null,
  force: values.force ?? false,
});
if (plan.errors.length > 0) fail(plan.errors);

const errors = applyGrowth(plan);
if (errors.length > 0) fail([`apps/${name} is invalid after the change:`, ...errors.map((e) => `  - ${e}`)]);

const { before, after } = plan;
const app = `apps/${name}`;
console.log(`Updated ${app} (${after.stage}; ${after.platforms.join(", ") || "no platforms yet"}; backend: ${after.backend})`);
if (plan.platforms.length > 0) console.log(`  added:    ${plan.platforms.map((p) => `${app}/${p}`).join(", ")}`);
if (plan.createStack) {
  const into = plan.overlaid.length > 0 ? `, and its files in ${plan.overlaid.map((p) => `${app}/${p}`).join(", ")}` : "";
  console.log(`  backend:  ${app}/supabase (ports ${plan.apiPort - 1}-${plan.apiPort + 8})${into}`);
} else if (after.backend !== before.backend) {
  console.log(`  backend:  ${before.backend} -> ${after.backend} in idea.yaml (a spark has no supabase/ folder until its first platform)`);
}
if (after.stage !== before.stage) console.log(`  stage:    ${before.stage} -> ${after.stage}`);
if (plan.replaced.length > 0) {
  console.log(`  replaced, although edited (git diff shows what was there): ${plan.replaced.map((f) => `${app}/${f}`).join(", ")}`);
}

// Platforms that now hold backend files and so need the local key: the new ones (when the
// idea has a backend) and the ones the overlay was just applied to.
const backendFor = after.backend === "supabase" && after.stage !== "spark" ? [...plan.overlaid, ...plan.platforms] : [];
const steps = nextSteps({
  name,
  stamped: plan.platforms,
  backendFor,
  apiPort: plan.createStack || backendFor.length > 0 ? plan.apiPort : null,
  schemaIsOlder: plan.schemaIsOlder,
});
console.log("\nNext:");
console.log(steps.join("\n"));
