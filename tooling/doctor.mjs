#!/usr/bin/env node
// pnpm doctor: is this machine ready to test ideas and land them, and what is missing?
//
//   pnpm doctor                 tools, .env.labs, and what each landing target still needs
//   pnpm doctor --for ios|web   also exit 1 unless releases for that platform are fully set up
//   pnpm doctor --init          create .env.labs from .env.example (mode 600), then check
//
// Read-only apart from --init, and it never builds anything. It prints names and
// states, never the value of a secret.

import { chmodSync, copyFileSync, existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { activeManifests, needs, teamStatus } from "./lib/doctor.mjs";
import { ENV_EXAMPLE, ENV_FILE, ENV_SPEC, loadLocalEnv } from "./lib/env.mjs";
import { run } from "./lib/exec.mjs";
import { androidPreflight } from "./lib/android.mjs";
import { iosPreflight } from "./lib/ios.mjs";
import { credentialProblems } from "./lib/ios-release.mjs";
import { credentialProblems as webCredentialProblems } from "./lib/web-release.mjs";
import { loadIdeas } from "./lib/manifest.mjs";
import { cliVersion as specKitCliVersion, kitVersion } from "./lib/speckit.mjs";
import { cliInstalled, dockerUp } from "./lib/supabase.mjs";

const TARGETS = ["ios", "web"];
const USAGE = `usage: pnpm doctor [--for ${TARGETS.join("|")}] [--init]`;

const { values } = parseArgs({ options: { for: { type: "string", multiple: true }, init: { type: "boolean" }, help: { type: "boolean", short: "h" } } });
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
const forTargets = values.for ?? [];
for (const t of forTargets) {
  if (!TARGETS.includes(t)) {
    console.error(`unknown target "${t}".\n${USAGE}`);
    process.exit(2);
  }
}

if (values.init) {
  if (existsSync(ENV_FILE)) console.log(".env.labs already exists, left as it is.\n");
  else {
    copyFileSync(ENV_EXAMPLE, ENV_FILE);
    chmodSync(ENV_FILE, 0o600);
    console.log("Created .env.labs (mode 600) from .env.example. Open it and fill in what you need.\n");
  }
}

const envFile = loadLocalEnv();
const ideas = loadIdeas();
const manifests = activeManifests(ideas);
const need = needs(manifests, forTargets);

let failures = 0;
const row = (status, label, note = "") => console.log(`  ${status.padEnd(8)} ${label.padEnd(24)} ${note}`.trimEnd());
const indent = (text) => text.split("\n").map((l) => `${" ".repeat(35)}${l}`).join("\n");
const firstLine = (text) => text.trim().split("\n")[0] ?? "";

// ---- tools -----------------------------------------------------------------------------
console.log("tools");
const nodeMajor = Number(process.versions.node.split(".")[0]);
const tools = [
  { name: "node", need: true, probe: () => ({ ok: nodeMajor >= 22, note: `v${process.versions.node}`, fix: "install Node 22 or newer (.node-version has the one CI uses)" }) },
  {
    name: "pnpm",
    need: true,
    probe: () => {
      const r = run("pnpm", ["--version"]);
      return { ok: r.ok, note: r.stdout.trim(), fix: "enable it with: corepack enable" };
    },
  },
  {
    name: "git hooks",
    need: true,
    probe: () => {
      const r = run("git", ["config", "core.hooksPath"]);
      return { ok: r.stdout.trim() === ".githooks", note: "pre-commit scan, pre-push stamp", fix: "install them with: pnpm install" };
    },
  },
  {
    name: "spec kit",
    need: true,
    probe: () => {
      // The kit every idea gets is vendored; the CLI is only needed to regenerate it.
      const kit = kitVersion();
      const cli = specKitCliVersion();
      const cliNote = cli === null ? "specify CLI not installed (only needed to refresh the template)" : cli === kit ? "same as the specify CLI" : `specify CLI is ${cli}`;
      return { ok: kit !== null, note: `kit ${kit}, in every idea; ${cliNote}`, fix: "templates/speckit/kit is missing: restore it from git, or pnpm speckit --refresh-template" };
    },
  },
  { name: "supabase cli", need: need.supabase, probe: () => ({ ok: cliInstalled(), note: "pinned, in node_modules", fix: "install it with: pnpm install" }) },
  { name: "docker", need: need.supabase, probe: () => ({ ok: dockerUp(), note: "runs the local Supabase stack", fix: "start Docker Desktop (or OrbStack, Colima)" }) },
  {
    name: "ios toolchain",
    need: need.ios,
    probe: () => {
      const r = iosPreflight();
      return { ok: r.ok, note: "Xcode, XcodeGen, swift-format", fix: r.out };
    },
  },
  {
    name: "android toolchain",
    need: need.android,
    probe: () => {
      const r = androidPreflight();
      return { ok: r.ok, note: "JDK, Android SDK", fix: r.out };
    },
  },
  {
    name: "gh",
    need: "optional",
    probe: () => {
      const r = run("gh", ["--version"]);
      return { ok: r.ok, note: firstLine(r.stdout), fix: "brew install gh, to open PRs and read Actions runs" };
    },
  },
  {
    name: "vercel cli",
    need: forTargets.includes("web") ? true : "optional",
    probe: () => {
      const r = run("vercel", ["--version"]);
      return { ok: r.ok, note: firstLine(r.stdout), fix: "npm install --global vercel, to release web apps" };
    },
  },
  {
    name: "op (1Password)",
    need: "optional",
    probe: () => {
      const r = run("op", ["--version"]);
      return { ok: r.ok, note: r.stdout.trim(), fix: "brew install 1password-cli, only if you use an op:// reference" };
    },
  },
  {
    name: "git remote origin",
    need: "optional",
    probe: () => {
      const r = run("git", ["remote", "get-url", "origin"]);
      return { ok: r.ok, note: r.stdout.trim().replace(/^https:\/\/[^@/]+@/, "https://"), fix: "a release needs the commit on origin/main: git remote add origin <url>" };
    },
  },
];

for (const t of tools) {
  const r = t.probe();
  if (r.ok) row("ok", t.name, r.note);
  else if (t.need === true) {
    failures++;
    row("MISSING", t.name, firstLine(r.fix));
    if (r.fix.includes("\n")) console.log(indent(r.fix.split("\n").slice(1).join("\n")));
  } else row(t.need === "optional" ? "warn" : "--", t.name, `${t.need === "optional" ? "optional. " : "not needed yet. "}${firstLine(r.fix)}`);
}

// ---- .env.labs -----------------------------------------------------------------------------
console.log("\n.env.labs (this machine's release settings; git-ignored)");
if (!envFile.exists) row("--", "not created", "pnpm doctor --init creates it from .env.example");
else {
  const filled = envFile.loaded.length + envFile.shadowed.length;
  const note =
    filled === 0
      ? "nothing filled in yet"
      : `${filled} value${filled === 1 ? "" : "s"} set${envFile.shadowed.length > 0 ? `, ${envFile.shadowed.length} overridden by your environment` : ""}`;
  row("ok", "found", note);
  for (const p of envFile.problems) row("warn", "", p);
}

// ---- landing targets ---------------------------------------------------------------------------
console.log("\nwhere ideas can land");

const sourceOf = (key) => (envFile.loaded.includes(key) ? ".env.labs" : process.env[key] ? "environment" : null);
const sourcesOf = (target) => [...new Set(ENV_SPEC.filter((s) => s.target === target).map((s) => sourceOf(s.key)).filter(Boolean))].join(" and ");

/** One line per landing target; the reasons underneath when it is not ready. */
function landing({ target, label, problems, readyNote, command }) {
  if (problems.length === 0) return row("ready", label, readyNote);
  if (forTargets.includes(target)) failures++;
  row(forTargets.includes(target) ? "MISSING" : "todo", label, command);
  for (const p of problems) console.log(`${" ".repeat(11)}- ${p}`);
  return undefined;
}

const iosIdeas = manifests.filter((m) => m.platforms.includes("ios")).map((m) => m.name);
const iosProblems = credentialProblems();
const team = teamStatus({ env: process.env, iosIdeas });
if (!team.ok) iosProblems.push(team.note);
const webProblems = webCredentialProblems();
const allReady = iosProblems.length === 0 && webProblems.length === 0;

landing({ target: "ios", label: "ios / TestFlight", problems: iosProblems, command: "pnpm release <idea> ios", readyNote: `credentials from ${sourcesOf("ios") || "~/.appstoreconnect"}, team via ${team.note}` });
landing({ target: "web", label: "web / Vercel", problems: webProblems, command: "pnpm release <idea> web", readyNote: `token from ${sourcesOf("web") || "the environment"}` });
row("--", "android", "not built yet (Google Play)");
row("--", "hosted Supabase", "not built yet");

// ---- verdict ------------------------------------------------------------------------------------
console.log("");
if (failures > 0) {
  console.error(`doctor: ${failures} thing${failures === 1 ? "" : "s"} to fix (MISSING above), then run pnpm doctor again`);
  process.exit(1);
}
const hint = envFile.exists ? "fill in .env.labs, then run pnpm doctor --for ios (or web)" : "run pnpm doctor --init, fill in .env.labs, then pnpm doctor --for ios (or web)";
console.log(`doctor: OK${allReady ? "" : ` (releases are not all set up yet: ${hint})`}`);
console.log("next: pnpm verify <idea>, then pnpm release <idea> <ios|web> --dry-run");
