// Run with: pnpm test   (node's built-in test runner; part of `pnpm verify`)
//
// Ideas are created and grown in a scratch apps/ folder, from the real templates.

import assert from "node:assert/strict";
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { loadIdea } from "./manifest.mjs";
import {
  applyGrowth,
  copyTemplate,
  createIdea,
  manifestText,
  nextSteps,
  planGrowth,
  render,
  shiftPorts,
  updateManifestText,
  usedPortSlots,
} from "./scaffold.mjs";
import { listTree, sha256 } from "./speckit.mjs";

const TIMESTAMP = "20260102030405";

const scratch = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "labs-scaffold-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const read = (...p) => readFileSync(join(...p), "utf8");
const snapshot = (dir) => Object.fromEntries(listTree(dir).map((f) => [f, sha256(join(dir, f))]));

const create = (appsDir, options = {}) =>
  createIdea(
    { name: "notes", title: "Field Notes", owner: "Someone", stage: "prototype", platforms: ["web"], backend: "supabase", timestamp: TIMESTAMP, ...options },
    { appsDir },
  );
/** Plans and, unless it is refused, applies. `invalid` is what validation says afterwards. */
const grow = (appsDir, request, name = "notes") => {
  const plan = planGrowth(name, request, { appsDir, timestamp: TIMESTAMP });
  return plan.errors.length > 0 ? plan : { ...plan, invalid: applyGrowth(plan) };
};
const manifest = (appsDir, name = "notes") => parse(read(appsDir, name, "idea.yaml"));

test("render fills in the tokens it knows and leaves the rest alone", () => {
  assert.equal(render("{{name}} on {{api_port}}, {{unknown}} and ${{ github.sha }}", { name: "notes", api_port: "44321" }), "notes on 44321, {{unknown}} and ${{ github.sha }}");
});

test("a template is copied with names and contents rendered, binaries and modes kept, package.json merged", (t) => {
  const dir = scratch(t);
  const [base, overlay, dest] = ["base", "overlay", "dest"].map((d) => join(dir, d));
  mkdirSync(join(base, "migrations"), { recursive: true });
  writeFileSync(join(base, "migrations", "{{timestamp}}_init.sql"), "-- {{name}}\n");
  writeFileSync(join(base, "icon.png"), "{{name}}");
  writeFileSync(join(base, "run.sh"), "#!/bin/sh\n", { mode: 0o755 });
  writeFileSync(join(base, "package.json"), JSON.stringify({ name: "@labs/{{name}}-web", dependencies: { react: "1", next: "1" }, scripts: { dev: "next dev" } }));
  mkdirSync(overlay);
  writeFileSync(join(overlay, "package.json"), JSON.stringify({ dependencies: { "@supabase/supabase-js": "2" }, scripts: { seed: "{{name}}" } }));
  writeFileSync(join(overlay, "run.sh"), "#!/bin/sh\necho {{name}}\n");

  const tokens = { name: "notes", timestamp: TIMESTAMP };
  copyTemplate(base, dest, tokens);
  assert.equal(read(dest, "migrations", `${TIMESTAMP}_init.sql`), "-- notes\n");
  assert.equal(read(dest, "icon.png"), "{{name}}", "a binary file is copied, not rendered");
  accessSync(join(dest, "run.sh"), constants.X_OK);

  copyTemplate(overlay, dest, tokens, { merge: true });
  const pkg = JSON.parse(read(dest, "package.json"));
  assert.equal(pkg.name, "@labs/notes-web");
  assert.deepEqual(Object.keys(pkg.dependencies), ["@supabase/supabase-js", "next", "react"], "dependencies are merged and sorted");
  assert.deepEqual(pkg.scripts, { dev: "next dev", seed: "notes" });
  assert.equal(read(dest, "run.sh"), "#!/bin/sh\necho notes\n", "anything but package.json is overwritten");
});

test("every idea with a backend gets its own block of ports, and a freed block is used again", (t) => {
  const appsDir = scratch(t);
  for (const name of ["one", "two", "three"].map((n) => `idea-${n}`)) create(appsDir, { name });
  assert.deepEqual([...usedPortSlots(appsDir)].sort(), [0, 1, 2]);
  assert.match(read(appsDir, "idea-two", "supabase", "config.toml"), /^\[api\]\n(.*\n)*?port = 44331$/m);
  assert.match(read(appsDir, "idea-two", "web", ".env.example"), /^NEXT_PUBLIC_SUPABASE_URL=http:\/\/127\.0\.0\.1:44331$/m);

  rmSync(join(appsDir, "idea-two"), { recursive: true });
  assert.equal(create(appsDir, { name: "idea-four" }).slot, 1);
  assert.equal(create(appsDir, { name: "idea-five", backend: "none" }).slot, null, "no backend, no ports");
  assert.equal(create(appsDir, { name: "idea-six", stage: "spark", platforms: [] }).slot, null, "a spark has no stack yet");
  assert.deepEqual([...usedPortSlots(appsDir)].sort(), [0, 1, 2]);
});

