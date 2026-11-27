// Stamping ideas out of templates/. Shared by `pnpm new` (a new idea) and `pnpm grow`
// (a platform or a backend for an idea that already exists), so both produce the same files.
//
// Platform folders come from templates/<platform>/. With a backend, templates/<backend>/
// becomes apps/<idea>/<backend>/ and any templates/overlays/<backend>/<platform>/ is layered
// on top of that platform (package.json files are merged, everything else is overwritten).
// Placeholders {{name}} {{title}} {{title_xml}} {{owner}} {{bundle_id}} {{timestamp}}
// {{api_port}} are replaced in file contents and file names. {{title_xml}} is the title as
// an Android string resource (& escaped, a leading @ or ? protected).

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse, parseDocument } from "yaml";
import {
  APPS_DIR,
  BACKENDS,
  PLATFORMS,
  STAGES,
  TEMPLATES_DIR,
  TYPE_TARGETS,
  defaultBundleId,
  isValidBundleId,
  isValidName,
  loadIdea,
  networkOf,
} from "./manifest.mjs";
import { installSpecKit } from "./speckit.mjs";

const BINARY_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".icns", ".jar", ".webp", ".ttf", ".otf", ".woff", ".woff2"]);

// ---- templates ---------------------------------------------------------------

export const render = (text, tokens) => text.replace(/\{\{(\w+)\}\}/g, (whole, key) => (key in tokens ? tokens[key] : whole));

export function mergePackageJson(file, extra) {
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

/** Every file of a template folder, with the path it gets once its name is rendered. */
function templateFiles(src, tokens, rel = "") {
  const out = [];
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(rel, render(entry.name, tokens));
    if (entry.isDirectory()) out.push(...templateFiles(from, tokens, to));
    else out.push({ from, rel: to, binary: BINARY_EXT.has(extname(entry.name).toLowerCase()) });
  }
  return out;
}

const rendered = (file, tokens) => (file.binary ? readFileSync(file.from) : Buffer.from(render(readFileSync(file.from, "utf8"), tokens)));
// A package.json in an overlay is merged into the one that is there, never written over it.
const isMerged = (file, to) => basename(file.rel) === "package.json" && existsSync(to);

export function copyTemplate(src, dest, tokens, { merge = false } = {}) {
  mkdirSync(dest, { recursive: true });
  for (const file of templateFiles(src, tokens)) {
    const to = join(dest, file.rel);
    mkdirSync(dirname(to), { recursive: true });
    if (file.binary) copyFileSync(file.from, to);
    else if (merge && isMerged(file, to)) mergePackageJson(to, JSON.parse(rendered(file, tokens).toString()));
    else writeFileSync(to, rendered(file, tokens), { mode: statSync(file.from).mode });
  }
}

// ---- local Supabase ports ------------------------------------------------------

// A local Supabase stack listens on a block of ports (api, db, studio, ...).
// Supabase's defaults (54320-54329) collide with every other local Supabase
// project on the machine, and macOS hands out ephemeral ports from 49152 up, so
// labs stacks live in 44320-49151 instead: one block of 10 per idea, allocated
// in order, so several stacks (or several agents in several worktrees) can run
// at the same time.
const TEMPLATE_API_PORT = 54321; // the ports baked into templates/supabase/config.toml
export const BASE_API_PORT = 44321;
export const PORT_BLOCK = 10;
const BASE_INSPECTOR_PORT = 48083; // edge runtime inspector

export const slotApiPort = (slot) => BASE_API_PORT + slot * PORT_BLOCK;

