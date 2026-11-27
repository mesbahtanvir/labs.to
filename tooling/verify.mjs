#!/usr/bin/env node
// pnpm verify: the local quality gate. Run it before pushing, and let CI run it
// again in a clean checkout only for ideas that are live.
//
//   pnpm verify                  what changed since origin/main (or everything, if unsure)
//   pnpm verify <idea> [...]     exactly these ideas
//   pnpm verify --all            everything
//   pnpm verify --base <ref>     what changed since <ref>
//   pnpm verify --only web,supabase   restrict the kinds of checks (offline = the no-network guard of a `network: none` idea)
//   pnpm verify --keep           leave the throwaway Supabase stack, the verify simulator and emulator running
//   pnpm verify --cleanup        stop leftover throwaway stacks, the verify simulator and emulator
//
// On success of a full-scope run, it stamps the exact tree of files as verified;
// the pre-push hook (and, later, `pnpm release`) refuse content without a stamp.
//
// Every check is a plain script, no LLM involved: a failing step prints the end
// of its output, and that is the only point where a human or Claude is needed.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { defaultBase, isGitRepo, readStamp, treeOf, worktreeTree, writeStamp } from "./lib/git.mjs";
import { APPS_DIR, ROOT, TYPE_TARGETS, loadIdea, loadIdeas, networkOf } from "./lib/manifest.mjs";
import { mergedManifestViolations, offlineViolations } from "./lib/offline.mjs";
import { run } from "./lib/exec.mjs";
import { bootVerifySimulator, generateProject, iosPreflight, lintSwift, shutdownVerifySimulators, xcodebuild } from "./lib/ios.mjs";
import { androidPreflight, bootVerifyEmulator, gradle, shutdownVerifyEmulator } from "./lib/android.mjs";
import { LOCK_ROOT } from "./lib/cache.mjs";
import { acquireLock } from "./lib/lock.mjs";
import { computePlan } from "./lib/plan.mjs";
import { findSecrets, listFiles } from "./lib/secrets.mjs";
import { cliInstalled, dockerUp, prepareVerifyStack, sb, startStack, stopStack, verifyStackRunning } from "./lib/supabase.mjs";
import { generateTypes } from "./lib/types.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    all: { type: "boolean" },
    base: { type: "string" },
    only: { type: "string" },
    keep: { type: "boolean" },
    cleanup: { type: "boolean" },
    "no-stamp": { type: "boolean" },
    "check-stamp": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(`usage: pnpm verify [idea...] [--all] [--base <ref>] [--only web,ios,android,supabase,offline] [--keep] [--cleanup] [--no-stamp]
       pnpm verify --check-stamp <commit|tree>   (used by the pre-push hook)`);
  process.exit(0);
}

const isRepo = isGitRepo();
const fmt = (ms) => `${(ms / 1000).toFixed(1)}s`;

// ---- stamp check (pre-push hook) -------------------------------------------
if (values["check-stamp"] !== undefined) {
  const ref = values["check-stamp"];
  const tree = isRepo ? treeOf(ref) : null;
  const stamp = tree ? readStamp(tree) : null;
  if (stamp) {
    console.log(`verified: ${ref.slice(0, 10)} (${stamp.scope}, ${stamp.at})`);
    process.exit(0);
  }
  console.error(`No local verification found for ${ref.slice(0, 10)}${tree ? ` (tree ${tree.slice(0, 10)})` : ""}.`);
  console.error("Run: pnpm verify   (then push again). To bypass deliberately: git push --no-verify");
  process.exit(1);
}

// ---- cleanup of leftover throwaway stacks -----------------------------------
if (values.cleanup) {
  let stopped = 0;
  for (const { dirName, manifest } of loadIdeas()) {
    if (manifest?.backend !== "supabase" || !verifyStackRunning(dirName)) continue;
    const stack = prepareVerifyStack(dirName);
    const r = stopStack(stack.workdir);
    stack.release();
    console.log(`${r.ok ? "stopped" : "FAILED to stop"} throwaway stack for ${dirName}`);
    if (r.ok) stopped++;
  }
  console.log(stopped === 0 ? "no leftover throwaway stacks" : `${stopped} stopped`);
  const sims = shutdownVerifySimulators();
  console.log(sims === 0 ? "no verify simulator running" : `${sims} verify simulator(s) shut down`);
  const emus = androidPreflight().ok ? shutdownVerifyEmulator() : 0;
  console.log(emus === 0 ? "no verify emulator running" : "verify emulator shut down");
  process.exit(0);
}

// ---- state for a verification run --------------------------------------------
const t0 = Date.now();
const results = [];
const failedUnits = new Set();
let currentUnit = null;

