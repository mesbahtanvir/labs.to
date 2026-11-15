// Run with: pnpm test   (node's built-in test runner; part of `pnpm verify`)

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTag, parseTagMessage, previousVersion } from "./release.mjs";
import { formatNotes, pathsFor } from "./release-notes.mjs";

test("parseTag accepts exactly the tags pnpm release makes", () => {
  assert.deepEqual(parseTag("notes/ios/v0.2.1"), { idea: "notes", platform: "ios", version: "0.2.1" });
  assert.deepEqual(parseTag("my-idea/web/v10.0.3"), { idea: "my-idea", platform: "web", version: "10.0.3" });
  for (const bad of ["v1.0.0", "notes/ios/v1.0", "notes/ios/1.0.0", "notes/ios/v1.0.0-beta", "notes/desktop/v1.0.0", "Notes/ios/v1.0.0", "a/ios/v1.0.0", "notes/ios/v01.0.0", "x/notes/ios/v1.0.0", ""]) {
    assert.equal(parseTag(bad), null, bad);
  }
});

test("parseTagMessage reads what pnpm release wrote", () => {
  const tree = "a".repeat(40);
  assert.deepEqual(parseTagMessage(`notes ios 0.2.0 (build 17)\n\nstage: alpha\ntree: ${tree}`), { build: 17, stage: "alpha", tree });
  assert.deepEqual(parseTagMessage("a commit message"), { build: null, stage: null, tree: null });
});

test("previousVersion is the highest one below, by number", () => {
  const tags = ["notes/ios/v0.9.0", "notes/ios/v0.10.0", "notes/ios/v0.2.0", "notes/android/v5.0.0", "other/ios/v9.0.0"];
  assert.equal(previousVersion(tags, "notes", "ios", "0.10.0"), "0.9.0");
  assert.equal(previousVersion(tags, "notes", "ios", "1.0.0"), "0.10.0");
  assert.equal(previousVersion(tags, "notes", "ios", "0.2.0"), null);
  assert.equal(previousVersion(tags, "notes", "web", "0.1.0"), null);
});

test("an idea's release covers its platform, its backend and the shared code", () => {
  assert.deepEqual(pathsFor({ idea: "notes", platform: "ios" }), ["apps/notes/ios", "apps/notes/supabase", "apps/notes/idea.yaml", "packages/ios"]);
});

const commits = [
  { sha: "c3", subject: "Add sharing" },
  { sha: "b2", subject: "Fix the empty state" },
];

test("release notes name the version, the stage and the changes", () => {
  const notes = formatNotes({ idea: "notes", platform: "ios", version: "0.2.0", build: 17, stage: "alpha", previous: "0.1.0", commits });
  assert.match(notes, /\*\*notes\*\* for ios, version 0.2.0 \(build 17\), stage alpha\./);
  assert.match(notes, /Changes since 0\.1\.0:/);
  assert.match(notes, /- Add sharing \(`c3`\)\n- Fix the empty state \(`b2`\)/);
});

test("a first release says so, and a release with no changes says that", () => {
  assert.match(formatNotes({ idea: "n", platform: "web", version: "0.1.0", previous: null, commits }), /First release\. Everything so far:/);
  assert.match(formatNotes({ idea: "n", platform: "web", version: "0.1.0", previous: null, commits: [] }), /^First release\.$/m);
  assert.match(formatNotes({ idea: "n", platform: "web", version: "0.1.1", previous: "0.1.0", commits: [] }), /No changes to this app's files since 0\.1\.0\./);
});

test("a long history is cut off", () => {
  const many = Array.from({ length: 45 }, (_, i) => ({ sha: `s${i}`, subject: `change ${i}` }));
  const notes = formatNotes({ idea: "n", platform: "ios", version: "0.2.0", previous: "0.1.0", commits: many });
  assert.equal(notes.split("\n").filter((l) => l.startsWith("- change")).length, 40);
  assert.match(notes, /- and 5 more/);
});