test("shifting ports moves the template's block and the inspector port, and nothing else", () => {
  const config = '[api]\nport = 54321\n[db]\nport = 54322\nshadow_port = 54320\n[edge_runtime]\ninspector_port = 8083\n[auth.email.smtp]\n# port = 587\nport = 2500\n';
  assert.equal(shiftPorts(config, 2), '[api]\nport = 44341\n[db]\nport = 44342\nshadow_port = 44340\n[edge_runtime]\ninspector_port = 48085\n[auth.email.smtp]\n# port = 587\nport = 2500\n');
});

test("updating a manifest changes the values and nothing else", () => {
  const fields = { name: "notes", title: "Field Notes", owner: "Someone" };
  const spark = manifestText({ ...fields, stage: "spark", platforms: [], backend: "none" });
  const grown = updateManifestText(spark, { stage: "prototype", platforms: ["web", "ios"], backend: "supabase" });
  // Byte for byte what `pnpm new` writes for those values: every comment and its alignment survived.
  assert.equal(grown, manifestText({ ...fields, stage: "prototype", platforms: ["web", "ios"], backend: "supabase" }));
  assert.equal(updateManifestText(spark, {}), spark);
});

test("a manifest written another way is still updated, and keeps its comments", () => {
  const text = 'name: notes\ntitle: "Notes # 2" # the second try\nstage: "spark" # on paper\nplatforms:\n  # where it runs\n  - web\nbackend: none\nowner: me\n';
  const out = updateManifestText(text, { stage: "prototype", platforms: ["web", "android"] });
  assert.deepEqual(parse(out), { name: "notes", title: "Notes # 2", stage: "prototype", platforms: ["web", "android"], backend: "none", owner: "me" });
  for (const comment of ["# the second try", "# on paper"]) assert.ok(out.includes(comment), comment);
});

test("a spark grown one step at a time ends as the same files as an idea created whole", (t) => {
  const [grownApps, wholeApps] = [scratch(t), scratch(t)];
  create(grownApps, { stage: "spark", platforms: [] });
  assert.ok(!existsSync(join(grownApps, "notes", "supabase")), "a spark has no stack");

  const first = grow(grownApps, { platforms: ["web"] });
  assert.deepEqual(first.errors, []);
  assert.deepEqual(first.invalid, []);
  assert.deepEqual([first.after.stage, first.createStack, first.slot], ["prototype", true, 0], "the first platform makes it a prototype, with its backend");
  assert.deepEqual(manifest(grownApps).platforms, ["web"]);

  const second = grow(grownApps, { platforms: ["ios", "android"] });
  assert.deepEqual([second.errors, second.invalid], [[], []]);
  assert.equal(second.createStack, false, "the stack is only created once");

  create(wholeApps, { platforms: ["web", "ios", "android"] });
  assert.deepEqual(snapshot(join(grownApps, "notes")), snapshot(join(wholeApps, "notes")));
  accessSync(join(grownApps, "notes", "android", "gradlew"), constants.X_OK);
});

test("a backend that arrives later brings its folder, a free port block and the overlay on every platform", (t) => {
  const [grownApps, wholeApps] = [scratch(t), scratch(t)];
  const all = ["web", "ios", "android"];
  for (const appsDir of [grownApps, wholeApps]) create(appsDir, { name: "other" }); // holds the first port block in both
  create(grownApps, { platforms: all, backend: "none" });
  assert.ok(!existsSync(join(grownApps, "notes", "android", "backend")));

  const r = grow(grownApps, { backend: "supabase" });
  assert.deepEqual([r.errors, r.invalid], [[], []]);
  assert.deepEqual([r.slot, r.apiPort, r.overlaid, r.replaced], [1, 44331, all, []]);
  assert.equal(manifest(grownApps).backend, "supabase");

  create(wholeApps, { platforms: all });
  assert.deepEqual(snapshot(join(grownApps, "notes")), snapshot(join(wholeApps, "notes")));
});

