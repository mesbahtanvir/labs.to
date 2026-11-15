// Run with: pnpm test   (node's built-in test runner; part of `pnpm verify`)

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveSecret } from "./env.mjs";
import { hostedUrlProblem } from "./release.mjs";
import {
  apiBase,
  credentialProblems,
  ensureProject,
  materializeAuth,
  parseDeployUrl,
  projectName,
  projectSettings,
  pulledEnvProblems,
  settingsDrift,
  tail,
  targetFor,
} from "./web-release.mjs";

test("hostedUrlProblem accepts only an https address on the public internet", () => {
  assert.equal(hostedUrlProblem("https://abcd.supabase.co"), null);
  assert.deepEqual(hostedUrlProblem(""), { kind: "empty" });
  assert.deepEqual(hostedUrlProblem(undefined), { kind: "empty" });
  assert.equal(hostedUrlProblem("http://abcd.supabase.co").kind, "not-https");
  assert.equal(hostedUrlProblem("not a url").kind, "not-https");
  for (const local of ["https://localhost", "https://127.0.0.1:44321", "https://10.0.2.2", "https://192.168.1.2", "https://mymac.local"]) {
    assert.equal(hostedUrlProblem(local).kind, "local", local);
  }
});

test("alpha goes to a preview deployment and live to production", () => {
  assert.equal(targetFor("alpha"), "preview");
  assert.equal(targetFor("live"), "production");
  assert.equal(projectName("notes"), "labs-notes");
});

test("the Vercel project builds the app from the repository root", () => {
  assert.deepEqual(projectSettings("notes"), {
    framework: "nextjs",
    rootDirectory: "apps/notes/web",
    installCommand: "pnpm install --frozen-lockfile --ignore-scripts",
    sourceFilesOutsideRootDirectory: true,
  });
  const wanted = projectSettings("notes");
  assert.deepEqual(settingsDrift(wanted, wanted), {});
  assert.deepEqual(settingsDrift({ ...wanted, rootDirectory: null, installCommand: "npm i" }, wanted), { rootDirectory: wanted.rootDirectory, installCommand: wanted.installCommand });
  assert.deepEqual(Object.keys(settingsDrift({}, wanted)).sort(), Object.keys(wanted).sort());
});

test("only a loopback API address can replace Vercel's, so the token never goes elsewhere", () => {
  assert.equal(apiBase({}), "https://api.vercel.com");
  assert.equal(apiBase({ VERCEL_API_URL: "http://127.0.0.1:58391" }), "http://127.0.0.1:58391");
  assert.equal(apiBase({ VERCEL_API_URL: "http://localhost:9/" }), "http://localhost:9");
  for (const elsewhere of ["https://evil.example", "http://evil.example", "http://127.0.0.1.evil.example", "https://127.0.0.1:1"]) {
    assert.equal(apiBase({ VERCEL_API_URL: elsewhere }), "https://api.vercel.com", elsewhere);
  }
});

test("a missing token is named, and the problem never contains a value", () => {
  const problems = credentialProblems({});
  assert.ok(problems.some((p) => /VERCEL_TOKEN is not set/.test(p)));
  const withToken = credentialProblems({ VERCEL_TOKEN: "super-secret-value-123" });
  assert.ok(withToken.every((p) => !p.includes("super-secret-value-123")));
});

test("resolveSecret returns plain values, and says what is missing without echoing anything", () => {
  assert.deepEqual(resolveSecret("K", { K: "  plain  " }), { ok: true, value: "plain" });
  assert.deepEqual(resolveSecret("K", {}), { ok: false, out: "K is not set" });
  assert.deepEqual(resolveSecret("K", { K: "   " }), { ok: false, out: "K is not set" });
});

test("the deployment URL is the last line of stdout, and only an https URL", () => {
  assert.equal(parseDeployUrl("https://labs-notes-abc.vercel.app"), "https://labs-notes-abc.vercel.app");
  assert.equal(parseDeployUrl("noise\nhttps://labs-notes-abc.vercel.app\n"), "https://labs-notes-abc.vercel.app");
  assert.equal(parseDeployUrl(""), null);
  assert.equal(parseDeployUrl("Error: something\n"), null);
  assert.equal(parseDeployUrl("https://a.vercel.app\ntrailing words"), null);
});

test("tail keeps the last non-empty lines", () => {
  assert.equal(tail("a\n\nb\n  \nc\n", 2), "b\nc");
});

