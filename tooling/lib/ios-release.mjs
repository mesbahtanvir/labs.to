// iOS releases: archive the app, then export it and upload it to App Store Connect
// (TestFlight) with one `xcodebuild -exportArchive`. No fastlane, no Ruby: Xcode
// already knows how to sign and upload, and an App Store Connect API key lets it do
// that without an interactive Apple ID session.
//
// Nothing here is called by `pnpm verify`. The simulator checks stay free of
// signing; this is the only place that talks to Apple.

import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CACHE_ROOT } from "./cache.mjs";
import { run } from "./exec.mjs";
import { PACKAGES_DIR, summarize } from "./ios.mjs";
import { hostedUrlProblem } from "./release.mjs";

const stringEnv = (env, key) => (typeof env[key] === "string" && env[key].trim() !== "" ? env[key].trim() : null);

// ---- what the build will contain ---------------------------------------------------

/** The resolved Release build settings of the Idea target (xcconfigs included). */
export function releaseSettings({ dir }) {
  const r = run(
    "xcodebuild",
    ["-project", "Idea.xcodeproj", "-scheme", "Idea", "-configuration", "Release", "-showBuildSettings", "-json", "-clonedSourcePackagesDirPath", PACKAGES_DIR],
    { cwd: dir, timeoutMs: 5 * 60 * 1000 },
  );
  if (!r.ok) return { ok: false, out: summarize(r.out) };
  try {
    const entry = JSON.parse(r.stdout).find((e) => e.target === "Idea");
    if (!entry?.buildSettings) return { ok: false, out: "xcodebuild did not report build settings for the Idea target" };
    return { ok: true, out: "", settings: entry.buildSettings };
  } catch (e) {
    return { ok: false, out: `could not read the build settings: ${e.message}` };
  }
}

/**
 * Things in the Release configuration that would ship a broken or wrong app.
 * Pure: takes the resolved settings, so it can be tested without Xcode.
 */
export function settingsProblems({ settings, manifest, needTeam, env = process.env }) {
  const problems = [];

  if (settings.PRODUCT_BUNDLE_IDENTIFIER !== manifest.bundle_id) {
    problems.push(`the app's bundle identifier is ${settings.PRODUCT_BUNDLE_IDENTIFIER ?? "(none)"} but idea.yaml says ${manifest.bundle_id}`);
  }

  if (manifest.backend === "supabase") {
    const url = (settings.SUPABASE_URL ?? "").trim();
    const key = (settings.SUPABASE_PUBLISHABLE_KEY ?? "").trim();
    const bad = hostedUrlProblem(url);
    if (bad?.kind === "empty") problems.push("Release has no SUPABASE_URL. Create the hosted Supabase project and fill in Config/Release.xcconfig");
    else if (bad?.kind === "not-https") problems.push(`Release SUPABASE_URL must be an https URL (got ${bad.url})`);
    else if (bad?.kind === "local") problems.push(`Release SUPABASE_URL points at a local address (${bad.host}). Use the hosted project`);
    if (key === "") problems.push("Release has no SUPABASE_PUBLISHABLE_KEY. Fill it in in Config/Release.xcconfig");
  }

  if (needTeam && teamId({ settings, env }) === null) {
    problems.push("no Apple developer team. Set DEVELOPMENT_TEAM in Config/Local.xcconfig, or LABS_APPLE_TEAM_ID in your environment");
  }
  return problems;
}

export function teamId({ settings, env = process.env }) {
  return stringEnv(env, "LABS_APPLE_TEAM_ID") ?? (settings.DEVELOPMENT_TEAM?.trim() || null);
}

// ---- App Store Connect credentials ---------------------------------------------------
//
// An API key (Users and Access > Integrations in App Store Connect) is per machine,
// not per idea, so it comes from the environment:
//
//   ASC_KEY_ID       the key's id
//   ASC_ISSUER_ID    the issuer id shown above the keys
//   the key itself, any one of:
//     ASC_KEY_PATH     path to AuthKey_<id>.p8
//     ASC_KEY_OP_REF   a 1Password reference (op://vault/item/field); the key is read
//                      into a private temporary file for the upload, then deleted
//     ~/.appstoreconnect/private_keys/AuthKey_<id>.p8   (Apple's conventional place)