/** The API port a Supabase config.toml sets (`port` under `[api]`), or null. */
export function apiPortIn(config) {
  const lines = config.split("\n");
  const api = lines.findIndex((l) => l.trim() === "[api]");
  if (api === -1) return null;
  for (const l of lines.slice(api + 1)) {
    if (l.startsWith("[")) break;
    const m = l.match(/^port\s*=\s*(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}

/** The API port of an idea's local stack, or null when it has none. */
export function ideaApiPort(ideaDir) {
  const file = join(ideaDir, "supabase", "config.toml");
  return existsSync(file) ? apiPortIn(readFileSync(file, "utf8")) : null;
}

/** Port-block slots already taken by the ideas in `appsDir`, read from their config.toml. */
export function usedPortSlots(appsDir = APPS_DIR) {
  const slots = new Set();
  if (!existsSync(appsDir)) return slots;
  for (const e of readdirSync(appsDir, { withFileTypes: true })) {
    const port = e.isDirectory() ? ideaApiPort(join(appsDir, e.name)) : null;
    if (port !== null) slots.add((port - BASE_API_PORT) / PORT_BLOCK);
  }
  return slots;
}

/** The first port block no idea in `appsDir` uses. */
export function freePortSlot(appsDir = APPS_DIR) {
  const taken = usedPortSlots(appsDir);
  let slot = 0;
  while (taken.has(slot)) slot++;
  return slot;
}

export function shiftPorts(config, slot) {
  const delta = BASE_API_PORT - TEMPLATE_API_PORT + slot * PORT_BLOCK;
  return config.replace(/^(\s*[a-z_]*port\s*=\s*)(\d+)/gm, (line, head, value) => {
    const port = Number(value);
    if (port >= 54320 && port <= 54329) return `${head}${port + delta}`;
    if (port === 8083) return `${head}${BASE_INSPECTOR_PORT + slot}`;
    return line;
  });
}

// ---- tokens --------------------------------------------------------------------

export const defaultTitle = (name) => name.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

// Titles are substituted into source files (JSX, Swift, Kotlin strings), so keep them inert.
export const titleIsInert = (title) => typeof title === "string" && /^[^"'\\{}<>`$]+$/.test(title);
export const TITLE_RULE = "title must not contain quotes, backslashes, braces, angle brackets, backticks or $";

const timestampNow = () => new Date().toISOString().replace(/\D/g, "").slice(0, 14); // YYYYMMDDHHMMSS, UTC

export function buildTokens({ name, title, owner, bundleId = defaultBundleId(name), apiPort = BASE_API_PORT, timestamp = timestampNow() }) {
  const titleXml = title.replace(/&/g, "&amp;").replace(/^([@?])/, "\\$1");
  return { name, title, title_xml: titleXml, owner, bundle_id: bundleId, timestamp, api_port: String(apiPort) };
}

/**
 * Why `pnpm new` can not create this, or null. A spark is an idea on paper (idea.md and
 * Spec Kit): it has no platform folder and no supabase/, so code for one would point at a
 * backend that is not there. Its platforms arrive with `pnpm grow`, which also makes it a prototype.
 */
export const sparkProblem = (name, stage, platforms) =>
  stage === "spark" && platforms.length > 0
    ? `a spark is an idea on paper (idea.md and Spec Kit, no code), so it takes no platforms. Leave --platforms out and add them when you start building (pnpm grow ${name} --platforms ${platforms.join(",")}), or start with code: --stage prototype`
    : null;

/** Why an idea that makes no network call can not have this backend, or a message for the caller to show. */
export const offlineBackendProblem = (backend) =>
  `--network none means the app makes no network call at all, so it can not have the ${backend} backend. Use --backend none`;

/** `--platforms web,ios` as a list. */
export const parsePlatforms = (text) => text.split(",").map((p) => p.trim()).filter(Boolean);

/** Why this list of platforms can not be stamped out, or null. */
export function platformsProblem(platforms, templatesDir = TEMPLATES_DIR) {
  for (const p of platforms) {
    if (!PLATFORMS.includes(p)) return `unknown platform "${p}". Use ${PLATFORMS.join(", ")}`;
    if (!existsSync(join(templatesDir, p))) return `there is no template for "${p}" yet (templates/${p}/ is missing)`;
  }
  return new Set(platforms).size !== platforms.length ? "platforms contains duplicates" : null;
}

// ---- the manifest --------------------------------------------------------------

/** The idea.yaml a new idea starts with. */
export function manifestText({ name, title, stage, platforms, backend, network = "online", owner, bundleId = defaultBundleId(name) }) {
  return `# Source of truth for this idea. CI, releases and tooling all read this file.
name: ${name}
title: ${JSON.stringify(title)}
stage: ${stage}          # ${STAGES.join(" | ")}
platforms: [${platforms.join(", ")}]
backend: ${backend}      # ${BACKENDS.join(" | ")}
${network === "none" ? `network: none      # no network call at all; \`pnpm verify\` enforces it\n` : ""}owner: ${JSON.stringify(owner)}
bundle_id: ${bundleId}   # iOS bundle id and Android applicationId
`;
}

const says = (text, want) => {
  try {
    return isDeepStrictEqual(parse(text), want);
  } catch {
    return false;
  }
};

/**
 * An idea.yaml with some fields set to new values (strings, or a list of strings),
 * everything else as it was. A field on one line (`stage: spark   # comment`) only has
 * its value replaced, so comments and alignment survive. Anything else, such as a list
 * written as a block, goes through the YAML library, which keeps comments but not spacing.
 * Throws if the result would not say exactly what was asked.
 */
export function updateManifestText(text, changes) {
  const want = { ...parse(text), ...changes };
  let lines = text;
  for (const [key, value] of Object.entries(changes)) {
    const scalar = Array.isArray(value) ? `[${value.join(", ")}]` : String(value);
    lines = lines.replace(new RegExp(`^(${key}:[ \\t]*)[^#\\n]*?([ \\t]*(?:#.*)?)$`, "m"), (whole, head, tail) => `${head}${scalar}${tail}`);
  }
  if (says(lines, want)) return lines;

  const doc = parseDocument(text);
  for (const [key, value] of Object.entries(changes)) {
    const node = doc.createNode(value);
    if (Array.isArray(value)) node.flow = true;
    doc.set(key, Array.isArray(value) ? node : value);
  }
  const out = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
  if (!says(out, want)) throw new Error(`could not set ${Object.keys(changes).join(", ")} in idea.yaml`);
  return out;
}

// ---- stamping ------------------------------------------------------------------

/** templates/overlays/<backend>/<platform>, or null when the backend adds nothing to that platform. */
function overlayOf(platform, backend, templatesDir) {
  const dir = join(templatesDir, "overlays", backend, platform);
  return backend !== "none" && existsSync(dir) ? dir : null;
}

/** Layers the backend's files over a platform folder. */
export function applyOverlay(ideaDir, platform, backend, tokens, templatesDir = TEMPLATES_DIR) {
  const overlay = overlayOf(platform, backend, templatesDir);
  if (overlay) copyTemplate(overlay, join(ideaDir, platform), tokens, { merge: true });
}

/** apps/<idea>/<platform>/ from templates/<platform>/, with the backend's overlay on top. */
export function stampPlatform(ideaDir, platform, backend, tokens, templatesDir = TEMPLATES_DIR) {
  copyTemplate(join(templatesDir, platform), join(ideaDir, platform), tokens);
  applyOverlay(ideaDir, platform, backend, tokens, templatesDir);
}

/** apps/<idea>/supabase/ from templates/supabase/, on its own block of ports. */
export function stampSupabase(ideaDir, tokens, slot, templatesDir = TEMPLATES_DIR) {
  copyTemplate(join(templatesDir, "supabase"), join(ideaDir, "supabase"), tokens);
  const config = join(ideaDir, "supabase", "config.toml");
  writeFileSync(config, shiftPorts(readFileSync(config, "utf8"), slot));
}

/**
 * Files in an existing platform folder that the backend's overlay would replace although
 * they are no longer what the platform template wrote: somebody's work. Paths are relative
 * to the platform folder. A file that is still the template's, or already the overlay's,
 * is not a conflict, and neither is package.json (it is merged).
 */
export function overlayConflicts(ideaDir, platform, backend, tokens, templatesDir = TEMPLATES_DIR) {
  const overlay = overlayOf(platform, backend, templatesDir);
  if (!overlay) return [];
  const pristine = new Map(templateFiles(join(templatesDir, platform), tokens).map((f) => [f.rel, f]));
  const conflicts = [];
  for (const file of templateFiles(overlay, tokens)) {
    const to = join(ideaDir, platform, file.rel);
    if (!existsSync(to) || isMerged(file, to)) continue;
    const current = readFileSync(to);
    if (current.equals(rendered(file, tokens))) continue;
    const base = pristine.get(file.rel);
    if (!base || !current.equals(rendered(base, tokens))) conflicts.push(file.rel);
  }
  return conflicts;
}

/**
 * Is the idea's schema still exactly the template's: the same migrations, whatever their
 * timestamps? If not, a platform stamped out now starts with types and models for a schema
 * the idea no longer has.
 */
function schemaIsTemplates(ideaDir, tokens, templatesDir) {
  const dir = join(ideaDir, "supabase", "migrations");
  const mine = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => readFileSync(join(dir, e.name), "utf8"))
    : [];
  const theirs = templateFiles(join(templatesDir, "supabase", "migrations"), tokens).map((f) => rendered(f, tokens).toString());
  return isDeepStrictEqual(mine.sort(), theirs.sort());
}

// ---- pnpm new ------------------------------------------------------------------

/**
 * Writes a new idea: idea.yaml, idea.md, Spec Kit, a folder per platform and, with the
 * supabase backend (and unless it is a spark), supabase/ on a free block of ports.
 * The caller has checked the arguments and that the folder does not exist. A spark with
 * platforms is refused here too (it throws, before anything is written).
 * @returns {{ dir: string, slot: number | null, specKit: object }}
 */
export function createIdea({ name, title, stage, platforms, backend, network = "online", owner, timestamp }, { appsDir = APPS_DIR, templatesDir = TEMPLATES_DIR } = {}) {
  const problem = sparkProblem(name, stage, platforms);
  if (problem) throw new Error(problem);
  if (network === "none" && backend !== "none") throw new Error(offlineBackendProblem(backend));
  // Claim this idea's block of local Supabase ports before templates are rendered,
  // because client env files need the API port.
  const slot = backend === "supabase" && stage !== "spark" ? freePortSlot(appsDir) : null;
  const tokens = buildTokens({ name, title, owner, apiPort: slotApiPort(slot ?? 0), timestamp });

  const dir = join(appsDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "idea.yaml"), manifestText({ name, title, stage, platforms, backend, network, owner, bundleId: tokens.bundle_id }));
  writeFileSync(join(dir, "idea.md"), render(readFileSync(join(templatesDir, "idea.md"), "utf8"), tokens));
  const specKit = installSpecKit(dir, { name, title, network });

  for (const p of platforms) stampPlatform(dir, p, backend, tokens, templatesDir);
  if (slot !== null) stampSupabase(dir, tokens, slot, templatesDir);
  return { dir, slot, specKit };
}

// ---- pnpm grow -----------------------------------------------------------------

/**
 * What growing an existing idea would do: the platforms to stamp out, whether its backend
 * arrives now (supabase/ on a free block of ports, and the overlay on the platforms it
 * already has) and the manifest afterwards. Nothing is written. A request that can not be
 * carried out in full comes back as `errors`; with none, pass the plan to applyGrowth.
 *
 * Rules: a platform folder that exists is never touched by a request for that platform.
 * A spark becomes a prototype when it gets its first platform. supabase/ exists exactly
 * when the backend is supabase and the idea is past spark, as `pnpm new` leaves it. A
 * backend is never taken away. With `force`, files the overlay replaces are replaced even
 * if they were edited.
 */
export function planGrowth(name, { platforms = [], backend = null, force = false } = {}, { appsDir = APPS_DIR, templatesDir = TEMPLATES_DIR, timestamp } = {}) {
  const dir = join(appsDir, name);
  if (!isValidName(name) || !existsSync(dir)) return { errors: [`apps/${name} does not exist. A new idea is created with: pnpm new ${name}`] };
  const idea = loadIdea(name, appsDir);
  if (idea.errors.length > 0) return { errors: [`apps/${name} is not valid as it is. Fix this first:`, ...idea.errors.map((e) => `  - ${e}`)] };
  const m = idea.manifest;
  const errors = [];

  const problem = platformsProblem(platforms, templatesDir);
  if (problem) errors.push(problem);
  for (const p of new Set(platforms)) {
    if (existsSync(join(dir, p))) errors.push(`apps/${name}/${p} already exists. A platform is only added once; change it like any other code`);
  }
  if (platforms.some((p) => p === "ios" || p === "android") && !isValidBundleId(m.bundle_id)) {
    errors.push(`idea.yaml needs a bundle_id (for example ${defaultBundleId(name)}) before ios or android is added`);
  }

  if (backend !== null && !BACKENDS.includes(backend)) errors.push(`backend must be one of ${BACKENDS.join(", ")}`);
  const backendAfter = backend !== null && BACKENDS.includes(backend) ? backend : m.backend;
  if (networkOf(m) === "none" && backendAfter !== "none") errors.push(offlineBackendProblem(backendAfter).replace("--network none", "this idea has network: none, which"));
  const stackDir = join(dir, "supabase");
  const hasStack = existsSync(join(stackDir, "config.toml"));
  if (backendAfter !== "supabase" && m.backend === "supabase" && hasStack) {
    errors.push(`apps/${name} already has the supabase backend, and taking a backend away is not something this command does`);
  }
  // A supabase/ folder this command did not expect: stamping over it, or adopting it, would be a guess.
  if (backendAfter === "supabase" && existsSync(stackDir) && !(m.backend === "supabase" && hasStack)) {
    errors.push(`apps/${name}/supabase is already there, but ${hasStack ? `idea.yaml says backend: ${m.backend}` : "it has no config.toml"}. Move it away first`);
  }
  if (backendAfter === "supabase" && !existsSync(join(templatesDir, "supabase"))) errors.push("templates/supabase/ is missing");

  const stage = m.stage === "spark" && platforms.length > 0 ? "prototype" : m.stage;
  // A spark may list platforms it does not have yet. Past spark, every listed platform needs its folder.
  const unbuilt = m.platforms.filter((p) => !platforms.includes(p) && !existsSync(join(dir, p)));
  if (stage !== "spark" && unbuilt.length > 0) {
    errors.push(`idea.yaml already lists ${unbuilt.join(", ")}, which apps/${name} does not have yet. Add everything in one go: --platforms ${[...unbuilt, ...platforms].join(",")}`);
  }
  const createStack = backendAfter === "supabase" && stage !== "spark" && !hasStack;
  if (errors.length === 0 && platforms.length === 0 && backendAfter === m.backend && !createStack) {
    errors.push(
      `nothing to add: apps/${name} has ${m.platforms.join(", ") || "no platforms"} and backend ${m.backend}. Name what is new with --platforms and/or --backend`,
    );
  }
  if ((platforms.length > 0 || createStack) && !titleIsInert(m.title)) errors.push(`${TITLE_RULE} (it is written into source files). Change it in idea.yaml first`);

  // The platforms it already has get the backend's files when the backend arrives.
  const existing = m.platforms.filter((p) => !platforms.includes(p) && existsSync(join(dir, p)));
  const overlaid = createStack ? existing.filter((p) => overlayOf(p, backendAfter, templatesDir) !== null) : [];
  const slot = createStack ? freePortSlot(appsDir) : null;
  const apiPort = createStack ? slotApiPort(slot) : backendAfter === "supabase" ? ideaApiPort(dir) : null;
  if (backendAfter === "supabase" && hasStack && apiPort === null && platforms.length > 0) {
    errors.push(`apps/${name}/supabase/config.toml has no API port ([api] port), which the new platform needs`);
  }
  if (errors.length > 0) return { errors };

  const tokens = buildTokens({ name, title: m.title, owner: m.owner, bundleId: m.bundle_id ?? defaultBundleId(name), apiPort: apiPort ?? BASE_API_PORT, timestamp });
  const replaced = overlaid.flatMap((p) => overlayConflicts(dir, p, backendAfter, tokens, templatesDir).map((f) => join(p, f)));
  if (replaced.length > 0 && !force) {
    return {
      errors: [
        `the ${backendAfter} backend replaces these files, and they were edited since the template wrote them:`,
        ...replaced.map((f) => `  - apps/${name}/${f}`),
        "Commit your work, run again with --force, then put your edits back (git diff shows them)",
      ],
    };
  }

  const after = { stage, platforms: [...m.platforms, ...platforms.filter((p) => !m.platforms.includes(p))], backend: backendAfter };
  const changes = Object.fromEntries(Object.entries(after).filter(([key, value]) => !isDeepStrictEqual(m[key], value)));
  const manifestFile = join(dir, "idea.yaml");
  let manifest = null;
  if (Object.keys(changes).length > 0) {
    try {
      manifest = updateManifestText(readFileSync(manifestFile, "utf8"), changes);
    } catch (e) {
      return { errors: [e.message] };
    }
  }

  return {
    errors: [],
    name,
    dir,
    before: { stage: m.stage, platforms: m.platforms, backend: m.backend },
    after,
    platforms, // stamped out now
    overlaid, // platforms it already had, which get the backend's files now
    replaced, // edited files the overlay writes over (only with force)
    createStack,
    slot,
    apiPort, // of the idea's local stack, new or not; null without one
    // The stack was here before, and its schema has moved on from the template's.
    schemaIsOlder: hasStack && backendAfter === "supabase" && !schemaIsTemplates(dir, tokens, templatesDir),
    tokens,
    manifestFile,
    manifest, // idea.yaml afterwards, or null when it does not change
    appsDir,
    templatesDir,
  };
}

/** Carries out a plan from planGrowth. @returns the idea's validation errors afterwards (none is success). */
export function applyGrowth(plan) {
  const { dir, tokens, templatesDir } = plan;
  for (const p of plan.platforms) stampPlatform(dir, p, plan.after.backend, tokens, templatesDir);
  for (const p of plan.overlaid) applyOverlay(dir, p, plan.after.backend, tokens, templatesDir);
  if (plan.createStack) stampSupabase(dir, tokens, plan.slot, templatesDir);
  if (plan.manifest !== null) writeFileSync(plan.manifestFile, plan.manifest);
  return loadIdea(plan.name, plan.appsDir).errors;
}

// ---- what to do next -----------------------------------------------------------

/**
 * The numbered "Next:" steps both commands print.
 * @param stamped     platforms whose folder was just created
 * @param backendFor  platforms that just received backend files (they need the local key)
 * @param apiPort     the idea's local stack, when the steps involve it; null otherwise
 * @param intro       a new idea: start with idea.md and the first spec
 * @param schemaIsOlder  the idea's schema is no longer the template's, which the new platforms' types are for
 */
export function nextSteps({ name, stamped, backendFor = [], apiPort = null, intro = false, schemaIsOlder = false }) {
  const lines = [];
  const step = (text) => lines.push(`  ${lines.length + 1}. ${text}`);
  const app = `apps/${name}`;
  const key = `# then paste the key from: pnpm sb ${name} status`;

  if (intro) {
    step(`Fill in ${app}/idea.md (problem, hypothesis, success metric, kill criteria)`);
    step(`Specify the first feature before building it: in Claude, from ${app}, /speckit-specify <what and why>`);
  }
  if (stamped.includes("web") || backendFor.includes("web")) step("pnpm install");
  if (apiPort !== null) step(`pnpm sb ${name} start            # local Supabase (needs Docker; ports ${apiPort - 1}-${apiPort + 8})`);
  if (schemaIsOlder && stamped.some((p) => TYPE_TARGETS[p])) {
    step(`pnpm types ${name}            # this idea's schema is no longer the template's, which the new platform's types are for`);
  }
  if (schemaIsOlder && stamped.includes("android")) {
    step(`Update ${app}/android/backend/src/main/kotlin/to/labs/idea/backend/Models.kt by hand to match this idea's schema`);
  }
  if (backendFor.includes("web")) step(`cp ${app}/web/.env.example ${app}/web/.env.local   # then paste keys from: pnpm sb ${name} status`);
  if (stamped.includes("web")) step(`pnpm --filter @labs/${name}-web dev`);
  if (backendFor.includes("ios")) step(`cp ${app}/ios/Config/Local.xcconfig.example ${app}/ios/Config/Local.xcconfig   ${key}`);
  if (stamped.includes("ios") || backendFor.includes("ios")) {
    step(`pnpm ios ${name}                 # generates the Xcode project from project.yml and opens it (needs: brew install xcodegen)`);
  }
  if (backendFor.includes("android")) step(`cp ${app}/android/local.properties.example ${app}/android/local.properties   ${key}`);
  if (stamped.includes("android")) step(`open ${app}/android in Android Studio   # or: cd ${app}/android && ./gradlew assembleDebug`);
  lines.push("  ->  Commit on a branch. Verify locally before pushing.");
  return lines;
}
