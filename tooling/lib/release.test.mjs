// Run with: pnpm test   (node's built-in test runner; part of `pnpm verify`)

import assert from "node:assert/strict";
import { test } from "node:test";
import { bumpVersion, compareVersions, nextVersion, parseVersion, tagFor, versionsFromTags } from "./release.mjs";

test("parseVersion accepts plain semver only", () => {
  assert.deepEqual(parseVersion("1.2.3"), [1, 2, 3]);
  assert.deepEqual(parseVersion("0.10.0"), [0, 10, 0]);
  for (const bad of ["1.2", "v1.2.3", "1.2.3-beta", "01.2.3", "1.2.3.4", "", "x"]) {
    assert.equal(parseVersion(bad), null, bad);
  }
});

test("compareVersions orders numerically, not as text", () => {
  assert.equal(compareVersions("0.9.0", "0.10.0"), -1);
  assert.equal(compareVersions("1.0.0", "0.99.99"), 1);
  assert.equal(compareVersions("2.3.4", "2.3.4"), 0);
});

test("bumpVersion resets the lower parts", () => {
  assert.equal(bumpVersion("1.2.3", "patch"), "1.2.4");
  assert.equal(bumpVersion("1.2.3", "minor"), "1.3.0");
  assert.equal(bumpVersion("1.2.3", "major"), "2.0.0");
});

test("versionsFromTags keeps only this idea and platform, in order", () => {
  const tags = [
    "notes/ios/v0.10.0",
    "notes/ios/v0.2.0",
    "notes/android/v9.9.9", // another platform
    "notes-pro/ios/v5.0.0", // another idea with a shared prefix
    "notes/ios/v1.0.0-beta", // not a release
    "notes/ios/latest",
    "v3.0.0",
  ];
  assert.deepEqual(versionsFromTags(tags, "notes", "ios"), ["0.2.0", "0.10.0"]);
  assert.deepEqual(versionsFromTags(tags, "notes", "web"), []);
});

test("a first release is 0.1.0, later ones bump the latest", () => {
  assert.deepEqual(nextVersion({ latest: null }), { version: "0.1.0" });
  assert.deepEqual(nextVersion({ latest: null, bump: "major" }), { version: "0.1.0" });
  assert.deepEqual(nextVersion({ latest: "0.1.0" }), { version: "0.1.1" });
  assert.deepEqual(nextVersion({ latest: "0.1.4", bump: "minor" }), { version: "0.2.0" });
});

test("an explicit version must be valid and above the latest", () => {
  assert.deepEqual(nextVersion({ latest: "0.3.0", explicit: "1.0.0" }), { version: "1.0.0" });
  assert.match(nextVersion({ latest: "0.3.0", explicit: "0.3.0" }).error, /not above/);
  assert.match(nextVersion({ latest: "0.3.0", explicit: "0.2.9" }).error, /not above/);
  assert.match(nextVersion({ latest: null, explicit: "one" }).error, /1\.2\.3/);
  assert.match(nextVersion({ latest: "0.1.0", bump: "huge" }).error, /--bump/);
});

test("tags are <idea>/<platform>/vX.Y.Z", () => {
  assert.equal(tagFor("notes", "ios", "1.2.3"), "notes/ios/v1.2.3");
});
