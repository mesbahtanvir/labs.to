// Guards the shape of the repository itself: the project skills and the workflows.
// Run with: pnpm test   (node's built-in test runner; part of `pnpm verify`)

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { ROOT } from "./lib/manifest.mjs";

const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");
const scripts = Object.keys(JSON.parse(read("package.json")).scripts);

const skillsDir = join(ROOT, ".claude", "skills");
const skills = existsSync(skillsDir) ? readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()) : [];

test("every project skill has a name that matches its folder and a description that says when to use it", () => {
  assert.ok(skills.length > 0, "there are project skills");
  for (const { name: dir } of skills) {
    const text = read(".claude", "skills", dir, "SKILL.md");
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
    assert.ok(front, `${dir}: frontmatter`);
    const meta = parse(front[1]);
    assert.equal(meta.name, dir);
    assert.match(meta.description, /^.{60,}$/s, `${dir}: description`);
    assert.match(meta.description, /\b[Uu]se when\b/, `${dir}: description says when to use it`);
  }
});

test("skills only run pnpm scripts that exist", () => {
  const builtin = new Set(["install", "--filter"]);
  for (const { name: dir } of skills) {
    const text = read(".claude", "skills", dir, "SKILL.md");
    for (const m of text.matchAll(/\bpnpm ([a-z-]+)/g)) {
      assert.ok(scripts.includes(m[1]) || builtin.has(m[1]), `${dir}: "pnpm ${m[1]}" is not a script in package.json`);
    }
  }
});

const workflows = readdirSync(join(ROOT, ".github", "workflows")).filter((f) => f.endsWith(".yml"));

test("GitHub holds no secrets: no workflow reads one, and the only token is the built-in one", () => {
  for (const f of workflows) {
    const text = read(".github", "workflows", f);
    assert.ok(!/\$\{\{\s*secrets\./.test(text), `${f} reads a repository secret`);
  }
});

test("every workflow parses, and asks for the least permission it needs", () => {
  for (const f of workflows) {
    const wf = parse(read(".github", "workflows", f));
    assert.ok(wf.on, `${f}: triggers`);
    const perms = wf.permissions;
    assert.ok(perms && typeof perms === "object", `${f}: sets permissions explicitly`);
    for (const [scope, level] of Object.entries(perms)) {
      assert.ok(level === "read" || (f === "release.yml" && scope === "contents" && level === "write"), `${f}: ${scope}: ${level}`);
    }
  }
});

test("no job runs on a macOS runner (ten times the cost of Linux)", () => {
  for (const f of workflows) {
    for (const [name, job] of Object.entries(parse(read(".github", "workflows", f)).jobs)) {
      if (job["runs-on"] !== undefined) assert.match(String(job["runs-on"]), /^ubuntu-/, `${f}: ${name} runs on ${job["runs-on"]}`);
    }
  }
});

test("the release workflow runs only when a release tag is pushed", () => {
  const wf = parse(read(".github", "workflows", "release.yml"));
  assert.deepEqual(wf.on.push.tags, ["*/*/v*"]);
  assert.equal(wf.on.push.branches, undefined);
  assert.equal(wf.on.pull_request, undefined);
});
