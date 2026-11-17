#!/usr/bin/env node
// Scaffolds a new idea: apps/<name>/{idea.yaml, idea.md, .specify/, <platform>/..., supabase/...}
//
//   pnpm new <name> [--platforms web,ios,android] [--stage prototype]
//                   [--backend supabase|none] [--title "Pretty Name"] [--owner <who>]
//
// Platform folders are stamped out from templates/<platform>/. With the
// supabase backend, templates/supabase/ becomes apps/<name>/supabase/ and any
// templates/overlays/supabase/<platform>/ is layered on top of that platform
// (package.json files are merged, everything else is overwritten).
// Placeholders {{name}} {{title}} {{title_xml}} {{owner}} {{bundle_id}} {{timestamp}}
// {{api_port}} are replaced in file contents and file names. {{title_xml}} is the
// title as an Android string resource (& escaped, a leading @ or ? protected).
// Every idea, a spark included, is also made a Spec Kit project (templates/speckit/):
// its own constitution, the speckit-* skills, and specs/ once the first feature is specified.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { parseArgs } from "node:util";
import {
  APPS_DIR,
  BACKENDS,
  PLATFORMS,
  STAGES,
  TEMPLATES_DIR,
  defaultBundleId,
  isValidName,
  loadIdea,
} from "./lib/manifest.mjs";
import { installSpecKit } from "./lib/speckit.mjs";

const BINARY_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".icns", ".jar", ".webp", ".ttf", ".otf", ".woff", ".woff2"]);

// A local Supabase stack listens on a block of ports (api, db, studio, ...).
// Supabase's defaults (54320-54329) collide with every other local Supabase
// project on the machine, and macOS hands out ephemeral ports from 49152 up, so
// labs stacks live in 44320-49151 instead: one block of 10 per idea, allocated
// in order, so several stacks (or several agents in several worktrees) can run
// at the same time.
const TEMPLATE_API_PORT = 54321; // the ports baked into templates/supabase/config.toml
const BASE_API_PORT = 44321;
const PORT_BLOCK = 10;
const BASE_INSPECTOR_PORT = 48083; // edge runtime inspector

const fail = (msg) => {
  console.error(`error: ${msg}`);
  process.exit(1);
};

const render = (text, tokens) => text.replace(/\{\{(\w+)\}\}/g, (whole, key) => (key in tokens ? tokens[key] : whole));

function mergePackageJson(file, extra) {
  const base = JSON.parse(readFileSync(file, "utf8"));
  for (const [key, value] of Object.entries(extra)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const merged = { ...(base[key] ?? {}), ...value };
      base[key] = /dependencies/i.test(key)
        ? Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)))
        : merged;
    } else {
      base[key] = value;
    }
  }
  writeFileSync(file, `${JSON.stringify(base, null, 2)}\n`);
}

function copyTemplate(src, dest, tokens, { merge = false } = {}) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, render(entry.name, tokens));
    if (entry.isDirectory()) {
      copyTemplate(from, to, tokens, { merge });
    } else if (BINARY_EXT.has(extname(entry.name).toLowerCase())) {
      copyFileSync(from, to);
    } else if (merge && entry.name === "package.json" && existsSync(to)) {
      mergePackageJson(to, JSON.parse(render(readFileSync(from, "utf8"), tokens)));
    } else {
      writeFileSync(to, render(readFileSync(from, "utf8"), tokens), { mode: statSync(from).mode });
    }
  }
}