function keyFile(env) {
  const id = stringEnv(env, "ASC_KEY_ID");
  const explicit = stringEnv(env, "ASC_KEY_PATH");
  if (explicit) return existsSync(explicit) ? explicit : null;
  const conventional = id ? join(homedir(), ".appstoreconnect", "private_keys", `AuthKey_${id}.p8`) : null;
  return conventional && existsSync(conventional) ? conventional : null;
}

/** Cheap checks that the credentials are there. Reads and prints no secret. */
export function credentialProblems(env = process.env) {
  const problems = [];
  if (!stringEnv(env, "ASC_KEY_ID")) problems.push("ASC_KEY_ID is not set (the App Store Connect API key id)");
  if (!stringEnv(env, "ASC_ISSUER_ID")) problems.push("ASC_ISSUER_ID is not set (the issuer id from App Store Connect)");

  const ref = stringEnv(env, "ASC_KEY_OP_REF");
  if (ref) {
    if (!ref.startsWith("op://")) problems.push("ASC_KEY_OP_REF must be a 1Password reference starting with op://");
    else if (!run("op", ["--version"]).ok) problems.push("ASC_KEY_OP_REF is set but the 1Password CLI (op) is not installed or not working");
  } else if (!keyFile(env)) {
    problems.push("no API key file: set ASC_KEY_PATH, or ASC_KEY_OP_REF, or put AuthKey_<id>.p8 in ~/.appstoreconnect/private_keys");
  }
  return problems;
}

/**
 * Makes the key available as a file and returns what xcodebuild needs.
 * A key read from 1Password lives in a 0600 file in a 0700 directory, and
 * `cleanup()` removes it; call that in a finally block.
 */
export function materializeCredentials(env = process.env) {
  const keyId = stringEnv(env, "ASC_KEY_ID");
  const issuerId = stringEnv(env, "ASC_ISSUER_ID");
  const ref = stringEnv(env, "ASC_KEY_OP_REF");
  if (!ref) return { ok: true, out: "", keyId, issuerId, keyPath: keyFile(env), cleanup() {} };

  const root = join(CACHE_ROOT, "release-keys");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const dir = mkdtempSync(join(root, "k-"));
  chmodSync(dir, 0o700);
  const keyPath = join(dir, `AuthKey_${keyId}.p8`);
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  const read = run("op", ["read", "--out-file", keyPath, "--file-mode", "0600", "--force", ref], { timeoutMs: 2 * 60 * 1000 });
  if (!read.ok) {
    cleanup();
    return { ok: false, out: `could not read the key from 1Password:\n${read.out.trim().split("\n").slice(-3).join("\n")}`, cleanup() {} };
  }
  return { ok: true, out: "", keyId, issuerId, keyPath, cleanup };
}

/** Lets xcodebuild create and update profiles with the API key instead of an Apple ID session. */
export function signingArgs({ keyId, issuerId, keyPath }) {
  return ["-allowProvisioningUpdates", "-authenticationKeyPath", keyPath, "-authenticationKeyID", keyId, "-authenticationKeyIssuerID", issuerId];
}

// ---- archive, export, upload -----------------------------------------------------------

export function releaseDir({ idea, version, build }) {
  return join(CACHE_ROOT, "ios", idea, "releases", `${version}-${build}`);
}

/**
 * Builds the signed (or, for a dry run, unsigned) Release archive. The version and
 * the build number are build settings passed on the command line, which win over
 * project.yml, so nothing in the tree changes.
 */
