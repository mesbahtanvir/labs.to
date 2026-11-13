// Where verification keeps what is worth reusing between runs (build caches) and its
// cross-process locks. Never inside the repo, so it can not reach the stamp or a commit.
// Safe to delete at any time: the next run starts cold.

import { homedir } from "node:os";
import { join } from "node:path";

export const CACHE_ROOT = join(homedir(), "Library", "Caches", "labs.to");
export const LOCK_ROOT = join(CACHE_ROOT, "locks");