function gitUserName() {
  try {
    return execFileSync("git", ["config", "user.name"], { encoding: "utf8" }).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

// Port-block slots already taken by other ideas, read from their config.toml.
function usedPortSlots() {
  const slots = new Set();
  if (!existsSync(APPS_DIR)) return slots;
  for (const e of readdirSync(APPS_DIR, { withFileTypes: true })) {
    const file = join(APPS_DIR, e.name, "supabase", "config.toml");
    if (!e.isDirectory() || !existsSync(file)) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    const api = lines.findIndex((l) => l.trim() === "[api]");
    if (api === -1) continue;
    for (const l of lines.slice(api + 1)) {
      if (l.startsWith("[")) break;
      const m = l.match(/^port\s*=\s*(\d+)/);
      if (m) {
        slots.add((Number(m[1]) - BASE_API_PORT) / PORT_BLOCK);
        break;
      }
    }
  }
  return slots;
}

function shiftPorts(config, slot) {
  const delta = BASE_API_PORT - TEMPLATE_API_PORT + slot * PORT_BLOCK;
  return config.replace(/^(\s*[a-z_]*port\s*=\s*)(\d+)/gm, (line, head, value) => {
    const port = Number(value);
    if (port >= 54320 && port <= 54329) return `${head}${port + delta}`;
    if (port === 8083) return `${head}${BASE_INSPECTOR_PORT + slot}`;
    return line;
  });
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
if (!isValidName(name)) fail(`"${name}" is not a valid name. Use kebab-case, 3-40 chars, starting with a letter.`);
if (existsSync(join(APPS_DIR, name))) fail(`apps/${name} already exists`);

const stage = values.stage ?? "prototype";
if (!STAGES.includes(stage)) fail(`stage must be one of ${STAGES.join(", ")}`);

const backend = values.backend ?? "supabase";
if (!BACKENDS.includes(backend)) fail(`backend must be one of ${BACKENDS.join(", ")}`);
if (backend === "supabase" && !existsSync(join(TEMPLATES_DIR, "supabase"))) fail("templates/supabase/ is missing");

const platforms = values.platforms === undefined ? (stage === "spark" ? [] : ["web"]) : values.platforms.split(",").map((p) => p.trim()).filter(Boolean);
for (const p of platforms) {
  if (!PLATFORMS.includes(p)) fail(`unknown platform "${p}". Use ${PLATFORMS.join(", ")}`);
  if (!existsSync(join(TEMPLATES_DIR, p))) fail(`there is no template for "${p}" yet (templates/${p}/ is missing)`);
}
if (new Set(platforms).size !== platforms.length) fail("platforms contains duplicates");

const title = values.title ?? name.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
// Titles are substituted into source files (JSX, Swift, Kotlin strings), so keep them inert.
if (!/^[^"'\\{}<>`$]+$/.test(title)) fail(`title must not contain quotes, backslashes, braces, angle brackets, backticks or $`);
const titleXml = title.replace(/&/g, "&amp;").replace(/^([@?])/, "\\$1");
const owner = values.owner ?? gitUserName();
const bundleId = defaultBundleId(name);
const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14); // YYYYMMDDHHMMSS, UTC

// Claim this idea's block of local Supabase ports before templates are rendered,
// because client env files need the API port.
let slot = null;
if (backend === "supabase" && stage !== "spark") {
  const taken = usedPortSlots();
  slot = 0;
  while (taken.has(slot)) slot++;
}
const tokens = { name, title, title_xml: titleXml, owner, bundle_id: bundleId, timestamp, api_port: String(BASE_API_PORT + (slot ?? 0) * PORT_BLOCK) };

const dir = join(APPS_DIR, name);
mkdirSync(dir, { recursive: true });

writeFileSync(
  join(dir, "idea.yaml"),
  `# Source of truth for this idea. CI, releases and tooling all read this file.
name: ${name}
title: ${JSON.stringify(title)}
stage: ${stage}          # ${STAGES.join(" | ")}
platforms: [${platforms.join(", ")}]
backend: ${backend}      # ${BACKENDS.join(" | ")}
owner: ${JSON.stringify(owner)}
bundle_id: ${bundleId}   # iOS bundle id and Android applicationId
`,
);
writeFileSync(join(dir, "idea.md"), render(readFileSync(join(TEMPLATES_DIR, "idea.md"), "utf8"), tokens));
const specKit = installSpecKit(dir, { name, title });

for (const p of platforms) {
  copyTemplate(join(TEMPLATES_DIR, p), join(dir, p), tokens);
  const overlay = join(TEMPLATES_DIR, "overlays", backend, p);
  if (backend !== "none" && existsSync(overlay)) copyTemplate(overlay, join(dir, p), tokens, { merge: true });
}

if (slot !== null) {
  copyTemplate(join(TEMPLATES_DIR, "supabase"), join(dir, "supabase"), tokens);
  const config = join(dir, "supabase", "config.toml");
  writeFileSync(config, shiftPorts(readFileSync(config, "utf8"), slot));
}

const { errors } = loadIdea(name);
if (errors.length > 0) fail(`generated idea is invalid:\n  - ${errors.join("\n  - ")}`);

console.log(`Created apps/${name} (${stage}; ${platforms.join(", ") || "no platforms yet"}; backend: ${backend}; Spec Kit ${specKit.version})\n`);
console.log("Next:");
console.log(`  1. Fill in apps/${name}/idea.md (problem, hypothesis, success metric, kill criteria)`);
console.log(`  2. Specify the first feature before building it: in Claude, from apps/${name}, /speckit-specify <what and why>`);
let step = 3;
if (platforms.includes("web")) {
  console.log(`  ${step++}. pnpm install`);
}
if (slot !== null) {
  console.log(`  ${step++}. pnpm sb ${name} start            # local Supabase (needs Docker; ports ${BASE_API_PORT + slot * PORT_BLOCK - 1}-${BASE_API_PORT + slot * PORT_BLOCK + 8})`);
  if (platforms.includes("web")) {
    console.log(`  ${step++}. cp apps/${name}/web/.env.example apps/${name}/web/.env.local   # then paste keys from: pnpm sb ${name} status`);
  }
}
if (platforms.includes("web")) {
  console.log(`  ${step++}. pnpm --filter @labs/${name}-web dev`);
}
if (platforms.includes("ios")) {
  if (slot !== null) {
    console.log(`  ${step++}. cp apps/${name}/ios/Config/Local.xcconfig.example apps/${name}/ios/Config/Local.xcconfig   # then paste the key from: pnpm sb ${name} status`);
  }
  console.log(`  ${step++}. pnpm ios ${name}                 # generates the Xcode project from project.yml and opens it (needs: brew install xcodegen)`);
}
if (platforms.includes("android")) {
  if (slot !== null) {
    console.log(`  ${step++}. cp apps/${name}/android/local.properties.example apps/${name}/android/local.properties   # then paste the key from: pnpm sb ${name} status`);
  }
  console.log(`  ${step++}. open apps/${name}/android in Android Studio   # or: cd apps/${name}/android && ./gradlew assembleDebug`);
}
console.log(`  ->  Commit on a branch. Verify locally before pushing.`);
