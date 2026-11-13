// Small synchronous process runner shared by the tooling.

import { spawnSync } from "node:child_process";

/** Runs a command, capturing output. Never throws; check `.ok`. */
export function run(cmd, args = [], { cwd, env, timeoutMs = 15 * 60 * 1000, input } = {}) {
  const started = Date.now();
  const r = spawnSync(cmd, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: timeoutMs,
    input,
  });
  const stdout = r.stdout ?? "";
  const stderr = `${r.stderr ?? ""}${r.error ? `\n${r.error.message}` : ""}`;
  return { ok: r.status === 0, status: r.status, ms: Date.now() - started, stdout, stderr, out: stdout + stderr };
}