export function archive({ idea, dir, version, build, creds = null }) {
  const out = releaseDir({ idea, version, build });
  const archivePath = join(out, "Idea.xcarchive");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  mkdirSync(PACKAGES_DIR, { recursive: true });

  const args = [
    "archive",
    "-project", "Idea.xcodeproj",
    "-scheme", "Idea",
    "-configuration", "Release",
    "-destination", "generic/platform=iOS",
    "-archivePath", archivePath,
    "-derivedDataPath", join(CACHE_ROOT, "ios", idea, "DerivedData-release"),
    "-clonedSourcePackagesDirPath", PACKAGES_DIR,
    "-quiet",
    `MARKETING_VERSION=${version}`,
    `CURRENT_PROJECT_VERSION=${build}`,
  ];
  if (creds) args.push(...signingArgs(creds));
  else args.push("CODE_SIGNING_ALLOWED=NO", "CODE_SIGNING_REQUIRED=NO", "CODE_SIGN_IDENTITY="); // dry run: compiles for a device, signs nothing

  const r = run("xcodebuild", args, { cwd: dir, timeoutMs: 45 * 60 * 1000 });
  return { ok: r.ok, out: r.ok ? "" : summarize(r.out), archivePath };
}

/** What the archive actually contains, read back from its Info.plist. */
export function archiveInfo(archivePath) {
  const plist = join(archivePath, "Products", "Applications", "Idea.app", "Info.plist");
  if (!existsSync(plist)) return { ok: false, out: `no app in the archive (looked for ${plist})` };
  const r = run("plutil", ["-convert", "json", "-o", "-", "--", plist]);
  if (!r.ok) return { ok: false, out: r.out.trim() };
  try {
    return { ok: true, out: "", info: JSON.parse(r.stdout) };
  } catch (e) {
    return { ok: false, out: `could not read the archive's Info.plist: ${e.message}` };
  }
}

export function archiveProblems({ info, manifest, version, build }) {
  const problems = [];
  if (info.CFBundleShortVersionString !== version) problems.push(`the archive says version ${info.CFBundleShortVersionString}, expected ${version}`);
  if (String(info.CFBundleVersion) !== String(build)) problems.push(`the archive says build ${info.CFBundleVersion}, expected ${build}`);
  if (info.CFBundleIdentifier !== manifest.bundle_id) problems.push(`the archive's bundle id is ${info.CFBundleIdentifier}, expected ${manifest.bundle_id}`);
  return problems;
}

const xmlEscape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * ExportOptions.plist for "sign for the App Store and upload".
 *  - manageAppVersionAndBuildNumber is off: the build number is ours (the commit
 *    count), and Xcode must not quietly change it.
 *  - testFlightInternalTestingOnly is on for alpha: those builds reach only your
 *    own App Store Connect users, never external testers or the store.
 */
export function exportOptions({ team, internalOnly }) {
  const entries = {
    method: "app-store-connect",
    destination: "upload",
    teamID: team,
    signingStyle: "automatic",
    uploadSymbols: true,
    manageAppVersionAndBuildNumber: false,
    testFlightInternalTestingOnly: internalOnly,
  };
  const body = Object.entries(entries)
    .map(([k, v]) => `\t<key>${xmlEscape(k)}</key>\n\t${typeof v === "boolean" ? `<${v}/>` : `<string>${xmlEscape(v)}</string>`}`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}
</dict>
</plist>
`;
}

/** Signs the archive for distribution and uploads it. This is the step that talks to Apple. */
export function exportAndUpload({ idea, version, build, archivePath, team, internalOnly, creds }) {
  const out = releaseDir({ idea, version, build });
  const optionsPath = join(out, "ExportOptions.plist");
  writeFileSync(optionsPath, exportOptions({ team, internalOnly }));

  const r = run(
    "xcodebuild",
    ["-exportArchive", "-archivePath", archivePath, "-exportPath", join(out, "export"), "-exportOptionsPlist", optionsPath, ...signingArgs(creds)],
    { timeoutMs: 45 * 60 * 1000 },
  );
  return { ok: r.ok, out: r.ok ? "" : summarize(r.out) };
}
