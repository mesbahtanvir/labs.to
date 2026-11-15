#!/usr/bin/env node
// pnpm release: ship one idea on one platform, from this machine.
//
//   pnpm release <idea> <platform>                 next patch version (0.1.0 for a first release)
//   pnpm release <idea> <platform> --bump minor    patch (default), minor or major
//   pnpm release <idea> <platform> --version 1.0.0 an explicit version, above the latest
//   pnpm release <idea> <platform> --dry-run       everything except signing, uploading and tagging
//
// A release is a verified commit on main that is also on GitHub, plus the annotated tag
// <idea>/<platform>/vX.Y.Z, which is created only after the upload succeeded. The version
// is computed from the tags; nothing in the tree changes, so the verify stamp stays valid.
//
// ios goes to TestFlight and web to Vercel. android and the hosted backend come next.
// This machine's settings (keys, tokens) come from the environment or .env.labs; see
// `pnpm doctor`. Like `verify`, every step is a plain script with no LLM in the loop.

import { join } from "node:path";
import { parseArgs } from "node:util";
import { LOCK_ROOT } from "./lib/cache.mjs";
import { loadLocalEnv, resolveSecret } from "./lib/env.mjs";
import { run } from "./lib/exec.mjs";
import { treeOf } from "./lib/git.mjs";
import { generateProject, iosPreflight } from "./lib/ios.mjs";
import * as ios from "./lib/ios-release.mjs";
import { acquireLock } from "./lib/lock.mjs";
import { APPS_DIR, PLATFORMS, loadIdea } from "./lib/manifest.mjs";
import { BUMPS, buildNumber, createTag, latestVersion, nextVersion, pushTag, remoteTagExists, repoProblems, tagFor } from "./lib/release.mjs";
import * as web from "./lib/web-release.mjs";

const RELEASABLE = ["ios", "web"];
const USAGE = `usage: pnpm release <idea> <platform> [--bump patch|minor|major] [--version X.Y.Z] [--dry-run]
platforms: ${RELEASABLE.join(", ")} (android and supabase are not built yet)`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    bump: { type: "string" },
    version: { type: "string" },
    "dry-run": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const die = (message, code = 1) => {
  console.error(message);
  process.exit(code);
};

// This machine's settings (App Store Connect key, Vercel token, team): .env.labs, under the real environment.
for (const problem of loadLocalEnv().problems) console.error(`warning: ${problem}`);
const fmt = (ms) => `${(ms / 1000).toFixed(1)}s`;
const dryRun = values["dry-run"] === true;

// ---- what is being released ----------------------------------------------------
const [ideaName, platform] = positionals;
if (positionals.length !== 2) die(USAGE, 2);
if (![...PLATFORMS, "supabase"].includes(platform)) die(`unknown platform "${platform}".\n${USAGE}`, 2);

const { manifest, errors } = loadIdea(ideaName);
if (errors.length > 0) die(`apps/${ideaName}/idea.yaml:\n  - ${errors.join("\n  - ")}`, 2);
if (platform !== "supabase" && !manifest.platforms.includes(platform)) {
  die(`${ideaName} does not have the ${platform} platform (it has: ${manifest.platforms.join(", ") || "none"})`, 2);
}
if (!RELEASABLE.includes(platform)) die(`releasing ${platform} is not built yet. Only ${RELEASABLE.join(" and ")} exist so far.`, 2);

let latest;
let build;
try {
  latest = latestVersion(ideaName, platform);
  build = buildNumber();
} catch (e) {
  die(`${e.message}\n(has this repository any commits?)`, 2);
}
const next = nextVersion({ latest, bump: values.bump, explicit: values.version ?? null });
if (next.error) die(next.error, 2);
const { version } = next;
const tag = tagFor(ideaName, platform, version);

const alpha = manifest.stage === "alpha";
const webTarget = web.targetFor(manifest.stage);
const destination =
  platform === "ios"
    ? `TestFlight${alpha ? ", internal testers only (stage alpha)" : " and the App Store (stage live)"}`
    : `Vercel project ${web.projectName(ideaName)}, ${webTarget === "production" ? "production (stage live)" : "a preview deployment, behind Vercel's sign-in (stage alpha)"}`;
