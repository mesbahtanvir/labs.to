// Small synchronous process runner shared by the tooling.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WATCH = join(dirname(fileURLToPath(import.meta.url)), "watch.mjs");
// How watch.mjs says that it gave up on a command: this exit status, and a last line on stderr.
export const STALL_STATUS = 124;
export const STALL_MARK = "labs-watch:";

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

/**
 * run(), for a command that can go quiet and never exit. The command runs under watch.mjs:
 * with no output for `quietMs`, or after `timeoutMs` in all, it is killed together with
 * every process it started. Its output and exit status are otherwise what run() gives.
 * @returns what run() returns, plus `stalled`: null, or why the command was given up on
 */
export function runWatched(cmd, args = [], { quietMs, timeoutMs = 15 * 60 * 1000, ...options } = {}) {
  const r = run(process.execPath, [WATCH, String(quietMs), String(timeoutMs), cmd, ...args], { ...options, timeoutMs: timeoutMs + 60 * 1000 });
  const last = r.status === STALL_STATUS ? (r.stderr.trimEnd().split("\n").pop() ?? "") : "";
  return { ...r, stalled: last.startsWith(STALL_MARK) ? last.slice(STALL_MARK.length).trim() : null };
}

/**
 * Runs `attempt` (a runWatched call), and once more if it stalled. A command that fails is not
 * run again: only one that was given up on. The result is the second run's, with what happened
 * in `note` (when it passed) or at the top of `out` (when it did not; `stalled` is then set
 * only if the second run stalled too).
 */
export function retryStalled(attempt, what) {
  const first = attempt();
  if (!first.stalled) return first;
  const second = attempt();
  const ms = first.ms + second.ms;
  if (second.ok) return { ...second, ms, note: `${what} stalled once (${first.stalled}) and passed when run again` };
  const outcome = second.stalled ? `It was run again and stalled again: ${second.stalled}.` : "It was run again and failed. The second run:";
  const out = `${what} stalled: ${first.stalled}. Its output until then:\n${indent(first.out)}\n${outcome}\n${indent(second.out)}`;
  return { ...second, ms, out };
}

/** A run's output without the watcher's own last line, indented. */
const indent = (text) =>
  text
    .split("\n")
    .filter((line) => !line.startsWith(STALL_MARK))
    .join("\n")
    .trimEnd()
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
