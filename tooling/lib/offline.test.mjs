// Run with: pnpm test   (node's built-in test runner; part of `pnpm verify`)
//
// A `network: none` idea is created from the real templates and then made to break its promise.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { loadIdea, networkOf, validateManifest } from "./manifest.mjs";
import { mergedManifestViolations, offlineViolations } from "./offline.mjs";
import { createIdea, planGrowth } from "./scaffold.mjs";
import { CONSTITUTION_TEMPLATE, OFFLINE_CONSTITUTION_TEMPLATE } from "./speckit.mjs";
import { SPECKIT_CONSTITUTION, constitutionIsTemplate } from "./manifest.mjs";

const scratch = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "labs-offline-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const read = (...p) => readFileSync(join(...p), "utf8");
const put = (file, text) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};
const offline = (appsDir, platforms = ["web", "ios", "android"]) =>
  createIdea({ name: "scan", title: "Scan", owner: "Someone", stage: "prototype", platforms, backend: "none", network: "none" }, { appsDir });

test("an idea that does not say is online, and network is validated", () => {
  assert.equal(networkOf({}), "online");
  assert.equal(networkOf({ network: "none" }), "none");
  const base = { name: "scan", title: "Scan", owner: "x", stage: "spark", platforms: [], backend: "none" };
  assert.deepEqual(validateManifest({ ...base, network: "none" }, "scan", "/nowhere").filter((e) => /network/.test(e)), []);
  assert.match(validateManifest({ ...base, network: "offline" }, "scan", "/nowhere").join("\n"), /network must be one of online, none/);
  assert.match(validateManifest({ ...base, backend: "supabase", network: "none" }, "scan", "/nowhere").join("\n"), /backend must be none/);
});

test("the templates themselves make no network call: a fresh offline idea passes the guard on every platform", (t) => {
  const appsDir = scratch(t);
  offline(appsDir);
  const idea = loadIdea("scan", appsDir);
  assert.deepEqual(idea.errors, []);
  assert.equal(idea.manifest.network, "none");
  assert.deepEqual(offlineViolations(idea.dir, idea.manifest), []);
});

test("an offline idea cannot be created with a backend, nor given one later", (t) => {
  const appsDir = scratch(t);
  assert.throws(() => createIdea({ name: "scan", title: "Scan", owner: "x", stage: "prototype", platforms: ["web"], backend: "supabase", network: "none" }, { appsDir }), /no network call at all.*--backend none/);
  offline(appsDir, ["ios"]);
  const plan = planGrowth("scan", { backend: "supabase" }, { appsDir });
  assert.match(plan.errors.join("\n"), /network: none/);
});

test("an offline idea starts from the offline constitution, and both are filled in", (t) => {
  const appsDir = scratch(t);
  offline(appsDir, ["ios"]);
  const text = read(appsDir, "scan", SPECKIT_CONSTITUTION);
  assert.match(text, /### IV\. No Network, Ever/);
  assert.ok(!/Supabase/.test(text), "no backend is mentioned");
  assert.ok(!/\{\{|\}\}/.test(text));
  for (const f of [CONSTITUTION_TEMPLATE, OFFLINE_CONSTITUTION_TEMPLATE]) {
    const template = read(f);
    assert.ok(!constitutionIsTemplate(template), f);
    assert.deepEqual([...new Set(template.match(/\{\{\w+\}\}/g))].sort(), ["{{date}}", "{{name}}", "{{title}}"], f);
  }
  assert.match(read(appsDir, "scan", "idea.yaml"), /^network: none/m);
  assert.equal(parse(read(appsDir, "scan", "idea.yaml")).network, "none");
});

test("every way a network call gets in is caught, and a marked line is not", (t) => {
  const appsDir = scratch(t);
  offline(appsDir);
  const { dir, manifest } = loadIdea("scan", appsDir);
  const rules = (cases) => {
    for (const [file, add, rule] of cases) {
      const path = join(dir, file);
      const was = read(path);
      writeFileSync(path, `${was}\n${add}\n`);
      assert.ok(offlineViolations(dir, manifest).some((v) => v.file === file && new RegExp(rule).test(v.rule)), `${file}: ${add}`);
      writeFileSync(path, was);
    }
  };
  rules([
    ["ios/Sources/Greeting.swift", "let s = URLSession.shared", "networking API"],
    ["ios/Sources/Greeting.swift", "import Network", "networking API"],
    ["ios/project.yml", "NSAppTransportSecurity: {}", "networking setting"],
    ["android/app/src/main/AndroidManifest.xml", '<uses-permission android:name="android.permission.INTERNET" />', "permission"],
    ["android/app/src/main/kotlin/to/labs/idea/Greeting.kt", "val c = okhttp3.OkHttpClient()", "networking API"],
    ["android/app/build.gradle.kts", 'dependencies { implementation("io.github.jan-tennert.supabase:postgrest-kt:3") }', "dependency"],
    ["web/src/lib/greeting.ts", 'export const x = () => fetch("/api");', "networking API"],
    ["web/package.json", '{ "dependencies": { "axios": "1" } }', "dependency"],
  ]);

  // A line marked as deliberate is not reported; a test file is not shipped.
  put(join(dir, "ios/Sources/Marked.swift"), "let s = URLSession.shared // labs:allow-network\n");
  put(join(dir, "ios/Tests/Unit/Net.swift"), "let s = URLSession.shared\n");
  assert.deepEqual(offlineViolations(dir, manifest), []);

  // A backend folder is a violation by itself.
  put(join(dir, "supabase/config.toml"), "");
  assert.deepEqual(offlineViolations(dir, manifest).map((v) => v.file), ["supabase/"]);
});

test("the merged Android manifest is read, including a permission a library added", (t) => {
  const dir = scratch(t);
  assert.deepEqual(mergedManifestViolations(dir), { found: 0, violations: [] });
  const merged = join(dir, "app/build/intermediates/merged_manifest/debug/processDebugMainManifest/AndroidManifest.xml");
  put(merged, '<manifest><uses-permission android:name="android.permission.CAMERA"/></manifest>');
  put(join(dir, "app/build/intermediates/merged_manifest/debugAndroidTest/AndroidManifest.xml"), '<uses-permission android:name="android.permission.INTERNET"/>');
  assert.deepEqual(mergedManifestViolations(dir), { found: 1, violations: [] });
  put(merged, '<manifest><uses-permission android:name="android.permission.INTERNET"/></manifest>');
  const r = mergedManifestViolations(dir);
  assert.equal(r.violations.length, 1);
  assert.match(r.violations[0].rule, /android\.permission\.INTERNET/);
});
