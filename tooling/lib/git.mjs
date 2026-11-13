// Git helpers: change detection and the "verified" stamp.
//
// A stamp records that `pnpm verify` passed for one exact tree of files. The key
// is the git tree hash, so it survives committing, amending and cherry-picking
// (same content, same hash) and is invalidated by any content change, including
// a rebase that pulls in someone else's work. Stamps live in .git, shared by
// every worktree, and never leave the machine.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./exec.mjs";
import { ROOT } from "./manifest.mjs";

const git = (args, opts = {}) => run("git", args, { cwd: ROOT, ...opts });

export function isGitRepo() {
  return git(["rev-parse", "--git-dir"]).ok;
}

/**
 * Tree hash of everything that would be committed right now: tracked and
 * untracked files, minus ignored ones. Built in a throwaway index so the real
 * index and working tree are never touched.
 */
export function worktreeTree() {
  const dir = mkdtempSync(join(tmpdir(), "labs-index-"));
  try {
    const env = { GIT_INDEX_FILE: join(dir, "index") };
    const add = git(["add", "-A"], { env });
    if (!add.ok) throw new Error(`git add failed: ${add.out}`);
    const tree = git(["write-tree"], { env });
    if (!tree.ok) throw new Error(`git write-tree failed: ${tree.out}`);
    return tree.stdout.trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Tree hash of a commit (or of a tree hash itself); null if unknown. */
export function treeOf(ref) {
  const r = git(["rev-parse", "--verify", "--quiet", `${ref}^{tree}`]);
  return r.ok ? r.stdout.trim() : null;
}

function stampDir() {
  const r = git(["rev-parse", "--git-common-dir"]);
  if (!r.ok) throw new Error("not a git repository");
  return join(resolve(ROOT, r.stdout.trim()), "labs-verified");
}

export function writeStamp(tree, info) {
  mkdirSync(stampDir(), { recursive: true });
  writeFileSync(join(stampDir(), tree), `${JSON.stringify({ tree, at: new Date().toISOString(), ...info }, null, 2)}\n`);
}

export function readStamp(tree) {
  try {
    return JSON.parse(readFileSync(join(stampDir(), tree), "utf8"));
  } catch {
    return null;
  }
}

/**
 * What to diff against by default: the point where this work diverged from
 * origin/main (or from local main when on a feature branch). Null means "no
 * reliable base", and callers should verify everything.
 */
export function defaultBase() {
  const head = git(["rev-parse", "--verify", "--quiet", "HEAD"]);
  if (!head.ok) return null; // no commits yet
  const refs = ["origin/main"];
  const main = git(["rev-parse", "--verify", "--quiet", "main"]);
  if (main.ok && main.stdout.trim() !== head.stdout.trim()) refs.push("main");
  for (const ref of refs) {
    const mb = git(["merge-base", "HEAD", ref]);
    if (mb.ok) return mb.stdout.trim();
  }
  return null;
}

/** Files that differ from `base`: committed, staged, unstaged and untracked (not ignored). */
export function changedFiles(base) {
  const tracked = git(["diff", "--name-only", base]);
  if (!tracked.ok) throw new Error(tracked.out.trim());
  const untracked = git(["ls-files", "-o", "--exclude-standard"]);
  return [...new Set([...tracked.stdout.split("\n"), ...untracked.stdout.split("\n")].filter(Boolean))];
}
