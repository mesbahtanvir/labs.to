// Run with: pnpm test   (node's built-in test runner; part of `pnpm verify`)

import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ENV_EXAMPLE, ENV_SPEC, loadLocalEnv, parseEnv } from "./env.mjs";

const withFile = (text, mode, fn) => {
  const dir = mkdtempSync(join(tmpdir(), "labs-env-"));
  const file = join(dir, ".env.labs");
  try {
    writeFileSync(file, text);
    chmodSync(file, mode);
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("parseEnv reads KEY=value lines, comments, export and quotes", () => {
  const { vars, problems } = parseEnv(
    ['# a comment', "", "A=1", "export B = two  # trailing comment", 'C="three # kept"', "D='four'", "E=", "F=a=b=c"].join("\n"),
  );
  assert.deepEqual(problems, []);
  assert.deepEqual(vars, { A: "1", B: "two", C: "three # kept", D: "four", E: "", F: "a=b=c" });
});

test("parseEnv expands a leading ~/ and nothing else", () => {
  const { vars } = parseEnv("K=~/keys/AuthKey_X.p8\nL=a~/b");
  assert.equal(vars.K, join(homedir(), "keys", "AuthKey_X.p8"));
  assert.equal(vars.L, "a~/b");
});

test("parseEnv reports bad lines by number and never repeats their content", () => {
  const { vars, problems } = parseEnv("OK=1\nthis is secret-looking text\nQ=\"unterminated secret\nB-AD=1");
  assert.deepEqual(vars, { OK: "1" });
  assert.equal(problems.length, 3);
  assert.deepEqual(problems.map((p) => /^line (\d)/.exec(p)[1]), ["2", "3", "4"]);
  assert.ok(problems.every((p) => !/secret/.test(p)));
});

test("loadLocalEnv fills what is unset, keeps what the environment already has, skips empty values", () => {
  withFile("A=from-file\nB=from-file\nC=\nD=from-file\n", 0o600, (file) => {
    const env = { B: "from-shell", D: "" };
    const r = loadLocalEnv({ file, env });
    assert.deepEqual(env, { A: "from-file", B: "from-shell", D: "from-file" });
    assert.deepEqual(r.loaded.sort(), ["A", "D"]);
    assert.deepEqual(r.shadowed, ["B"]);
    assert.deepEqual(r.problems, []);
    assert.ok(!JSON.stringify(r).includes("from-file"), "the result names keys and never carries a value");
  });
});

test("loadLocalEnv is quiet when the file does not exist", () => {
  const env = {};
  const r = loadLocalEnv({ file: join(tmpdir(), "labs-no-such-file"), env });
  assert.deepEqual({ ...r, file: null }, { file: null, exists: false, loaded: [], shadowed: [], problems: [] });
  assert.deepEqual(env, {});
});

test("loadLocalEnv warns when other users can read the file, and still loads it", () => {
  withFile("A=1\n", 0o644, (file) => {
    const env = {};
    const r = loadLocalEnv({ file, env });
    assert.equal(env.A, "1");
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /chmod 600/);
  });
});

test(".env.example lists exactly the variables the tooling reads, all empty", () => {
  const lines = readFileSync(ENV_EXAMPLE, "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l));
  assert.deepEqual(
    lines.map((l) => l.split("=")[0]).sort(),
    ENV_SPEC.map((s) => s.key).sort(),
  );
  assert.ok(lines.every((l) => l.endsWith("=")), "the example ships with no values");
});
