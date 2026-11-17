// Run with: pnpm test   (node's built-in test runner; part of `pnpm verify`)

import assert from "node:assert/strict";
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT, SPECKIT_CONSTITUTION, constitutionIsTemplate, specKitErrors } from "./manifest.mjs";
import { CONSTITUTION_TEMPLATE, KIT_DIR, installSpecKit, kitVersion, listTree, manifestFiles, sha256 } from "./speckit.mjs";

const scratch = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "labs-speckit-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const read = (...p) => readFileSync(join(...p), "utf8");

test("the vendored kit is the unedited output of specify init", () => {
  assert.match(kitVersion() ?? "", /^\d+\.\d+\.\d+/, "templates/speckit/kit records the Spec Kit version it came from");
  const recorded = manifestFiles(KIT_DIR);
  assert.ok(Object.keys(recorded).length > 10, "Spec Kit's own manifests list the installed files");
  for (const [file, hash] of Object.entries(recorded)) {
    assert.ok(existsSync(join(KIT_DIR, file)), `${file} is listed in a manifest but missing from the kit`);
    assert.equal(sha256(join(KIT_DIR, file)), hash, `${file} was edited by hand. Regenerate with: pnpm speckit --refresh-template`);
  }
});

test("the kit is set up for Claude, with bash scripts and no git extension", () => {
  const options = JSON.parse(read(KIT_DIR, ".specify", "init-options.json"));
  assert.equal(options.integration, "claude");
  assert.equal(options.script, "sh");
  // The git extension would create a branch per feature; this repository has its own branch and verify flow.
  assert.ok(!existsSync(join(KIT_DIR, ".specify", "extensions")), "no Spec Kit extensions are installed");
  for (const step of ["specify", "clarify", "plan", "tasks", "implement", "constitution"]) {
    assert.ok(existsSync(join(KIT_DIR, ".claude", "skills", `speckit-${step}`, "SKILL.md")), `speckit-${step}`);
  }
});

test("Spec Kit lives in each idea, never at the repository root", () => {
  // Its scripts take the nearest folder with .specify/ as the project. One at the root
  // would capture every command that is not run from inside an idea.
  assert.ok(!existsSync(join(ROOT, ".specify")), "there is a .specify/ at the repository root");
});

test("our constitution template is filled in, apart from the tokens the generator replaces", () => {
  const text = read(CONSTITUTION_TEMPLATE);
  assert.ok(!constitutionIsTemplate(text), "no Spec Kit placeholder is left");
  assert.deepEqual([...new Set(text.match(/\{\{\w+\}\}/g))].sort(), ["{{date}}", "{{name}}", "{{title}}"]);
  assert.match(text, /^\*\*Version\*\*: 1\.0\.0 \| \*\*Ratified\*\*: \{\{date\}\} \| \*\*Last Amended\*\*: \{\{date\}\}$/m);
});

test("installing makes a folder a Spec Kit project with a ratified constitution", (t) => {
  const dir = scratch(t);
  assert.match(specKitErrors(dir, "notes")[0], /not a Spec Kit project .*Run: pnpm speckit notes/);

  const r = installSpecKit(dir, { name: "notes", title: "Field Notes", date: "2026-01-02" });
  assert.deepEqual({ ...r, version: null }, { version: null, constitution: "written", removed: [] });
  assert.deepEqual(specKitErrors(dir, "notes"), []);

  const constitution = read(dir, SPECKIT_CONSTITUTION);
  assert.match(constitution, /^# Field Notes Constitution$/m);
  assert.match(constitution, /pnpm verify notes/);
  assert.match(constitution, /\*\*Ratified\*\*: 2026-01-02/);
  assert.ok(!/\{\{|\}\}/.test(constitution), "every token was replaced");

  // Everything else is the kit, byte for byte, and the scripts stay executable.
  const kit = listTree(KIT_DIR).filter((f) => !f.startsWith(".specify/memory/"));
  assert.deepEqual(listTree(dir).filter((f) => f !== SPECKIT_CONSTITUTION), kit);
  for (const f of kit) assert.equal(sha256(join(dir, f)), sha256(join(KIT_DIR, f)), f);
  accessSync(join(dir, ".specify", "scripts", "bash", "check-prerequisites.sh"), constants.X_OK);
});

test("an unfilled constitution fails validation, and installing again replaces it", (t) => {
  const dir = scratch(t);
  installSpecKit(dir, { name: "notes", title: "Notes" });
  writeFileSync(join(dir, SPECKIT_CONSTITUTION), read(KIT_DIR, ".specify", "memory", "constitution.md"));
  assert.match(specKitErrors(dir, "notes")[0], /still the unfilled template/);
  rmSync(join(dir, SPECKIT_CONSTITUTION));
  assert.match(specKitErrors(dir, "notes")[0], /constitution\.md is missing/);

  assert.equal(installSpecKit(dir, { name: "notes", title: "Notes" }).constitution, "written");
  assert.deepEqual(specKitErrors(dir, "notes"), []);
});

test("refreshing an idea replaces kit files and keeps what is the idea's own", (t) => {
  const dir = scratch(t);
  installSpecKit(dir, { name: "notes", title: "Notes" });

  const amended = `${read(dir, SPECKIT_CONSTITUTION)}\n### VI. Offline First\n`;
  writeFileSync(join(dir, SPECKIT_CONSTITUTION), amended);
  mkdirSync(join(dir, "specs", "001-capture"), { recursive: true });
  writeFileSync(join(dir, "specs", "001-capture", "spec.md"), "# Capture\n");
  writeFileSync(join(dir, ".specify", "feature.json"), '{"feature_directory":"specs/001-capture"}\n');

  // A kit file edited in the idea, one deleted, and one that a newer kit no longer ships.
  const script = join(dir, ".specify", "scripts", "bash", "common.sh");
  writeFileSync(script, "# edited\n");
  rmSync(join(dir, ".claude", "skills", "speckit-plan", "SKILL.md"));
  const dropped = ".claude/skills/speckit-retired/SKILL.md";
  mkdirSync(join(dir, ".claude", "skills", "speckit-retired"), { recursive: true });
  writeFileSync(join(dir, dropped), "old\n");
  const manifest = join(dir, ".specify", "integrations", "claude.manifest.json");
  const recorded = JSON.parse(readFileSync(manifest, "utf8"));
  recorded.files[dropped] = "0";
  recorded.files["specs/001-capture/spec.md"] = "0"; // a manifest can not make a refresh delete the idea's own files
  recorded.files[".specify/scripts/../../idea.md"] = "0";
  writeFileSync(join(dir, "idea.md"), "# Notes\n");
  writeFileSync(manifest, JSON.stringify(recorded));

  const r = installSpecKit(dir, { name: "notes", title: "Notes" });
  assert.equal(r.constitution, "kept");
  assert.deepEqual(r.removed, [dropped]);
  assert.equal(read(dir, SPECKIT_CONSTITUTION), amended);
  assert.equal(read(dir, "specs", "001-capture", "spec.md"), "# Capture\n");
  assert.ok(existsSync(join(dir, ".specify", "feature.json")), "the pointer to the current feature is machine-local state, left alone");
  assert.equal(sha256(script), sha256(join(KIT_DIR, ".specify", "scripts", "bash", "common.sh")));
  assert.ok(existsSync(join(dir, ".claude", "skills", "speckit-plan", "SKILL.md")));
  assert.ok(!existsSync(join(dir, dropped)));
  assert.ok(existsSync(join(dir, "idea.md")));
});