/** Runs one step, prints one line, and skips the rest of a unit after a failure. */
function step(unit, name, fn) {
  if (failedUnits.has(unit)) return false;
  if (unit !== currentUnit) {
    console.log(`\n${unit}`);
    currentUnit = unit;
  }
  process.stdout.write(`  ${name.padEnd(24)} `);
  const started = Date.now();
  let r;
  try {
    r = fn();
  } catch (e) {
    r = { ok: false, out: String(e?.message ?? e) };
  }
  const ms = Date.now() - started;
  results.push({ unit, name, ok: r.ok, ms });
  console.log(`${r.ok ? "ok  " : "FAIL"} ${fmt(ms)}${r.ok && r.note ? `  ${r.note}` : ""}`);
  if (!r.ok) {
    failedUnits.add(unit);
    const tail = (r.out ?? "").trimEnd().split("\n").slice(-30).map((l) => `      ${l}`).join("\n");
    if (tail.trim()) console.log(tail);
  }
  return r.ok;
}

function finish(treeBefore, scope) {
  const failed = failedUnits.size > 0;
  console.log(`\nverify: ${failed ? "FAIL" : "PASS"}  ${fmt(Date.now() - t0)}  (${results.length} steps${failed ? `; failed: ${[...failedUnits].join(", ")}` : ""})`);

  if (failed) process.exit(1);
  const fullScope = positionals.length === 0 && !values.only && !values.base && !values["no-stamp"];
  if (!fullScope) {
    console.log("stamp: not written (partial scope or --no-stamp)");
  } else if (!isRepo) {
    console.log("stamp: not written (not a git repository)");
  } else if (worktreeTree() !== treeBefore) {
    console.log("stamp: not written (files changed while verifying; run again)");
  } else {
    writeStamp(treeBefore, { scope, steps: results.length, ms: Date.now() - t0 });
    console.log(`stamp: written for tree ${treeBefore.slice(0, 10)}`);
  }
  process.exit(0);
}

// ---- the run -----------------------------------------------------------------
const known = new Set(loadIdeas().map((i) => i.dirName));
for (const name of positionals) {
  if (!known.has(name)) {
    console.error(`unknown idea "${name}". Known: ${[...known].join(", ") || "(none)"}`);
    process.exit(2);
  }
}

const base = values.all ? null : (values.base ?? (isRepo ? defaultBase() : null));
const treeBefore = isRepo ? worktreeTree() : null;
const scope = positionals.length > 0 ? `ideas: ${positionals.join(", ")}` : base ? `changes since ${base.slice(0, 10)}` : "everything";
console.log(`verify: ${scope}`);

step("workspace", "pnpm install (frozen)", () => run("pnpm", ["install", "--frozen-lockfile"], { cwd: ROOT }));
if (failedUnits.size > 0) finish(treeBefore, scope);

step("workspace", "manifests", () => {
  const bad = loadIdeas().filter((i) => i.errors.length > 0);
  return { ok: bad.length === 0, out: bad.map((i) => `apps/${i.dirName}:\n  - ${i.errors.join("\n  - ")}`).join("\n") };
});
step("workspace", "secrets", () => {
  const findings = findSecrets({ files: listFiles() });
  return { ok: findings.length === 0, out: findings.map((f) => `${f.file}${f.line ? `:${f.line}` : ""}  ${f.rule}`).join("\n") };
});
step("workspace", "tooling tests", () => run("pnpm", ["test"], { cwd: ROOT })); // version, tag and release-settings logic: seconds, no devices
if (failedUnits.size > 0) finish(treeBefore, scope);

const plan = computePlan({ base, only: positionals.length > 0 ? positionals : null });
if (plan.invalid) finish(treeBefore, scope); // already reported by the manifests step
if (plan.warning) console.log(`\nwarning: ${plan.warning}`);

const kinds = new Set(values.only ? values.only.split(",").map((s) => s.trim()) : ["offline", "supabase", "web", "ios", "android"]);
const forIdea = (kind, idea) => plan.result[kind].filter((e) => e.idea === idea);
const names = [...new Set(Object.values(plan.result).flatMap((entries) => entries.map((e) => e.idea)))].sort();

if (names.length === 0) console.log("\nnothing affected: no active idea is touched by this change");

for (const idea of names) {
  if (kinds.has("offline")) verifyOffline(idea);
  if (kinds.has("supabase")) for (const e of forIdea("supabase", idea)) verifySupabase(e);
  if (kinds.has("web")) for (const e of forIdea("web", idea)) verifyWeb(e);
  if (kinds.has("ios")) for (const e of forIdea("ios", idea)) verifyIos(e);
  if (kinds.has("android")) for (const e of forIdea("android", idea)) verifyAndroid(e);
}
finish(treeBefore, scope);

// ---- units -------------------------------------------------------------------
function verifyWeb({ idea, path }) {
  const unit = `${idea}/web`;
  const dir = join(ROOT, path);
  const scripts = existsSync(join(dir, "package.json")) ? (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).scripts ?? {}) : {};
  for (const script of ["typecheck", "lint", "test", "build"]) {
    if (!scripts[script]) continue;
    step(unit, script, () => run("pnpm", ["run", script], { cwd: dir }));
  }
}

