// Spec Kit (github/spec-kit) in every idea.
//
// templates/speckit/kit/ is the unedited output of `specify init`: the scripts, the
// templates, the workflow and the speckit-* skills for Claude. `pnpm new` copies it into
// apps/<idea>/, so every idea is its own Spec Kit project, with its own constitution
// (.specify/memory/) and its own specs (specs/).
//
// The kit is vendored, like templates/supabase/config.toml, so that creating an idea
// needs no network, no Python and no CLI. It is regenerated, never edited:
// `pnpm speckit --refresh-template` runs the `specify` installed on this machine.

import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { run } from "./exec.mjs";
import { SPECKIT_CONSTITUTION, TEMPLATES_DIR, constitutionIsTemplate } from "./manifest.mjs";

export const SPECKIT_DIR = join(TEMPLATES_DIR, "speckit");
export const KIT_DIR = join(SPECKIT_DIR, "kit");
export const CONSTITUTION_TEMPLATE = join(SPECKIT_DIR, "constitution.md");

// The idea's own part of a Spec Kit project. The kit never writes here: an idea keeps
// its constitution across a refresh, and starts from ours rather than from placeholders.
const OWN_PREFIX = ".specify/memory/";
// Where kit files live. A stale file is only ever removed from inside these, whatever a manifest says.
const KIT_AREAS = /^(\.specify\/(scripts|templates|workflows|integrations)\/|\.claude\/skills\/speckit-)/;
const MANIFESTS_DIR = ".specify/integrations";
const INIT_ARGS = ["init", "--here", "--force", "--non-interactive", "--integration", "claude", "--script", "sh", "--ignore-agent-tools"];

export const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** Every file under `root`, as sorted posix paths relative to it. */
export function listTree(root) {
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const path = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) walk(path);
      else out.push(path);
    }
  };
  if (existsSync(root)) walk("");
  return out.sort();
}

/** The Spec Kit version the vendored kit came from. */
export function kitVersion(root = KIT_DIR) {
  try {
    return JSON.parse(readFileSync(join(root, ".specify", "init-options.json"), "utf8")).speckit_version ?? null;
  } catch {
    return null;
  }
}

/** Files Spec Kit itself recorded as installed (path -> sha256), from the manifests under `root`. */
export function manifestFiles(root) {
  const dir = join(root, MANIFESTS_DIR);
  const files = {};
  if (!existsSync(dir)) return files;
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".manifest.json"))) {
    try {
      Object.assign(files, JSON.parse(readFileSync(join(dir, f), "utf8")).files ?? {});
    } catch {
      // An unreadable manifest lists nothing; the copy below still replaces every kit file.
    }
  }
  return files;
}

// The ratification date, as the person creating the idea reads their calendar (local time).
const today = () => {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
};

/**
 * Makes `dir` a Spec Kit project, or brings its kit up to date. Kit files are replaced
 * (and ones the kit dropped are removed); the constitution and specs/ are the idea's own
 * and are left alone, except that a missing or still-placeholder constitution is written
 * from templates/speckit/constitution.md.
 * @returns {{ version: string | null, constitution: "written" | "kept", removed: string[] }}
 */
export function installSpecKit(dir, { name, title, date = today(), kit = KIT_DIR } = {}) {
  const kitFiles = listTree(kit).filter((f) => !f.startsWith(OWN_PREFIX));
  if (kitFiles.length === 0) throw new Error(`the Spec Kit template is missing (${kit}). Run: pnpm speckit --refresh-template`);

  const before = Object.keys(manifestFiles(dir));
  for (const f of kitFiles) {
    const to = join(dir, f);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(kit, f), to);
    chmodSync(to, statSync(join(kit, f)).mode);
  }
  const removed = before.filter((f) => KIT_AREAS.test(f) && !f.includes("..") && !kitFiles.includes(f) && existsSync(join(dir, f)));
  for (const f of removed) rmSync(join(dir, f));

  const constitution = join(dir, SPECKIT_CONSTITUTION);
  const write = !existsSync(constitution) || constitutionIsTemplate(readFileSync(constitution, "utf8"));
  if (write) {
    const tokens = { name, title, date };
    mkdirSync(dirname(constitution), { recursive: true });
    writeFileSync(constitution, readFileSync(CONSTITUTION_TEMPLATE, "utf8").replace(/\{\{(\w+)\}\}/g, (whole, key) => tokens[key] ?? whole));
  }
  return { version: kitVersion(kit), constitution: write ? "written" : "kept", removed };
}

/** The installed Spec Kit CLI's version, or null when there is none. */
export function cliVersion(specify = "specify") {
  const r = run(specify, ["--version"]);
  return r.ok ? (/(\d+\.\d+\.\d+\S*)/.exec(r.stdout)?.[1] ?? null) : null;
}

/** Regenerates templates/speckit/kit/ with the `specify` on this machine. Nothing is downloaded. */
export function refreshKit({ specify = "specify", kit = KIT_DIR } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "labs-speckit-"));
  try {
    const r = run(specify, INIT_ARGS, { cwd: tmp, env: { NO_COLOR: "1" } });
    if (!r.ok) return { ok: false, out: r.status === null ? "the Spec Kit CLI (specify) is not installed. See the Decisions in README.md" : r.out };
    if (kitVersion(tmp) === null) return { ok: false, out: "specify init did not produce .specify/init-options.json" };
    rmSync(join(tmp, ".git"), { recursive: true, force: true });
    rmSync(kit, { recursive: true, force: true });
    cpSync(tmp, kit, { recursive: true });
    return { ok: true, version: kitVersion(kit), files: listTree(kit).length };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