test("a platform added to an idea with a backend points at that idea's own stack", (t) => {
  const appsDir = scratch(t);
  create(appsDir, { name: "other" });
  create(appsDir); // the second block: 44331
  const r = grow(appsDir, { platforms: ["ios", "android"] });
  assert.deepEqual([r.errors, r.invalid], [[], []]);
  assert.deepEqual([r.createStack, r.schemaIsOlder, r.apiPort], [false, false, 44331]);
  assert.match(read(appsDir, "notes", "ios", "Config", "Debug.xcconfig"), /127\.0\.0\.1:44331$/m);
  assert.match(read(appsDir, "notes", "android", "local.properties.example"), /10\.0\.2\.2:44331/);
  assert.ok(existsSync(join(appsDir, "notes", "android", "backend", "build.gradle.kts")), "the new platform gets the overlay");
  assert.deepEqual([...usedPortSlots(appsDir)].sort(), [0, 1], "no new block is claimed");
});

test("a platform added after the schema moved on is flagged: its types are the template's", (t) => {
  const appsDir = scratch(t);
  create(appsDir);
  assert.equal(planGrowth("notes", { platforms: ["ios"] }, { appsDir }).schemaIsOlder, false, "another timestamp is still the same schema");
  writeFileSync(join(appsDir, "notes", "supabase", "migrations", "20260203040506_tags.sql"), "create table public.tags (id uuid primary key);\n");
  assert.equal(planGrowth("notes", { platforms: ["ios"] }, { appsDir }).schemaIsOlder, true);
});

test("what can not be done is refused before anything is written", (t) => {
  const appsDir = scratch(t);
  create(appsDir);
  const before = snapshot(appsDir);
  const refused = (request, pattern, name) => {
    const r = grow(appsDir, request, name);
    assert.match(r.errors.join("\n"), pattern);
    assert.deepEqual(snapshot(appsDir), before, `${pattern}: nothing was written`);
  };

  refused({ platforms: ["web"] }, /apps\/notes\/web already exists/);
  refused({ platforms: ["ios", "web"] }, /apps\/notes\/web already exists/); // one bad platform stops the good one too
  refused({ platforms: ["windows"] }, /unknown platform "windows"/);
  refused({ platforms: ["ios", "ios"] }, /duplicates/);
  refused({}, /nothing to add: apps\/notes has web and backend supabase/);
  refused({ backend: "supabase" }, /nothing to add/);
  refused({ backend: "none" }, /taking a backend away/);
  refused({ backend: "firebase" }, /^backend must be one of supabase, none$/);
  refused({ platforms: ["ios"] }, /apps\/ghost does not exist.*pnpm new ghost/, "ghost");
  refused({ platforms: ["ios"] }, /does not exist/, "../notes");

  rmSync(join(appsDir, "notes", "idea.md"));
  assert.match(grow(appsDir, { platforms: ["ios"] }).errors.join("\n"), /not valid as it is.*\n.*missing idea\.md/);
  assert.ok(!existsSync(join(appsDir, "notes", "ios")));
});

test("an edited file that the overlay replaces stops the backend, unless forced", (t) => {
  const appsDir = scratch(t);
  create(appsDir, { platforms: ["ios", "web"], backend: "none" });
  const edited = join(appsDir, "notes", "ios", "Config", "Debug.xcconfig");
  writeFileSync(edited, `${read(edited)}OTHER_SWIFT_FLAGS = -DMINE\n`);
  const before = snapshot(appsDir);

  const refused = grow(appsDir, { backend: "supabase" });
  assert.match(refused.errors.join("\n"), /were edited.*\n {2}- apps\/notes\/ios\/Config\/Debug\.xcconfig\n.*--force/);
  assert.equal(refused.errors.length, 3, "only the edited file is listed; the untouched ones are simply replaced");
  assert.deepEqual(snapshot(appsDir), before);

  // A supabase/ folder that the manifest does not know about is not adopted, forced or not.
  mkdirSync(join(appsDir, "notes", "supabase"));
  assert.match(grow(appsDir, { backend: "supabase", force: true }).errors.join("\n"), /apps\/notes\/supabase is already there, but it has no config\.toml/);
  writeFileSync(join(appsDir, "notes", "supabase", "config.toml"), "[api]\nport = 44321\n");
  assert.match(grow(appsDir, { backend: "supabase", force: true }).errors.join("\n"), /is already there, but idea\.yaml says backend: none/);
  rmSync(join(appsDir, "notes", "supabase"), { recursive: true });
  assert.deepEqual(snapshot(appsDir), before);

  const forced = grow(appsDir, { backend: "supabase", force: true });
  assert.deepEqual([forced.errors, forced.invalid], [[], []]);
  assert.deepEqual(forced.replaced, [join("ios", "Config", "Debug.xcconfig")]);
  assert.ok(!read(edited).includes("-DMINE"));
  assert.match(read(edited), /^SUPABASE_URL = /m);
});

