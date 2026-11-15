// The decisions behind `pnpm doctor`, kept apart from the probing so they can be tested.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACTIVE_STAGES, APPS_DIR } from "./manifest.mjs";

/** The manifests of ideas that get checks (not sparks, not archived). */
export const activeManifests = (ideas) => ideas.filter((i) => i.errors.length === 0 && ACTIVE_STAGES.includes(i.manifest.stage)).map((i) => i.manifest);

/**
 * Which toolchains does this checkout need right now? With no ideas yet, a new one
 * defaults to web + Supabase, so Docker is expected; iOS and Android only when an
 * idea (or `--for`) asks for them.
 */
export function needs(manifests, forTargets = []) {
  const any = (pred) => manifests.some(pred);
  return {
    supabase: manifests.length === 0 || any((m) => m.backend === "supabase"),
    ios: forTargets.includes("ios") || any((m) => m.platforms.includes("ios")),
    android: forTargets.includes("android") || any((m) => m.platforms.includes("android")),
  };
}

const TEAM_LINE_RE = /^\s*DEVELOPMENT_TEAM\s*=\s*[A-Za-z0-9]+/m;

export const readLocalXcconfig = (idea) => {
  try {
    return readFileSync(join(APPS_DIR, idea, "ios", "Config", "Local.xcconfig"), "utf8");
  } catch {
    return null;
  }
};

/**
 * Is an Apple developer team known? `LABS_APPLE_TEAM_ID` covers every idea; otherwise each
 * iOS idea needs DEVELOPMENT_TEAM in its own untracked Config/Local.xcconfig.
 * @returns {{ ok: boolean, note: string }}
 */
export function teamStatus({ env, iosIdeas, read = readLocalXcconfig }) {
  if (typeof env.LABS_APPLE_TEAM_ID === "string" && env.LABS_APPLE_TEAM_ID.trim() !== "") return { ok: true, note: "LABS_APPLE_TEAM_ID" };
  const without = iosIdeas.filter((name) => !TEAM_LINE_RE.test(read(name) ?? ""));
  if (iosIdeas.length > 0 && without.length === 0) return { ok: true, note: "DEVELOPMENT_TEAM in each idea's Local.xcconfig" };
  const lacking = without.length > 0 ? ` (no team yet for: ${without.join(", ")})` : "";
  return { ok: false, note: `no Apple developer team. Set LABS_APPLE_TEAM_ID in .env.labs, which covers every iOS idea${lacking}` };
}
