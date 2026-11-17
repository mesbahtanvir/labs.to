// Runs one command and gives up on it when it goes quiet. Used through runWatched() in exec.mjs.
//
//   node tooling/lib/watch.mjs <quietMs> <totalMs> <command> [args...]
//
// The command's output passes through unchanged, and so does its exit status. If the command
// prints nothing for <quietMs> while it is still running, or runs for longer than <totalMs>,
// it and every process it started are killed, the last line on stderr starts with STALL_MARK
// and the exit status is STALL_STATUS.
//
// A separate process, because run() is synchronous: spawnSync can only wait for a fixed time,
// can only kill the one process it started (which here is a launcher two levels above the real
// work) and keeps waiting while anything holds the command's output open.

import { spawn, spawnSync } from "node:child_process";
import { STALL_MARK, STALL_STATUS } from "./exec.mjs";

const [quietArg, totalArg, cmd, ...args] = process.argv.slice(2);
const quietMs = Number(quietArg);
const totalMs = Number(totalArg);
if (!cmd || !(quietMs > 0) || !(totalMs > 0)) {
  console.error("usage: node tooling/lib/watch.mjs <quietMs> <totalMs> <command> [args...]");
  process.exit(2);
}

// How long output may still arrive after the command itself has exited (a process it left
// behind can hold the pipes open for ever; the exit status is already known by then).
const DRAIN_MS = 1000;

const started = Date.now();
let lastOutput = started;
let finished = false;

const child = spawn(cmd, args, { stdio: ["inherit", "pipe", "pipe"] });
child.stdout.on("data", (chunk) => {
  lastOutput = Date.now();
  process.stdout.write(chunk);
});
child.stderr.on("data", (chunk) => {
  lastOutput = Date.now();
  process.stderr.write(chunk);
});

/** Ends this process once what is already written has been flushed. */
function finish(status) {
  if (finished) return;
  finished = true;
  clearInterval(watch);
  child.stdout.destroy();
  child.stderr.destroy();
  process.exitCode = status;
}

/** The command and everything below it, deepest first. */
function processTree(pid) {
  const rows = (spawnSync("ps", ["-axo", "pid=,ppid="], { encoding: "utf8" }).stdout ?? "")
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((row) => row.length === 2);
  const below = (parent) => rows.filter(([, ppid]) => ppid === parent).flatMap(([p]) => [...below(p), p]);
  return [...below(pid), pid];
}

function stop(why) {
  if (finished) return;
  const pids = processTree(child.pid);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  process.stderr.write(`\n${STALL_MARK} ${why}; killed ${pids.length} process${pids.length === 1 ? "" : "es"}\n`);
  finish(STALL_STATUS);
}

const seconds = (ms) => `${Number((ms / 1000).toFixed(1))}s`;
const watch = setInterval(
  () => {
    const now = Date.now();
    if (now - started > totalMs) stop(`still running after ${seconds(totalMs)}`);
    else if (now - lastOutput > quietMs) stop(`no output for ${seconds(quietMs)}`);
  },
  Math.min(1000, Math.ceil(quietMs / 4)),
);

child.on("error", (e) => {
  process.stderr.write(`${e.message}\n`);
  finish(127);
});
child.on("exit", (code) => {
  const status = code ?? 1; // killed by a signal
  child.on("close", () => finish(status));
  setTimeout(() => finish(status), DRAIN_MS).unref();
});
// run() gives up a little after <totalMs> and signals only this process: take the command along.
process.on("SIGTERM", () => stop("stopped from outside"));