test("a spark's backend is a declaration: its folder arrives with the first platform, or never", (t) => {
  const appsDir = scratch(t);
  create(appsDir, { stage: "spark", platforms: [], backend: "none" });
  const declared = grow(appsDir, { backend: "supabase" });
  assert.deepEqual([declared.errors, declared.invalid], [[], []]);
  assert.deepEqual([declared.after.stage, declared.createStack], ["spark", false]);
  assert.equal(manifest(appsDir).backend, "supabase");
  assert.ok(!existsSync(join(appsDir, "notes", "supabase")));

  // A spark may list where it wants to run. Those platforms are stamped out, not listed twice,
  // and none of them may be left behind once it is a prototype.
  writeFileSync(join(appsDir, "notes", "idea.yaml"), read(appsDir, "notes", "idea.yaml").replace("platforms: []", "platforms: [web, ios]"));
  assert.deepEqual(loadIdea("notes", appsDir).errors, []);
  assert.match(grow(appsDir, { platforms: ["android"] }).errors.join("\n"), /already lists web, ios.*--platforms web,ios,android/);
  assert.ok(!existsSync(join(appsDir, "notes", "android")));
  writeFileSync(join(appsDir, "notes", "idea.yaml"), read(appsDir, "notes", "idea.yaml").replace("platforms: [web, ios]", "platforms: [web]"));

  // Changing its mind is fine while there is nothing to take away.
  const web = grow(appsDir, { platforms: ["web"], backend: "none" });
  assert.deepEqual([web.errors, web.invalid], [[], []]);
  assert.deepEqual(manifest(appsDir), { ...manifest(appsDir), stage: "prototype", platforms: ["web"], backend: "none" });
  assert.ok(!existsSync(join(appsDir, "notes", "supabase")));
  assert.ok(!existsSync(join(appsDir, "notes", "web", "src", "lib", "supabase.ts")), "no backend, no overlay");
});

test("ios and android need the idea's bundle id, and use it", (t) => {
  const appsDir = scratch(t);
  create(appsDir, { backend: "none" });
  const file = join(appsDir, "notes", "idea.yaml");
  const original = read(file);

  writeFileSync(file, original.replace(/^bundle_id:.*\n/m, ""));
  assert.deepEqual(loadIdea("notes", appsDir).errors, [], "a web idea is valid without one");
  assert.match(grow(appsDir, { platforms: ["android"] }).errors.join("\n"), /needs a bundle_id \(for example to\.labs\.notes\)/);

  writeFileSync(file, original.replace(/^bundle_id: \S+/m, "bundle_id: com.example.fieldnotes"));
  assert.deepEqual(grow(appsDir, { platforms: ["android"] }).invalid, []);
  assert.match(read(appsDir, "notes", "android", "app", "build.gradle.kts"), /applicationId = "com\.example\.fieldnotes"/);
});

test("the next steps are numbered in order and only name what was added", () => {
  const created = nextSteps({ name: "notes", intro: true, stamped: ["web", "ios"], backendFor: ["web", "ios"], apiPort: 44331 });
  assert.deepEqual(created.slice(0, -1).map((l) => l.match(/^ {2}(\d+)\. /)?.[1]), ["1", "2", "3", "4", "5", "6", "7", "8"]);
  assert.match(created[3], /pnpm sb notes start .*ports 44330-44339/);
  assert.match(created.at(-1), /Verify locally before pushing/);

  const grown = nextSteps({ name: "notes", stamped: ["android"], backendFor: ["android"], apiPort: 44331, schemaIsOlder: true }).join("\n");
  assert.match(grown, /Models\.kt by hand/);
  assert.ok(!/idea\.md|pnpm install|pnpm types|pnpm ios/.test(grown), grown);
  assert.match(nextSteps({ name: "notes", stamped: ["ios"], backendFor: ["ios"], apiPort: 44331, schemaIsOlder: true }).join("\n"), /pnpm types notes/);
  assert.equal(nextSteps({ name: "notes", stamped: ["android"] }).length, 2, "no backend: open it, then commit");
});
