// Web releases: build the committed tree on this machine, then upload that build to Vercel.
//
// Hermetic. The build runs in a clean export of HEAD (`git archive`), never in the working
// copy, so an untracked .env.local, a stale .next or a file that was never committed cannot
// change what ships: a release is exactly the commit that passed `pnpm verify`.
//
// Each idea is one Vercel project, labs-<idea>, whose Root Directory is apps/<idea>/web. The
// project is created on first use and its settings are kept in step. The token never goes on a
// command line: it is written to a private auth.json in a temporary Vercel config directory,
// which is removed on exit.
//
// Stage decides the target: `live` ships to production, `alpha` to a preview deployment, which
// Vercel keeps behind its own sign-in by default (the web counterpart of internal TestFlight).

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE_ROOT } from "./cache.mjs";
import { parseEnv } from "./env.mjs";
import { run } from "./exec.mjs";
import { ROOT } from "./manifest.mjs";
import { hostedUrlProblem } from "./release.mjs";

const stringEnv = (env, key) => (typeof env[key] === "string" && env[key].trim() !== "" ? env[key].trim() : null);

export const DEFAULT_API = "https://api.vercel.com";
const LOOPBACK_RE = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/;

/**
 * The Vercel API address. A VERCEL_API_URL is honoured only when it is a loopback address: it
 * exists so a rehearsal can point the real CLI at a stand-in server, and it can never send the
 * token to another host.
 */
export function apiBase(env = process.env) {
  const override = stringEnv(env, "VERCEL_API_URL");
  return override && LOOPBACK_RE.test(override) ? override.replace(/\/$/, "") : DEFAULT_API;
}

export const projectName = (idea) => `labs-${idea}`;
export const targetFor = (stage) => (stage === "live" ? "production" : "preview");

/** What the Vercel project must be set to for a monorepo build from the repository root. */
export function projectSettings(idea) {
  return {
    framework: "nextjs",
    rootDirectory: `apps/${idea}/web`,
    // Skip install scripts: the root package's Supabase CLI would download a binary the build never uses.
    installCommand: "pnpm install --frozen-lockfile --ignore-scripts",
    sourceFilesOutsideRootDirectory: true, // the workspace lockfile and packages/web live above the app
  };
}

/** The fields of `wanted` that `existing` does not have. */
export const settingsDrift = (existing, wanted) => Object.fromEntries(Object.entries(wanted).filter(([k, v]) => existing?.[k] !== v));

/** Cheap checks that a real web release can start. Reads and prints no secret. */
export function credentialProblems(env = process.env) {
  const problems = [];
  const token = stringEnv(env, "VERCEL_TOKEN");
  if (!token) problems.push("VERCEL_TOKEN is not set (create one at vercel.com/account/tokens)");
  else if (token.startsWith("op://") && !run("op", ["--version"]).ok) problems.push("VERCEL_TOKEN is a 1Password reference but the 1Password CLI (op) is not installed or not working");
  if (!run("vercel", ["--version"]).ok) problems.push("the Vercel CLI is not installed. Run: npm install --global vercel");
  return problems;
}

// ---- the project, over Vercel's REST API ----------------------------------------------------

async function api({ base, token, teamId, method = "GET", path, body }) {
  const url = new URL(`${base}${path}`);
  if (teamId) url.searchParams.set("teamId", teamId);
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON: the message below falls back to the text */
  }
  return { ok: res.ok, status: res.status, json, text };
}

const apiError = (r) => `${r.status} ${r.json?.error?.message ?? r.text.slice(0, 200)}`;

/**
 * Finds the idea's Vercel project, creating it when it is not there and correcting its settings
 * when they have drifted. Called only for a real release: a dry run never talks to Vercel.
 * @returns {Promise<{ ok: true, created: boolean, patched: string[], project: { id: string, orgId: string } } | { ok: false, out: string }>}
 */
export async function ensureProject({ token, teamId = null, idea, base = apiBase() }) {
  const name = projectName(idea);
  const wanted = projectSettings(idea);
  const common = { base, token, teamId };

  const found = await api({ ...common, path: `/v9/projects/${encodeURIComponent(name)}` });
  let project = found.json;
  let created = false;
  if (found.status === 404) {
    const made = await api({ ...common, method: "POST", path: "/v11/projects", body: { name, ...wanted } });
    if (!made.ok) return { ok: false, out: `could not create the Vercel project ${name}: ${apiError(made)}` };
    project = made.json;
    created = true;
  } else if (!found.ok) {
    return { ok: false, out: `could not read the Vercel project ${name}: ${apiError(found)}` };
  }

  const drift = settingsDrift(project, wanted);
  if (Object.keys(drift).length > 0) {
    const patched = await api({ ...common, method: "PATCH", path: `/v9/projects/${encodeURIComponent(project.id)}`, body: drift });
    if (!patched.ok) return { ok: false, out: `could not update the settings of the Vercel project ${name}: ${apiError(patched)}` };
  }
  return { ok: true, created, patched: Object.keys(drift), project: { id: project.id, orgId: project.accountId } };
}

// ---- the build: a clean export of HEAD -----------------------------------------------------------

export const releaseRoot = ({ idea, version, build }) => join(CACHE_ROOT, "web", idea, "releases", `${version}-${build}`);

/** The committed files of HEAD, and nothing else, in a new folder. */
export function exportHead({ idea, version, build }) {
  const root = releaseRoot({ idea, version, build });
  rmSync(root, { recursive: true, force: true });
  const dir = join(root, "src");
  mkdirSync(dir, { recursive: true });
  const tarball = join(root, "head.tar");
  const archive = run("git", ["archive", "--format=tar", "-o", tarball, "HEAD"], { cwd: ROOT });
  if (!archive.ok) return { ok: false, out: `git archive failed: ${archive.out.trim()}`, dir };
  const extract = run("tar", ["-xf", tarball, "-C", dir]);
  rmSync(tarball, { force: true });
  return { ok: extract.ok, out: extract.ok ? "" : extract.out.trim(), dir };
}

