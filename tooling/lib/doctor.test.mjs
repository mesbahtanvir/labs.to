// Run with: pnpm test   (node's built-in test runner; part of `pnpm verify`)

import assert from "node:assert/strict";
import { test } from "node:test";
import { activeManifests, needs, teamStatus } from "./doctor.mjs";

const idea = (name, stage, platforms, backend = "supabase") => ({ errors: [], manifest: { name, stage, platforms, backend } });

test("only ideas that get checks count", () => {
  const ideas = [idea("a", "prototype", ["web"]), idea("b", "spark", ["ios"]), idea("c", "archived", ["android"]), { errors: ["bad"], manifest: null }];
  assert.deepEqual(activeManifests(ideas).map((m) => m.name), ["a"]);
});

test("with no ideas yet, a new one defaults to web and Supabase", () => {
  assert.deepEqual(needs([]), { supabase: true, ios: false, android: false });
});

test("toolchains are needed when an active idea uses them, or when asked for", () => {
  const web = [{ platforms: ["web"], backend: "none" }];
  assert.deepEqual(needs(web), { supabase: false, ios: false, android: false });
  assert.deepEqual(needs(web, ["ios"]), { supabase: false, ios: true, android: false });
  const mobile = [{ platforms: ["web", "ios", "android"], backend: "supabase" }];
  assert.deepEqual(needs(mobile), { supabase: true, ios: true, android: true });
});

test("a team id in the environment covers every idea", () => {
  assert.equal(teamStatus({ env: { LABS_APPLE_TEAM_ID: "ABCDE12345" }, iosIdeas: ["a", "b"], read: () => null }).ok, true);
  assert.equal(teamStatus({ env: { LABS_APPLE_TEAM_ID: "  " }, iosIdeas: [], read: () => null }).ok, false);
});

test("without it, every iOS idea needs DEVELOPMENT_TEAM in its own Local.xcconfig", () => {
  const files = { a: "SUPABASE_PUBLISHABLE_KEY = k\nDEVELOPMENT_TEAM = ABCDE12345\n", b: "// DEVELOPMENT_TEAM = ABCDE12345\n", c: null };
  const read = (name) => files[name];
  assert.equal(teamStatus({ env: {}, iosIdeas: ["a"], read }).ok, true);
  const missing = teamStatus({ env: {}, iosIdeas: ["a", "b", "c"], read });
  assert.equal(missing.ok, false);
  assert.match(missing.note, /for: b, c\)/); // a commented-out line and a missing file both count as no team
  assert.equal(teamStatus({ env: {}, iosIdeas: [], read }).ok, false);
});