function verifyIos({ idea, path }) {
  const unit = `${idea}/ios`;
  const dir = join(ROOT, path);
  const pre = iosPreflight();
  if (!pre.ok) return void step(unit, "toolchain", () => pre);

  step(unit, "xcodegen", () => generateProject(dir));
  step(unit, "swift-format", () => lintSwift(dir));

  // One verify simulator exists for the whole machine, so verifies take turns on it.
  let release = null;
  let sim = null;
  try {
    step(unit, "boot simulator", () => {
      release = acquireLock(LOCK_ROOT, "ios-simulator"); // throws if another verify holds it
      sim = bootVerifySimulator();
      return sim;
    });
    step(unit, "build", () => xcodebuild({ idea, dir, udid: sim.udid, action: "build-for-testing" }));
    step(unit, "unit + ui tests", () => xcodebuild({ idea, dir, udid: sim.udid, action: "test-without-building" }));
  } finally {
    if (sim?.ok && !values.keep) shutdownVerifySimulators();
    release?.();
  }
}

function verifyAndroid({ idea, path }) {
  const unit = `${idea}/android`;
  const dir = join(ROOT, path);
  const pre = androidPreflight();
  if (!pre.ok) return void step(unit, "toolchain", () => pre);

  // Cheapest first. The first run downloads Gradle and the libraries, so it is slower.
  step(unit, "kotlin format", () => gradle({ dir, tasks: ["lintKotlin"] }));
  step(unit, "unit tests", () => gradle({ dir, tasks: ["testDebugUnitTest"] }));
  step(unit, "android lint", () => gradle({ dir, tasks: ["lintDebug"] }));
  step(unit, "build", () => gradle({ dir, tasks: ["assembleDebug", "assembleDebugAndroidTest"] }));
  if (networkOf(loadIdea(idea).manifest) === "none") step(unit, "no network permission", () => verifyMergedManifest(dir));

  // One verify emulator exists for the whole machine, so verifies take turns on it.
  let release = null;
  let emulator = null;
  try {
    step(unit, "boot emulator", () => {
      release = acquireLock(LOCK_ROOT, "android-emulator"); // throws if another verify holds it
      emulator = bootVerifyEmulator();
      return emulator;
    });
    step(unit, "instrumented tests", () => gradle({ dir, tasks: ["connectedDebugAndroidTest"], serial: emulator.serial }));
  } finally {
    if (emulator?.ok && !values.keep) shutdownVerifyEmulator();
    release?.();
  }
}

// An idea with `network: none` makes no network call at all. The source scan is cheap, so it
// runs first; Android's merged manifest (what libraries add too) is checked after its build.
function verifyOffline(idea) {
  const { dir, manifest } = loadIdea(idea);
  if (networkOf(manifest) !== "none") return;
  step(`${idea}/offline`, "no network", () => {
    const found = offlineViolations(dir, manifest);
    return { ok: found.length === 0, out: found.map((f) => `${f.file}${f.line ? `:${f.line}` : ""}  ${f.rule}`).join("\n") };
  });
}

function verifyMergedManifest(androidDir) {
  const { found, violations } = mergedManifestViolations(androidDir);
  if (found === 0) return { ok: false, out: "no merged manifest found under app/build/intermediates; the build output is not where tooling/lib/offline.mjs looks" };
  return { ok: violations.length === 0, out: violations.map((v) => `${v.file}  ${v.rule}`).join("\n") };
}

function verifySupabase({ idea }) {
  const unit = `${idea}/supabase`;
  if (!cliInstalled()) return void step(unit, "supabase cli", () => ({ ok: false, out: "The pinned Supabase CLI is not installed. Run: pnpm install" }));
  if (!dockerUp()) return void step(unit, "docker", () => ({ ok: false, out: "Docker is not running. Start Docker Desktop, then run verify again." }));

  let stack;
  try {
    stack = prepareVerifyStack(idea);
  } catch (e) {
    return void step(unit, "throwaway stack", () => ({ ok: false, out: e.message }));
  }
  try {
    if (!verifyStackRunning(idea)) step(unit, "start throwaway stack", () => startStack(stack.workdir));
    step(unit, "db reset (from scratch)", () => sb(stack.workdir, ["db", "reset"]));
    step(unit, "db tests (pgTAP)", () => sb(stack.workdir, ["test", "db"]));
    step(unit, "db lint", () => sb(stack.workdir, ["db", "lint", "--level", "error"]));

    const manifest = loadIdea(idea).manifest;
    if (manifest.platforms.some((p) => TYPE_TARGETS[p])) {
      step(unit, "client types up to date", () => {
        const r = generateTypes({ idea, manifest, workdir: stack.workdir, check: true });
        return { ok: r.ok && r.stale === 0, out: r.messages.join("\n") };
      });
    }
  } finally {
    if (!values.keep) stopStack(stack.workdir);
    stack.release();
  }
}