const modes = {
  ios: { dry: "dry run: builds an unsigned archive, uploads and tags nothing", real: "real: signs, uploads, then tags" },
  web: { dry: "dry run: builds a clean export of HEAD, uploads and tags nothing", real: "real: builds a clean export of HEAD, deploys, then tags" },
}[platform];

console.log(`release: ${ideaName} / ${platform}  ${version} (build ${build})  ${latest ? `after ${latest}` : "first release"}`);
console.log(`  tag    ${tag}`);
console.log(`  to     ${destination}`);
console.log(`  mode   ${dryRun ? modes.dry : modes.real}`);

let unlock;
try {
  unlock = acquireLock(LOCK_ROOT, `release-${ideaName}-${platform}`);
} catch {
  die(`\nanother release of ${ideaName} for ${platform} is already running`);
}
process.on("exit", () => unlock());

// ---- shared machinery --------------------------------------------------------------
const t0 = Date.now();
const step = async (name, fn) => {
  process.stdout.write(`  ${name.padEnd(24)} `);
  const started = Date.now();
  let r;
  try {
    r = await fn();
  } catch (e) {
    r = { ok: false, out: String(e?.message ?? e) };
  }
  console.log(`${r.ok ? "ok  " : "FAIL"} ${fmt(Date.now() - started)}${r.ok && r.note ? `  ${r.note}` : ""}`);
  if (!r.ok) {
    const tail = (r.out ?? "").trimEnd().split("\n").slice(-30).map((l) => `      ${l}`).join("\n");
    if (tail.trim()) console.log(tail);
    console.error(`\nrelease: FAIL  ${fmt(Date.now() - t0)}${r.hint ? `\n${r.hint}` : ""}`);
    process.exit(1);
  }
  return r;
};

// Blockers stop a real release. In a dry run they are only reported, so a work in
// progress can still prove that it builds.
const blockers = [];

const checkRepository = () =>
  step("repository", () => {
    blockers.push(...repoProblems({ tag, stage: manifest.stage }));
    if (!dryRun) {
      const remote = remoteTagExists(tag);
      if (!remote.ok) blockers.push(`could not reach origin to check that ${tag} is free:\n${remote.out}`);
      else if (remote.exists) blockers.push(`the tag ${tag} already exists on origin`);
    }
    return { ok: true, note: `tree ${treeOf("HEAD")?.slice(0, 10) ?? "none"}` };
  });

function stopIfBlocked() {
  if (blockers.length === 0) return;
  console.log(`\n${dryRun ? "a real release would be blocked by" : "release blocked by"}:`);
  for (const b of blockers) console.log(`  - ${b.split("\n").join("\n    ")}`);
  if (!dryRun) {
    console.error(`\nrelease: BLOCKED  ${fmt(Date.now() - t0)}`);
    process.exit(1);
  }
}

/** The annotated tag, last: only an upload that succeeded gets one. */
async function tagAndPush(shipped) {
  const message = `${ideaName} ${platform} ${version} (build ${build})\n\nstage: ${manifest.stage}\ntree: ${treeOf("HEAD")}`;
  await step("tag", () => {
    const r = createTag({ tag, message });
    return { ok: r.ok, out: r.out, hint: `${shipped}, but the tag was not created. Create it yourself:\n  git tag -a ${tag} -m "${ideaName} ${platform} ${version} (build ${build})"\n  git push origin refs/tags/${tag}` };
  });
  await step("push tag", () => {
    const r = pushTag(tag);
    return { ok: r.ok, out: r.out, hint: `${shipped} and the tag exists locally. Push it:\n  git push origin refs/tags/${tag}` };
  });
}

