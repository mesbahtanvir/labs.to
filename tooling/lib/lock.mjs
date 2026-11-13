// A tiny cross-process lock: one directory per lock, holding the owner's pid.
// A lock whose owner died is taken over, so a crashed verify never wedges the next one.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Takes `<root>/<name>.lock`. Throws if a live process holds it.
 * @returns {() => void} release function
 */
export function acquireLock(root, name) {
  mkdirSync(root, { recursive: true });
  const lock = join(root, `${name}.lock`);
  try {
    mkdirSync(lock);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    let pid = NaN;
    try {
      pid = Number(readFileSync(join(lock, "pid"), "utf8"));
    } catch {
      /* unreadable lock: treat as stale */
    }
    if (pidAlive(pid)) throw new Error(`"${name}" is already in use by another verify (pid ${pid})`);
    rmSync(lock, { recursive: true, force: true });
    mkdirSync(lock);
  }
  writeFileSync(join(lock, "pid"), String(process.pid));
  return () => rmSync(lock, { recursive: true, force: true });
}