const withPulledEnv = (text, fn) => {
  const dir = mkdtempSync(join(tmpdir(), "labs-web-"));
  try {
    mkdirSync(join(dir, ".vercel"));
    if (text !== null) writeFileSync(join(dir, ".vercel", ".env.production.local"), text);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const supabase = { name: "notes", backend: "supabase" };

test("the pulled environment must carry a hosted Supabase address and a key", () => {
  const good = 'NEXT_PUBLIC_SUPABASE_URL="https://abcd.supabase.co"\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="sb_publishable_x"\n';
  withPulledEnv(good, (dir) => assert.deepEqual(pulledEnvProblems({ manifest: supabase, dir, target: "production" }), []));

  withPulledEnv(null, (dir) => {
    const p = pulledEnvProblems({ manifest: supabase, dir, target: "production" });
    assert.equal(p.length, 2);
    assert.match(p[0], /labs-notes \(production\) has no NEXT_PUBLIC_SUPABASE_URL/);
  });
  withPulledEnv('NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:44321"\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="k"\n', (dir) => {
    assert.match(pulledEnvProblems({ manifest: supabase, dir, target: "production" }).join("\n"), /must be an https URL/);
  });
  withPulledEnv('NEXT_PUBLIC_SUPABASE_URL="https://localhost:44321"\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="k"\n', (dir) => {
    assert.match(pulledEnvProblems({ manifest: supabase, dir, target: "production" }).join("\n"), /local address \(localhost\)/);
  });
  withPulledEnv('NEXT_PUBLIC_SUPABASE_URL="https://abcd.supabase.co"\n', (dir) => {
    assert.match(pulledEnvProblems({ manifest: supabase, dir, target: "production" }).join("\n"), /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });
});

test("an idea without a backend is not asked for Supabase settings", () => {
  withPulledEnv(null, (dir) => assert.deepEqual(pulledEnvProblems({ manifest: { name: "notes", backend: "none" }, dir, target: "preview" }), []));
});

test("the token lives in a private auth.json and goes away with cleanup", () => {
  const auth = materializeAuth({ token: "tok123" });
  const file = join(auth.dir, "auth.json");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { token: "tok123" });
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(auth.dir).mode & 0o777, 0o700);
  auth.cleanup();
  assert.throws(() => statSync(auth.dir));
});

// ---- the project, against a stand-in API on loopback -------------------------------------------------

async function withApi(handler, fn) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      const [status, json] = handler(req.method, req.url, body ? JSON.parse(body) : null);
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, seen);
  } finally {
    server.close();
  }
}

test("a missing project is created with the right settings", async () => {
  const wanted = projectSettings("notes");
  await withApi(
    (method) => (method === "GET" ? [404, { error: { message: "not found" } }] : [200, { id: "prj_1", accountId: "acct_1", name: "labs-notes", ...wanted }]),
    async (base, seen) => {
      const r = await ensureProject({ token: "tok", idea: "notes", base });
      assert.deepEqual(r, { ok: true, created: true, patched: [], project: { id: "prj_1", orgId: "acct_1" } });
      assert.deepEqual(seen.map((s) => `${s.method} ${s.url}`), ["GET /v9/projects/labs-notes", "POST /v11/projects"]);
      assert.deepEqual(seen[1].body, { name: "labs-notes", ...wanted });
      assert.ok(seen.every((s) => s.auth === "Bearer tok"));
    },
  );
});

test("a project whose settings drifted is corrected, and a correct one is left alone", async () => {
  const wanted = projectSettings("notes");
  await withApi(
    (method) => (method === "GET" ? [200, { id: "prj_1", accountId: "acct_1", ...wanted, rootDirectory: null }] : [200, {}]),
    async (base, seen) => {
      const r = await ensureProject({ token: "tok", idea: "notes", teamId: "team_9", base });
      assert.deepEqual(r.patched, ["rootDirectory"]);
      assert.deepEqual(seen.map((s) => `${s.method} ${s.url}`), ["GET /v9/projects/labs-notes?teamId=team_9", "PATCH /v9/projects/prj_1?teamId=team_9"]);
      assert.deepEqual(seen[1].body, { rootDirectory: "apps/notes/web" });
    },
  );
  await withApi(
    () => [200, { id: "prj_1", accountId: "acct_1", ...wanted }],
    async (base, seen) => {
      const r = await ensureProject({ token: "tok", idea: "notes", base });
      assert.deepEqual({ created: r.created, patched: r.patched }, { created: false, patched: [] });
      assert.equal(seen.length, 1);
    },
  );
});

test("API failures say what failed, and never contain the token", async () => {
  await withApi(
    () => [403, { error: { message: "Not authorized" } }],
    async (base) => {
      const r = await ensureProject({ token: "tok-secret-1", idea: "notes", base });
      assert.equal(r.ok, false);
      assert.match(r.out, /could not read the Vercel project labs-notes: 403 Not authorized/);
      assert.ok(!r.out.includes("tok-secret-1"));
    },
  );
  await withApi(
    (method) => (method === "GET" ? [404, {}] : [400, { error: { message: "bad rootDirectory" } }]),
    async (base) => {
      const r = await ensureProject({ token: "tok", idea: "notes", base });
      assert.match(r.out, /could not create the Vercel project labs-notes: 400 bad rootDirectory/);
    },
  );
});