// ---- ios: TestFlight ---------------------------------------------------------------
async function releaseIos() {
  const dir = join(APPS_DIR, ideaName, "ios");

  console.log("\nchecks");
  const pre = iosPreflight();
  if (!pre.ok) die(`\n${pre.out}`);
  await checkRepository();
  await step("xcodegen", () => generateProject(dir));
  const { settings } = await step("release settings", () => ios.releaseSettings({ dir }));
  blockers.push(...ios.settingsProblems({ settings, manifest, needTeam: !dryRun }));
  if (!dryRun) blockers.push(...ios.credentialProblems());
  stopIfBlocked();

  console.log("\nbuild");
  let creds = null;
  try {
    if (!dryRun) {
      creds = ios.materializeCredentials();
      if (!creds.ok) die(creds.out);
      process.on("exit", () => creds.cleanup()); // process.exit() skips `finally`; the key file must still go
    }

    let archivePath;
    await step("archive", () => {
      const r = ios.archive({ idea: ideaName, dir, version, build, creds });
      archivePath = r.archivePath;
      return r;
    });
    await step("check archive", () => {
      const r = ios.archiveInfo(archivePath);
      if (!r.ok) return r;
      const problems = ios.archiveProblems({ info: r.info, manifest, version, build });
      return { ok: problems.length === 0, out: problems.join("\n"), note: `${r.info.CFBundleIdentifier} ${r.info.CFBundleShortVersionString} (${r.info.CFBundleVersion})` };
    });

    if (dryRun) {
      console.log(`\nrelease: DRY RUN OK  ${fmt(Date.now() - t0)}`);
      console.log(`  archive  ${archivePath}`);
      console.log("  nothing was signed, uploaded or tagged");
      process.exit(0);
    }

    await step("sign and upload", () => ios.exportAndUpload({ idea: ideaName, version, build, archivePath, team: ios.teamId({ settings }), internalOnly: alpha, creds }));
    await tagAndPush("The build was uploaded");

    console.log(`\nrelease: DONE  ${fmt(Date.now() - t0)}  ${tag}`);
    console.log("  App Store Connect now processes the build, which takes a few minutes. It then shows up under TestFlight.");
    console.log("  Internal testers receive it once the internal group has automatic distribution turned on (a one-time setting).");
  } finally {
    creds?.cleanup();
  }
}

// ---- web: Vercel -------------------------------------------------------------------
async function releaseWeb() {
  console.log("\nchecks");
  await checkRepository();
  if (!dryRun) blockers.push(...web.credentialProblems());
  stopIfBlocked();

  console.log("\nbuild");
  const exported = await step("export HEAD", () => web.exportHead({ idea: ideaName, version, build }));
  const { dir } = exported;

  if (dryRun) {
    await step("clean build", () => web.cleanBuild({ dir, idea: ideaName }));
    console.log(`\nrelease: DRY RUN OK  ${fmt(Date.now() - t0)}`);
    console.log(`  export   ${dir}`);
    console.log("  HEAD builds from a clean checkout. Vercel's own build, the upload and the tag run only in a real release.");
    process.exit(0);
  }

  const token = resolveSecret("VERCEL_TOKEN");
  if (!token.ok) die(`\n${token.out}`);
  const auth = web.materializeAuth({ token: token.value });
  process.on("exit", () => auth.cleanup()); // process.exit() skips `finally`; the token file must still go
  try {
    const teamId = process.env.VERCEL_TEAM_ID?.trim() || null;
    const found = await step("vercel project", async () => {
      const r = await web.ensureProject({ token: token.value, teamId, idea: ideaName });
      if (!r.ok) return r;
      const note = r.created ? `created ${web.projectName(ideaName)}` : r.patched.length > 0 ? `updated ${r.patched.join(", ")}` : web.projectName(ideaName);
      return { ...r, note };
    });
    web.linkProject({ dir, project: found.project });

    await step("vercel pull", () => web.vercelPull({ dir, auth, target: webTarget }));
    await step("check environment", () => {
      const problems = web.pulledEnvProblems({ manifest, dir, target: webTarget });
      return { ok: problems.length === 0, out: problems.map((p) => `- ${p}`).join("\n") };
    });
    await step("vercel build", () => web.vercelBuild({ dir, auth, target: webTarget }));

    const sha = run("git", ["rev-parse", "HEAD"]).stdout.trim();
    const meta = { labsTag: tag, labsVersion: version, labsBuild: String(build), labsStage: manifest.stage, gitSha: sha };
    const deployed = await step("vercel deploy", () => web.vercelDeploy({ dir, auth, target: webTarget, meta }));
    await tagAndPush("The site was deployed");

    console.log(`\nrelease: DONE  ${fmt(Date.now() - t0)}  ${tag}`);
    console.log(`  ${deployed.url}`);
    console.log(webTarget === "production" ? "  This is the production deployment." : "  This is a preview deployment: Vercel keeps it behind its own sign-in by default, so only your team sees it.");
  } finally {
    auth.cleanup();
  }
}

if (platform === "ios") await releaseIos();
else await releaseWeb();
