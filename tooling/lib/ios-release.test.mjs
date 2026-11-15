// Run with: pnpm test   (node's built-in test runner; part of `pnpm verify`)

import assert from "node:assert/strict";
import { test } from "node:test";
import { archiveProblems, credentialProblems, exportOptions, settingsProblems, signingArgs, teamId } from "./ios-release.mjs";

const supabase = { name: "notes", bundle_id: "to.labs.notes", backend: "supabase" };
const plain = { name: "notes", bundle_id: "to.labs.notes", backend: "none" };
const good = { PRODUCT_BUNDLE_IDENTIFIER: "to.labs.notes", SUPABASE_URL: "https://abcd.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x", DEVELOPMENT_TEAM: "TEAM123456" };

test("a complete Release configuration has no problems", () => {
  assert.deepEqual(settingsProblems({ settings: good, manifest: supabase, needTeam: true, env: {} }), []);
});

test("a wrong bundle identifier is caught", () => {
  const p = settingsProblems({ settings: { ...good, PRODUCT_BUNDLE_IDENTIFIER: "com.example.x" }, manifest: supabase, needTeam: false, env: {} });
  assert.equal(p.length, 1);
  assert.match(p[0], /bundle identifier/);
});

test("an empty or local Supabase address blocks a release", () => {
  const bad = [
    ["", /no SUPABASE_URL/],
    ["http://127.0.0.1:44321", /https URL/],
    ["https://127.0.0.1:44321", /local address/],
    ["https://localhost", /local address/],
    ["https://10.0.2.2", /local address/],
    ["https://192.168.1.20:8000", /local address/],
    ["https://mymac.local", /local address/],
    ["not a url", /https URL/],
  ];
  for (const [url, expected] of bad) {
    const p = settingsProblems({ settings: { ...good, SUPABASE_URL: url }, manifest: supabase, needTeam: false, env: {} });
    assert.ok(p.some((m) => expected.test(m)), `${url} -> ${p.join(" | ")}`);
  }
});

test("a missing publishable key blocks a release", () => {
  const p = settingsProblems({ settings: { ...good, SUPABASE_PUBLISHABLE_KEY: "" }, manifest: supabase, needTeam: false, env: {} });
  assert.ok(p.some((m) => /SUPABASE_PUBLISHABLE_KEY/.test(m)));
});

test("an idea without a backend is not asked for Supabase settings", () => {
  assert.deepEqual(settingsProblems({ settings: { PRODUCT_BUNDLE_IDENTIFIER: "to.labs.notes" }, manifest: plain, needTeam: false, env: {} }), []);
});

test("the team comes from the environment first, then the build settings", () => {
  assert.equal(teamId({ settings: { DEVELOPMENT_TEAM: "FROMXCCONF" }, env: { LABS_APPLE_TEAM_ID: "FROMENV" } }), "FROMENV");
  assert.equal(teamId({ settings: { DEVELOPMENT_TEAM: "FROMXCCONF" }, env: {} }), "FROMXCCONF");
  assert.equal(teamId({ settings: {}, env: {} }), null);
  const p = settingsProblems({ settings: { ...good, DEVELOPMENT_TEAM: "" }, manifest: supabase, needTeam: true, env: {} });
  assert.ok(p.some((m) => /developer team/.test(m)));
});

test("credential problems name what is missing and never print a value", () => {
  const p = credentialProblems({ HOME: "/nonexistent" });
  assert.equal(p.length, 3);
  assert.ok(p.some((m) => /ASC_KEY_ID/.test(m)));
  assert.ok(p.some((m) => /ASC_ISSUER_ID/.test(m)));
  assert.ok(p.some((m) => /no API key file/.test(m)));
  const withSecret = credentialProblems({ ASC_KEY_ID: "K", ASC_ISSUER_ID: "I", ASC_KEY_OP_REF: "not-a-reference" });
  assert.equal(withSecret.length, 1);
  assert.match(withSecret[0], /op:\/\//);
});

test("export options sign for the App Store, upload, and keep our build number", () => {
  const alpha = exportOptions({ team: "TEAM123456", internalOnly: true });
  assert.match(alpha, /<key>method<\/key>\s*<string>app-store-connect<\/string>/);
  assert.match(alpha, /<key>destination<\/key>\s*<string>upload<\/string>/);
  assert.match(alpha, /<key>teamID<\/key>\s*<string>TEAM123456<\/string>/);
  assert.match(alpha, /<key>manageAppVersionAndBuildNumber<\/key>\s*<false\/>/);
  assert.match(alpha, /<key>testFlightInternalTestingOnly<\/key>\s*<true\/>/);
  assert.match(exportOptions({ team: "T", internalOnly: false }), /<key>testFlightInternalTestingOnly<\/key>\s*<false\/>/);
});

test("export options escape XML", () => {
  assert.match(exportOptions({ team: "A&B<C>", internalOnly: false }), /A&amp;B&lt;C&gt;/);
});

test("signing arguments carry the key by path, never its contents", () => {
  assert.deepEqual(signingArgs({ keyId: "K1", issuerId: "I1", keyPath: "/k/AuthKey_K1.p8" }), [
    "-allowProvisioningUpdates",
    "-authenticationKeyPath", "/k/AuthKey_K1.p8",
    "-authenticationKeyID", "K1",
    "-authenticationKeyIssuerID", "I1",
  ]);
});

test("the archive must contain the version, build and bundle id we asked for", () => {
  const info = { CFBundleShortVersionString: "0.2.0", CFBundleVersion: "17", CFBundleIdentifier: "to.labs.notes" };
  assert.deepEqual(archiveProblems({ info, manifest: plain, version: "0.2.0", build: 17 }), []);
  assert.equal(archiveProblems({ info, manifest: plain, version: "0.2.1", build: 17 }).length, 1);
  assert.equal(archiveProblems({ info, manifest: plain, version: "0.2.0", build: 18 }).length, 1);
  assert.equal(archiveProblems({ info: { ...info, CFBundleIdentifier: "x.y" }, manifest: plain, version: "0.2.0", build: 17 }).length, 1);
});