// Child processes get the machine's environment minus whatever the outer `pnpm release` run
// added for itself, so a nested pnpm or vercel behaves as it would in a plain terminal.
const cleanEnv = () => Object.fromEntries(Object.keys(process.env).filter((k) => /^(npm_|PNPM_)/.test(k) || k === "INIT_CWD").map((k) => [k, undefined]));

/** The text that says what went wrong, instead of the whole log. */
export const tail = (out, lines = 25) => out.split("\n").filter((l) => l.trim()).slice(-lines).join("\n");

/**
 * A dry run's build: install and build the exported tree with the project's own scripts, the way
 * Vercel would, but without an account. It proves that HEAD builds from a clean checkout.
 */
export function cleanBuild({ dir, idea }) {
  const opts = { cwd: dir, env: cleanEnv(), timeoutMs: 20 * 60 * 1000 };
  const install = run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], opts);
  if (!install.ok) return { ok: false, out: tail(install.out) };
  const build = run("pnpm", ["--filter", `@labs/${idea}-web`, "build"], opts);
  if (!build.ok) return { ok: false, out: tail(build.out) };
  const built = existsSync(join(dir, "apps", idea, "web", ".next", "BUILD_ID"));
  return { ok: built, out: built ? "" : "the build finished but left no .next/BUILD_ID" };
}

// ---- Vercel: sign in, pull, build, deploy ---------------------------------------------------------------

/** A private Vercel config directory holding the token, so it never appears on a command line. */
export function materializeAuth({ token }) {
  const root = join(CACHE_ROOT, "vercel-auth");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const dir = mkdtempSync(join(root, "g-"));
  chmodSync(dir, 0o700);
  writeFileSync(join(dir, "auth.json"), JSON.stringify({ token }), { mode: 0o600 });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function vercel(args, { dir, auth, base = apiBase(), timeoutMs = 30 * 60 * 1000 }) {
  const common = ["--global-config", auth.dir, "--no-color", ...(base === DEFAULT_API ? [] : ["--api", base])];
  return run("vercel", [...args, ...common], { cwd: dir, env: cleanEnv(), timeoutMs });
}

/** Points the exported tree at the project, as `vercel link` would. */
export function linkProject({ dir, project }) {
  mkdirSync(join(dir, ".vercel"), { recursive: true });
  writeFileSync(join(dir, ".vercel", "project.json"), `${JSON.stringify({ projectId: project.id, orgId: project.orgId })}\n`);
}

/** The project's settings and environment variables for this target, into <dir>/.vercel. */
export function vercelPull({ dir, auth, target }) {
  const r = vercel(["pull", "--yes", `--environment=${target}`], { dir, auth });
  return { ok: r.ok, out: r.ok ? "" : tail(r.out) };
}

/** What the pulled environment would put in the app, checked before anything is built. */
export function pulledEnvProblems({ manifest, dir, target }) {
  if (manifest.backend !== "supabase") return [];
  let vars = {};
  try {
    vars = parseEnv(readFileSync(join(dir, ".vercel", `.env.${target}.local`), "utf8")).vars;
  } catch {
    /* no file: every variable is missing, which is reported below */
  }
  const where = `the Vercel project ${projectName(manifest.name)} (${target})`;
  const hint = "Create the hosted Supabase project, then add it to the project's environment variables (Vercel dashboard, or: vercel env add)";
  const problems = [];
  const bad = hostedUrlProblem(vars.NEXT_PUBLIC_SUPABASE_URL);
  if (bad?.kind === "empty") problems.push(`${where} has no NEXT_PUBLIC_SUPABASE_URL. ${hint}`);
  else if (bad?.kind === "not-https") problems.push(`NEXT_PUBLIC_SUPABASE_URL in ${where} must be an https URL (got ${bad.url})`);
  else if (bad?.kind === "local") problems.push(`NEXT_PUBLIC_SUPABASE_URL in ${where} points at a local address (${bad.host}). Use the hosted project`);
  if (!vars.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()) problems.push(`${where} has no NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. ${hint}`);
  return problems;
}

/** `vercel build` into <dir>/.vercel/output: Vercel's own build, run here instead of on their servers. */
export function vercelBuild({ dir, auth, target }) {
  const r = vercel(["build", "--yes", ...(target === "production" ? ["--prod"] : [])], { dir, auth });
  if (!r.ok) return { ok: false, out: tail(r.out) };
  const built = existsSync(join(dir, ".vercel", "output", "config.json"));
  return { ok: built, out: built ? "" : "vercel build finished but left no .vercel/output/config.json" };
}

/** The deployment URL: `vercel deploy` prints it, and only it, on stdout. */
export function parseDeployUrl(stdout) {
  const last = String(stdout).trim().split("\n").filter(Boolean).at(-1)?.trim() ?? "";
  return /^https:\/\/[^\s]+$/.test(last) ? last : null;
}

/** Uploads the finished build. Nothing is built on Vercel's servers. */
export function vercelDeploy({ dir, auth, target, meta }) {
  const tags = Object.entries(meta).flatMap(([k, v]) => ["--meta", `${k}=${v}`]);
  const r = vercel(["deploy", "--prebuilt", "--yes", ...(target === "production" ? ["--prod"] : []), ...tags], { dir, auth });
  const url = parseDeployUrl(r.stdout);
  if (!r.ok || url === null) return { ok: false, out: tail(r.out) || "vercel deploy printed no deployment URL", url: null };
  return { ok: true, out: "", url };
}
