// Client type generation from a Supabase database, shared by `pnpm types` and `pnpm verify`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { APPS_DIR, TYPE_TARGETS } from "./manifest.mjs";
import { sb } from "./supabase.mjs";

/**
 * Generates types for every platform of `idea` that has a generator, from the
 * local database of the stack running in `workdir`.
 * check=true compares against the committed files instead of writing them.
 * @returns {{ ok: boolean, stale: number, messages: string[] }}
 */
export function generateTypes({ idea, manifest, workdir, check }) {
  const messages = [];
  let stale = 0;
  for (const platform of manifest.platforms) {
    const target = TYPE_TARGETS[platform];
    if (!target) continue; // e.g. android: the CLI cannot generate Kotlin, so models are hand-written

    const run = sb(workdir, ["gen", "types", "--lang", target.lang, "--local"]);
    if (!run.ok) {
      return { ok: false, stale, messages: [...messages, `could not generate ${target.lang} types:\n${run.stalled ? run.out : run.stderr}`] };
    }

    const rel = `apps/${idea}/${platform}/${target.file}`;
    const out = join(APPS_DIR, idea, platform, target.file);
    if (check) {
      const current = existsSync(out) ? readFileSync(out, "utf8") : null;
      if (current === run.stdout) {
        messages.push(`ok:    ${rel}`);
      } else {
        stale++;
        messages.push(`stale: ${rel} (run: pnpm types ${idea})`);
      }
    } else {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, run.stdout);
      messages.push(`wrote  ${rel}`);
    }
  }
  return { ok: true, stale, messages };
}
