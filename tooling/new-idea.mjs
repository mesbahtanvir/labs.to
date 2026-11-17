#!/usr/bin/env node
// Scaffolds a new idea: apps/<name>/{idea.yaml, idea.md, .specify/, <platform>/..., supabase/...}
//
//   pnpm new <name> [--platforms web,ios,android] [--stage prototype]
//                   [--backend supabase|none] [--title "Pretty Name"] [--owner <who>]
//
// `--stage spark` is an idea on paper: idea.md and Spec Kit, no platforms (asking for both is
// refused). `pnpm grow` gives it its first platform later.
// Platform folders are stamped out from templates/<platform>/. With the
// supabase backend, templates/supabase/ becomes apps/<name>/supabase/ and any
// templates/overlays/supabase/<platform>/ is layered on top of that platform
// (package.json files are merged, everything else is overwritten). The stamping
// itself is in lib/scaffold.mjs, shared with `pnpm grow`, which adds a platform or
// a backend to an idea that already exists.
// Every idea, a spark included, is also made a Spec Kit project (templates/speckit/):
// its own constitution, the speckit-* skills, and specs/ once the first feature is specified.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { APPS_DIR, BACKENDS, NAME_RULE, STAGES, TEMPLATES_DIR, isValidName, loadIdea } from "./lib/manifest.mjs";
import { TITLE_RULE, createIdea, defaultTitle, nextSteps, parsePlatforms, platformsProblem, slotApiPort, sparkProblem, titleIsInert } from "./lib/scaffold.mjs";

const fail = (msg) => {
  console.error(`error: ${msg}`);
  process.exit(1);
};

function gitUserName() {
  try {
    return execFileSync("git", ["config", "user.name"], { encoding: "utf8" }).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    platforms: { type: "string" },
    stage: { type: "string" },
    backend: { type: "string" },
    title: { type: "string" },
    owner: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help || positionals.length === 0) {
  console.log(
    `usage: pnpm new <name> [--platforms web,ios,android] [--stage ${STAGES.join("|")}] [--backend ${BACKENDS.join("|")}] [--title "Name"] [--owner who]`,
  );
  process.exit(values.help ? 0 : 1);
}

const [name] = positionals;
if (!isValidName(name)) fail(`"${name}" is not a valid name. Use ${NAME_RULE}.`);
if (existsSync(join(APPS_DIR, name))) fail(`apps/${name} already exists. To add a platform or a backend to it: pnpm grow ${name} --platforms ... --backend ...`);

const stage = values.stage ?? "prototype";
if (!STAGES.includes(stage)) fail(`stage must be one of ${STAGES.join(", ")}`);

const backend = values.backend ?? "supabase";
if (!BACKENDS.includes(backend)) fail(`backend must be one of ${BACKENDS.join(", ")}`);
if (backend === "supabase" && !existsSync(join(TEMPLATES_DIR, "supabase"))) fail("templates/supabase/ is missing");

const platforms = values.platforms === undefined ? (stage === "spark" ? [] : ["web"]) : parsePlatforms(values.platforms);
const problem = platformsProblem(platforms) ?? sparkProblem(name, stage, platforms);
if (problem) fail(problem);

const title = values.title ?? defaultTitle(name);
if (!titleIsInert(title)) fail(TITLE_RULE);
const owner = values.owner ?? gitUserName();

const { slot, specKit } = createIdea({ name, title, stage, platforms, backend, owner });

const { errors } = loadIdea(name);
if (errors.length > 0) fail(`generated idea is invalid:\n  - ${errors.join("\n  - ")}`);

console.log(`Created apps/${name} (${stage}; ${platforms.join(", ") || "no platforms yet"}; backend: ${backend}; Spec Kit ${specKit.version})\n`);
console.log("Next:");
const steps = nextSteps({
  name,
  intro: true,
  stamped: platforms,
  backendFor: slot !== null ? platforms : [],
  apiPort: slot !== null ? slotApiPort(slot) : null,
});
console.log(steps.join("\n"));
