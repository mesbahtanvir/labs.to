// The words on a GitHub Release: which commits went into this version of this idea.
//
// A release tag `<idea>/<platform>/vX.Y.Z` is made by `pnpm release` on the maintainer's
// machine, after the upload. .github/workflows/release.yml turns that tag into a GitHub
// Release so GitHub shows what landed where and when. This file is the logic of that
// step, as a plain script, so it can be tried locally and tested.

import { run } from "./exec.mjs";
import { ROOT } from "./manifest.mjs";
import { parseTag, parseTagMessage, previousVersion, tagFor } from "./release.mjs";

const git = (args) => run("git", args, { cwd: ROOT });

/** The files that make up one idea on one platform (plus its backend and shared code). */
export const pathsFor = ({ idea, platform }) => [`apps/${idea}/${platform}`, `apps/${idea}/supabase`, `apps/${idea}/idea.yaml`, `packages/${platform}`];

/**
 * @param commits  [{ sha, subject }], newest first
 * @returns markdown for the release body
 */
export function formatNotes({ idea, platform, version, build, stage, previous, commits, maxCommits = 40 }) {
  const lines = [`**${idea}** for ${platform}, version ${version}${build ? ` (build ${build})` : ""}${stage ? `, stage ${stage}` : ""}.`, ""];
  if (commits.length === 0) {
    lines.push(previous ? `No changes to this app's files since ${previous}.` : "First release.");
  } else {
    lines.push(previous ? `Changes since ${previous}:` : "First release. Everything so far:", "");
    for (const c of commits.slice(0, maxCommits)) lines.push(`- ${c.subject} (\`${c.sha}\`)`);
    if (commits.length > maxCommits) lines.push(`- and ${commits.length - maxCommits} more`);
  }
  lines.push("", "Shipped from the maintainer's machine by `pnpm release`.");
  return `${lines.join("\n")}\n`;
}

/** Is the commit the tag names part of origin/main? A release must be. */
export function tagIsOnMain(tag) {
  return git(["merge-base", "--is-ancestor", `refs/tags/${tag}^{commit}`, "refs/remotes/origin/main"]).status === 0;
}

/**
 * Everything the workflow needs to publish a release for `tag`.
 * @returns {{ ok: true, release: false } | { ok: true, release: true, title, prerelease, notes } | { ok: false, out }}
 */
export function describeRelease(tag) {
  const parsed = parseTag(tag);
  if (!parsed) return { ok: true, release: false, out: `${tag} is not a release tag (<idea>/<platform>/vX.Y.Z); nothing to publish` };
  const { idea, platform, version } = parsed;

  if (!git(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]).ok) return { ok: false, out: `the tag ${tag} does not exist here` };
  if (!tagIsOnMain(tag)) {
    return { ok: false, out: `${tag} is not on origin/main. Releases are cut from main by pnpm release, so this tag was made another way. Delete it (git push origin :refs/tags/${tag}) and release again.` };
  }

  // A tag made by pnpm release is annotated and says its build and stage. Without that
  // (a checkout that flattened it), the release is still published, as a prerelease.
  const message = git(["tag", "--list", "--format=%(contents)", tag]).stdout;
  const { build, stage } = parseTagMessage(message);

  const tags = git(["tag", "--list", `${idea}/${platform}/v*`]).stdout.split("\n").filter(Boolean);
  const previous = previousVersion(tags, idea, platform, version);
  const range = previous ? `refs/tags/${tagFor(idea, platform, previous)}..refs/tags/${tag}` : `refs/tags/${tag}`;
  const log = git(["log", "--no-merges", "--pretty=format:%h%x09%s", range, "--", ...pathsFor({ idea, platform })]);
  if (!log.ok) return { ok: false, out: `git log failed: ${log.out.trim()}` };
  const commits = log.stdout.split("\n").filter(Boolean).map((l) => {
    const [sha, ...subject] = l.split("\t");
    return { sha, subject: subject.join("\t") };
  });

  return {
    ok: true,
    release: true,
    title: `${idea} ${platform} ${version}`,
    prerelease: stage !== "live", // alpha builds, and any build whose stage is unknown, are not "the" release
    notes: formatNotes({ idea, platform, version, build, stage, previous, commits }),
  };
}
