// What every release has in common, whatever the platform: versions, tags, and the
// checks that must pass before anything leaves this machine.
//
// The tag is the version. A release of <idea> for <platform> is the annotated git tag
//
//   <idea>/<platform>/vX.Y.Z        e.g. notes/ios/v0.2.1
//
// and the next version is computed from the highest existing tag, so there is no
// version file to edit and no "bump version" commit that would invalidate the
// verify stamp. The build number is the commit count, which only ever grows.

import { run } from "./exec.mjs";
import { readStamp, treeOf, worktreeTree } from "./git.mjs";
import { RELEASE_STAGES, ROOT } from "./manifest.mjs";

const git = (args, opts = {}) => run("git", args, { cwd: ROOT, ...opts });

// Hosts that only mean something on a developer's machine or LAN.
const LOCAL_HOST_RE = /^(localhost|127\.|0\.0\.0\.0|10\.0\.2\.2|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|.*\.(local|test|localhost)$)/i;

/**
 * Is this the address of a hosted backend? Null when it is an https URL on the public
 * internet, otherwise why not, so each platform can word the message for its own config file.
 * @returns {null | { kind: "empty" } | { kind: "not-https", url: string } | { kind: "local", host: string }}
 */
export function hostedUrlProblem(url) {
  const text = String(url ?? "").trim();
  if (text === "") return { kind: "empty" };
  let host = null;
  try {
    const u = new URL(text);
    host = u.protocol === "https:" ? u.hostname : null;
  } catch {
    /* falls through to not-https */
  }
  if (host === null) return { kind: "not-https", url: text };
  return LOCAL_HOST_RE.test(host) ? { kind: "local", host } : null;
}

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const BUMPS = ["patch", "minor", "major"];
export const FIRST_VERSION = "0.1.0";

/** "1.2.3" -> [1, 2, 3]; null for anything else (no prereleases, no "v" prefix). */
export function parseVersion(text) {
  const m = SEMVER_RE.exec(String(text));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a, b) {
  const [pa, pb] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

export function bumpVersion(version, kind) {
  const [major, minor, patch] = parseVersion(version);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export const tagFor = (idea, platform, version) => `${idea}/${platform}/v${version}`;

const TAG_RE = /^([a-z][a-z0-9-]{1,38}[a-z0-9])\/(web|ios|android|supabase)\/v(\d+\.\d+\.\d+)$/;

/** The inverse of tagFor: "notes/ios/v0.2.1" -> { idea, platform, version }; null if it is not a release tag. */
export function parseTag(tag) {
  const m = TAG_RE.exec(String(tag));
  return m && parseVersion(m[3]) ? { idea: m[1], platform: m[2], version: m[3] } : null;
}

/** What `pnpm release` wrote into the tag's message: the build number, the stage and the tree. */
export function parseTagMessage(message) {
  const build = /\(build (\d+)\)/.exec(String(message).split("\n")[0])?.[1];
  return {
    build: build ? Number(build) : null,
    stage: /^stage: (\S+)$/m.exec(message)?.[1] ?? null,
    tree: /^tree: ([0-9a-f]{40})$/m.exec(message)?.[1] ?? null,
  };
}

/** The highest released version below `version`, or null for a first release. */
export function previousVersion(tags, idea, platform, version) {
  return versionsFromTags(tags, idea, platform).filter((v) => compareVersions(v, version) < 0).at(-1) ?? null;
}

/** The released versions among `tags`, oldest first. Tags that are not ours are ignored. */
export function versionsFromTags(tags, idea, platform) {
  const prefix = `${idea}/${platform}/v`;
  return tags
    .filter((t) => t.startsWith(prefix) && parseVersion(t.slice(prefix.length)))
    .map((t) => t.slice(prefix.length))
    .sort(compareVersions);
}

/** The highest released version of this idea on this platform, or null. */
export function latestVersion(idea, platform) {
  const r = git(["tag", "--list", `${idea}/${platform}/v*`]);
  if (!r.ok) throw new Error(`git tag failed: ${r.out.trim()}`);
  return versionsFromTags(r.stdout.split("\n").filter(Boolean), idea, platform).at(-1) ?? null;
}

/**
 * @param latest   the highest released version, or null for a first release
 * @param bump     "patch" (default), "minor" or "major"; ignored for a first release
 * @param explicit a version given with --version, which must be above `latest`
 * @returns {{ version: string } | { error: string }}
 */
export function nextVersion({ latest, bump = "patch", explicit = null }) {
  if (explicit !== null) {
    if (!parseVersion(explicit)) return { error: `--version must look like 1.2.3 (got ${JSON.stringify(explicit)})` };
    if (latest !== null && compareVersions(explicit, latest) <= 0) {
      return { error: `--version ${explicit} is not above the latest release, ${latest}` };
    }
    return { version: explicit };
  }
  if (!BUMPS.includes(bump)) return { error: `--bump must be one of ${BUMPS.join(", ")} (got ${JSON.stringify(bump)})` };
  return { version: latest === null ? FIRST_VERSION : bumpVersion(latest, bump) };
}

/** Monotonic across main, so a store never sees a build number go backwards. */
export function buildNumber() {
  const r = git(["rev-list", "--count", "HEAD"]);
  if (!r.ok) throw new Error(`git rev-list failed: ${r.out.trim()}`);
  return Number(r.stdout.trim());
}

/** Is there already a tag with this name on the remote? Needs the network. */
export function remoteTagExists(tag, remote = "origin") {
  const r = git(["ls-remote", "--tags", remote, `refs/tags/${tag}`], { timeoutMs: 60 * 1000 });
  if (!r.ok) return { ok: false, out: r.out.trim().split("\n").slice(-3).join("\n") };
  return { ok: true, exists: r.stdout.trim() !== "" };
}

/**
 * What stops this commit from being released. Each entry is one sentence a person
 * can act on. An empty list means the repository is in a releasable state.
 */
export function repoProblems({ tag, stage }) {
  const problems = [];

  if (!RELEASE_STAGES.includes(stage)) {
    problems.push(`stage is "${stage}", and only ${RELEASE_STAGES.join(" and ")} ideas are released. Promote it by editing stage in idea.yaml, in a commit`);
  }

  if (!git(["rev-parse", "--verify", "--quiet", "HEAD"]).ok) {
    problems.push("there are no commits yet");
    return problems;
  }

  const branch = git(["branch", "--show-current"]).stdout.trim();
  if (branch !== "main") problems.push(`releases are cut from main (you are on ${branch || "a detached HEAD"})`);

  const headTree = treeOf("HEAD");
  if (worktreeTree() !== headTree) {
    problems.push("there are uncommitted or untracked changes. Commit them, run pnpm verify, and push");
  }
  if (!readStamp(headTree)) {
    problems.push(`this commit has not passed pnpm verify on this machine (tree ${headTree.slice(0, 10)}). Run: pnpm verify`);
  }

  const pushed = git(["merge-base", "--is-ancestor", "HEAD", "refs/remotes/origin/main"]);
  if (pushed.status !== 0) {
    problems.push("this commit is not on origin/main. Push main first, so the tag names code that exists on GitHub");
  }

  if (git(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]).ok) {
    problems.push(`the tag ${tag} already exists`);
  }
  return problems;
}

/** Annotated, so it records who and when; the tree hash ties it to the verify stamp. */
export function createTag({ tag, message }) {
  return git(["tag", "-a", tag, "-m", message]);
}

export function pushTag(tag, remote = "origin") {
  return git(["push", remote, `refs/tags/${tag}`], { timeoutMs: 2 * 60 * 1000 });
}
