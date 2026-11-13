// Shared reader/validator for apps/<idea>/idea.yaml.
// Every other tool (generator, CI planner, release scripts) goes through this
// file, so the manifest format is defined in exactly one place.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const APPS_DIR = join(ROOT, "apps");
export const TEMPLATES_DIR = join(ROOT, "templates");

export const PLATFORMS = ["web", "ios", "android"];
export const STAGES = ["spark", "prototype", "alpha", "live", "archived"];
export const BACKENDS = ["supabase", "none"];

// Where `supabase gen types` output is committed, per platform, relative to
// apps/<idea>/<platform>/. The CLI cannot emit Kotlin: Android models are
// written by hand. The Swift file sits in a Generated/ folder, which the iOS
// formatter skips.
export const TYPE_TARGETS = {
  web: { lang: "typescript", file: "src/lib/database.types.ts" },
  ios: { lang: "swift", file: "Sources/Backend/Generated/Database.swift" },
};

// `spark` is an idea on paper (idea.md only); `archived` is parked. Neither gets CI.
export const ACTIVE_STAGES = ["prototype", "alpha", "live"];
// Tests are a required gate from `alpha` on. Prototypes only lint, typecheck and build.
export const TEST_STAGES = ["alpha", "live"];

const KNOWN_KEYS = ["name", "title", "stage", "platforms", "backend", "owner", "bundle_id"];
const NAME_RE = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
// Valid as an iOS bundle id and as an Android applicationId (no hyphens).
const BUNDLE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export function isValidName(name) {
  return typeof name === "string" && NAME_RE.test(name);
}

export function defaultBundleId(name) {
  return `to.labs.${name.replaceAll("-", "")}`;
}

export function loadIdeas() {
  if (!existsSync(APPS_DIR)) return [];
  return readdirSync(APPS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => loadIdea(e.name));
}

export function loadIdea(dirName) {
  const dir = join(APPS_DIR, dirName);
  const file = join(dir, "idea.yaml");
  const errors = [];
  let manifest = null;

  if (!existsSync(file)) {
    errors.push("missing idea.yaml");
  } else {
    try {
      manifest = parse(readFileSync(file, "utf8"));
    } catch (e) {
      errors.push(`idea.yaml is not valid YAML: ${e.message}`);
    }
    if (manifest === null && errors.length === 0) {
      errors.push("idea.yaml is empty");
    }
    if (manifest !== null && (typeof manifest !== "object" || Array.isArray(manifest))) {
      errors.push("idea.yaml must be a mapping of fields");
      manifest = null;
    }
  }

  if (manifest !== null) {
    errors.push(...validateManifest(manifest, dirName, dir));
  }
  return { dirName, dir, manifest, errors };
}

export function validateManifest(m, dirName, dir) {
  const errors = [];

  for (const key of Object.keys(m)) {
    if (!KNOWN_KEYS.includes(key)) errors.push(`unknown field "${key}"`);
  }

  if (!isValidName(m.name)) {
    errors.push(`name must be kebab-case, 3-40 chars, starting with a letter (got ${JSON.stringify(m.name)})`);
  } else if (m.name !== dirName) {
    errors.push(`name "${m.name}" must match its folder "apps/${dirName}"`);
  }

  if (typeof m.title !== "string" || m.title.trim() === "") errors.push("title is required");
  if (typeof m.owner !== "string" || m.owner.trim() === "") errors.push("owner is required");
  if (!STAGES.includes(m.stage)) errors.push(`stage must be one of ${STAGES.join(", ")} (got ${JSON.stringify(m.stage)})`);

  const platforms = Array.isArray(m.platforms) ? m.platforms : null;
  if (platforms === null) {
    errors.push("platforms must be a list (use [] for a spark)");
  } else {
    for (const p of platforms) {
      if (!PLATFORMS.includes(p)) errors.push(`unknown platform ${JSON.stringify(p)} (use ${PLATFORMS.join(", ")})`);
    }
    if (new Set(platforms).size !== platforms.length) errors.push("platforms contains duplicates");
    if (ACTIVE_STAGES.includes(m.stage) && platforms.length === 0) {
      errors.push(`stage "${m.stage}" needs at least one platform`);
    }
    if (m.stage !== "spark") {
      for (const p of platforms) {
        if (PLATFORMS.includes(p) && !existsSync(join(dir, p))) {
          errors.push(`platforms lists "${p}" but apps/${dirName}/${p}/ does not exist`);
        }
      }
    }
    if (platforms.some((p) => p === "ios" || p === "android")) {
      if (typeof m.bundle_id !== "string" || !BUNDLE_RE.test(m.bundle_id)) {
        errors.push(`bundle_id must be reverse-DNS like to.labs.myidea (got ${JSON.stringify(m.bundle_id)})`);
      }
    }
  }

  if (!BACKENDS.includes(m.backend)) {
    errors.push(`backend must be one of ${BACKENDS.join(", ")} (got ${JSON.stringify(m.backend)})`);
  } else if (m.backend === "supabase" && m.stage !== "spark" && !existsSync(join(dir, "supabase", "config.toml"))) {
    errors.push(`backend is supabase but apps/${dirName}/supabase/config.toml does not exist`);
  }

  if (!existsSync(join(dir, "idea.md"))) errors.push("missing idea.md");
  return errors;
}
