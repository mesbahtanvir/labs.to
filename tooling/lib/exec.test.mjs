// Run with: pnpm test   (node's built-in test runner; part of `pnpm verify`)
//
// The commands here are small node scripts standing in for a CLI that prints and never exits.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { STALL_STATUS, retryStalled, run, runWatched } from "./exec.mjs";

const scratch = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "labs-exec-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
/** Writes a script and returns how to run it: [command, args]. */
const script = (dir, name, source) => {
  writeFileSync(join(dir, name), source);
  return [process.execPath, [join(dir, name)]];
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const pidsIn = (file) => readFileSync(file, "utf8").trim().split(/\s+/).map(Number);
const gone = async (pids) => {
  for (let i = 0; i < 100 && pids.some(alive); i++) await new Promise((r) => setTimeout(r, 50));
  return !pids.some(alive);
};

test("a watched command's output and exit status are what the command gave", (t) => {
  const dir = scratch(t);
  const [cmd, args] = script(dir, "plain.mjs", 'process.stdout.write("types: {\\n  a: 1\\n}\\n"); process.stderr.write("warned\\n"); process.exitCode = 3;');
  const plain = run(cmd, args);
  const watched = runWatched(cmd, args, { quietMs: 60_000 });
  assert.deepEqual([watched.stdout, watched.stderr, watched.status, watched.ok], [plain.stdout, plain.stderr, 3, false]);
  assert.equal(watched.stalled, null);
  assert.equal(runWatched(cmd, [...args, "more"], { quietMs: 60_000, cwd: dir }).stalled, null);
});

test("a command that goes quiet without exiting is killed, with every process it started", async (t) => {
  const dir = scratch(t);
  const pidFile = join(dir, "pids");
  // Like the CLI: a launcher that waits for a child doing the work, which prints and then hangs.
  const [cmd, args] = script(
    dir,
    "stalls.mjs",
    `import { spawn } from "node:child_process";
     import { writeFileSync } from "node:fs";
     if (process.argv[2] === "work") {
       console.log("Started the stack.");
       setInterval(() => {}, 1000);
     } else {
       const child = spawn(process.execPath, [process.argv[1], "work"], { stdio: "inherit" });
       writeFileSync(${JSON.stringify(pidFile)}, process.pid + " " + child.pid);
       child.on("exit", (code) => process.exit(code ?? 1));
     }`,
  );
  const r = runWatched(cmd, args, { quietMs: 500 });
  assert.equal(r.ok, false);
  assert.equal(r.status, STALL_STATUS);
  assert.equal(r.stalled, "no output for 0.5s; killed 2 processes");
  assert.match(r.stdout, /Started the stack\./, "what it printed before it went quiet is kept");
  assert.ok(r.ms < 30_000, `gave up after ${r.ms}ms, not after the 15 minutes run() waits`);
  assert.ok(await gone(pidsIn(pidFile)), "the launcher and its child are both gone");
});

test("a command that keeps printing is still stopped after the total time", (t) => {
  const dir = scratch(t);
  const [cmd, args] = script(dir, "chatty.mjs", 'setInterval(() => console.log("still pulling"), 50);');
  const r = runWatched(cmd, args, { quietMs: 10_000, timeoutMs: 700 });
  assert.equal(r.stalled, "still running after 0.7s; killed 1 process");
  assert.match(r.stdout, /still pulling/);
});

test("a command that exits is done, even if a process it left behind holds its output open", async (t) => {
  const dir = scratch(t);
  const pidFile = join(dir, "pid");
  const [cmd, args] = script(
    dir,
    "leaves.mjs",
    `import { spawn } from "node:child_process";
     import { writeFileSync } from "node:fs";
     const left = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "inherit", detached: true });
     left.unref();
     writeFileSync(${JSON.stringify(pidFile)}, String(left.pid));
     console.log("Finished.");`,
  );
  const r = runWatched(cmd, args, { quietMs: 60_000 });
  const [left] = pidsIn(pidFile);
  t.after(() => alive(left) && process.kill(left, "SIGKILL"));
  assert.deepEqual([r.ok, r.stalled, r.stdout], [true, null, "Finished.\n"]);
  assert.ok(r.ms < 30_000, `returned after ${r.ms}ms`);
  assert.ok(alive(left), "a process the command chose to leave running is not ours to kill");
});

test("a stalled command is run once more, and a failed one is not", () => {
  const ok = { ok: true, status: 0, ms: 10, out: "fine\n", stalled: null };
  const failed = { ok: false, status: 1, ms: 10, out: "not ok 1 - rls\n", stalled: null };
  const stalled = { ok: false, status: STALL_STATUS, ms: 500, out: "Started.\n\nlabs-watch: no output for 150s\n", stalled: "no output for 150s" };
  const attempts = (...results) => {
    let n = 0;
    const r = retryStalled(() => results[n++], "supabase db reset");
    return { ...r, runs: n };
  };

  assert.deepEqual(attempts(ok), { ...ok, runs: 1 });
  assert.deepEqual(attempts(failed, ok), { ...failed, runs: 1 }, "a failure stands: it is not what the second run is for");

  const recovered = attempts(stalled, ok);
  assert.deepEqual([recovered.ok, recovered.runs, recovered.ms], [true, 2, 510]);
  assert.equal(recovered.note, "supabase db reset stalled once (no output for 150s) and passed when run again");

  const twice = attempts(stalled, stalled, ok);
  assert.deepEqual([twice.ok, twice.runs, twice.stalled], [false, 2, "no output for 150s"]);
  assert.match(twice.out, /^supabase db reset stalled: no output for 150s\. Its output until then:\n {2}Started\.\nIt was run again and stalled again: no output for 150s\.\n {2}Started\.$/);

  const thenFailed = attempts(stalled, failed);
  assert.deepEqual([thenFailed.ok, thenFailed.runs, thenFailed.status, thenFailed.stalled], [false, 2, 1, null]);
  assert.match(thenFailed.out, /It was run again and failed\. The second run:\n {2}not ok 1 - rls$/);
});

test("the watcher is a file beside exec.mjs", () => {
  assert.ok(existsSync(new URL("./watch.mjs", import.meta.url)));
});
