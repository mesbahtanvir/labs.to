// Supabase helpers: the pinned CLI, and the throwaway "verify" stack.
//
// `pnpm verify` never touches the stack you develop against. It copies an
// idea's supabase/ folder into a temp workdir under a different project id
// (<idea>-verify) and different ports, runs there, and tears it down. So a
// verification run, yours or Claude's, can not wipe your dev database.

import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./exec.mjs";
import { acquireLock } from "./lock.mjs";
import { APPS_DIR, ROOT } from "./manifest.mjs";

export const SB_BIN = join(ROOT, "node_modules", ".bin", "supabase");

// Services a database-centred verification does not need (names for CLI 2.105.0).
const LEAN_EXCLUDES = "edge-runtime,imgproxy,logflare,mailpit,realtime,storage-api,studio,supavisor,vector";

// Dev stacks use ports 44320-49151. The verify stack of an idea listens exactly
// 2000 below its dev ports, which no other dev block can occupy.
const PORT_MIN = 44320;
const PORT_MAX = 49151;
const VERIFY_PORT_DELTA = -2000;

const VERIFY_ROOT = join(tmpdir(), "labs-verify");

/** Runs the pinned Supabase CLI with `workdir` as the project root. */
export function sb(workdir, args) {
  return run(SB_BIN, ["--workdir", workdir, ...args]);
}

export function dockerUp() {
  return run("docker", ["info", "--format", "{{.ServerVersion}}"]).ok;
}

export function cliInstalled() {
  return existsSync(SB_BIN);
}

function runningContainers() {
  const r = run("docker", ["ps", "--format", "{{.Names}}"]);
  return r.ok ? r.stdout.split("\n").filter(Boolean) : [];
}

export function verifyStackRunning(idea) {
  return runningContainers().includes(`supabase_db_${idea}-verify`);
}

/**
 * Locks and prepares the verify workdir for an idea. Throws if another verify
 * of the same idea is running. Call release() when done.
 */
export function prepareVerifyStack(idea) {
  const release = acquireLock(VERIFY_ROOT, idea);

  const workdir = join(VERIFY_ROOT, idea);
  rmSync(join(workdir, "supabase"), { recursive: true, force: true });
  cpSync(join(APPS_DIR, idea, "supabase"), join(workdir, "supabase"), {
    recursive: true,
    filter: (p) => !/[\\/]\.(temp|branches)([\\/]|$)/.test(p), // CLI state, e.g. a linked project ref
  });

  const configPath = join(workdir, "supabase", "config.toml");
  const config = readFileSync(configPath, "utf8")
    .replace(/^project_id\s*=\s*".*"/m, `project_id = "${idea}-verify"`)
    .replace(/^(\s*[a-z_]*port\s*=\s*)(\d+)/gm, (line, head, value) => {
      const port = Number(value);
      return port >= PORT_MIN && port <= PORT_MAX ? `${head}${port + VERIFY_PORT_DELTA}` : line;
    });
  writeFileSync(configPath, config);

  return { workdir, release };
}

export function startStack(workdir) {
  return sb(workdir, ["start", "-x", LEAN_EXCLUDES]);
}

/** Stops and deletes a verify stack. Refuses to touch anything that is not a verify project. */
export function stopStack(workdir) {
  const config = readFileSync(join(workdir, "supabase", "config.toml"), "utf8");
  const id = config.match(/^project_id\s*=\s*"(.*)"/m)?.[1] ?? "";
  if (!id.endsWith("-verify")) return { ok: false, out: `refusing to stop "${id}": not a verify project` };
  return sb(workdir, ["stop", "--no-backup"]);
}
