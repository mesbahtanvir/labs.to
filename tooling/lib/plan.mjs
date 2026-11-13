// The planner: which (idea, platform | backend) pairs does a change affect?
// Used by `pnpm verify` locally and by ci.yml, so both agree on scope.

import { changedFiles } from "./git.mjs";
import { ACTIVE_STAGES, PLATFORMS, TEST_STAGES, TYPE_TARGETS, loadIdeas } from "./manifest.mjs";

// A change to any of these can affect every idea on every platform.
const GLOBAL_PATHS = [".github/", "tooling/", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".node-version"];
const ZERO_SHA = /^0+$/;
const matches = (file, p) => (p.endsWith("/") ? file.startsWith(p) : file === p);

/**
 * @param base    git ref to diff against; null/undefined (or an all-zero sha)
 *                means "no base": everything active is affected
 * @param stages  stages that get planned (default: prototype, alpha, live)
 * @param only    idea names to plan regardless of what changed
 * @returns {{ invalid } | { result, files, warning }}
 */
export function computePlan({ base = null, stages = ACTIVE_STAGES, only = null } = {}) {
  const ideas = loadIdeas();
  const invalid = ideas.filter((i) => i.errors.length > 0);
  if (invalid.length > 0) return { invalid };

  let files = null; // null = no usable diff, run everything
  let warning = null;
  if (!only && base && !ZERO_SHA.test(base)) {
    try {
      files = changedFiles(base);
    } catch (e) {
      warning = `could not diff against ${base} (${e.message.split("\n")[0]}); running everything`;
    }
  }

  const everything = only !== null || files === null || files.some((f) => GLOBAL_PATHS.some((p) => matches(f, p)));
  const touched = (pred) => everything || files.some(pred);

  const result = { ...Object.fromEntries(PLATFORMS.map((p) => [p, []])), supabase: [] };
  for (const { manifest: m } of ideas) {
    if (!stages.includes(m.stage)) continue;
    if (only && !only.includes(m.name)) continue;

    for (const platform of m.platforms) {
      const path = `apps/${m.name}/${platform}`;
      const affected = touched(
        (f) =>
          f.startsWith(`${path}/`) || // the app itself
          f === `apps/${m.name}/idea.yaml` || // its manifest (stage, platforms)
          f.startsWith(`packages/${platform}/`), // shared code for this platform
      );
      if (affected) result[platform].push({ idea: m.name, path, stage: m.stage, run_tests: TEST_STAGES.includes(m.stage) });
    }

    if (m.backend === "supabase") {
      const path = `apps/${m.name}/supabase`;
      // Generated client types live in the platform folders but are checked against this schema.
      const typeFiles = m.platforms.filter((p) => TYPE_TARGETS[p]).map((p) => `apps/${m.name}/${p}/${TYPE_TARGETS[p].file}`);
      const affected = touched((f) => f.startsWith(`${path}/`) || f === `apps/${m.name}/idea.yaml` || typeFiles.includes(f));
      if (affected) result.supabase.push({ idea: m.name, path, stage: m.stage });
    }
  }
  return { result, files, warning };
}
