// One place for this machine's release settings and secrets: <repo>/.env.labs.
//
// The file is git-ignored and never leaves the machine. The tooling that needs it
// (`pnpm release`, `pnpm doctor`) reads it into the process environment, but a real
// environment variable always wins, so a one-off `ASC_KEY_ID=... pnpm release` still
// works. Only names are ever reported, never values.
//
// It is meant to hold identifiers, paths and references (op://...), not pasted secrets:
// the one real secret so far, the App Store Connect key, stays a file or a 1Password item.
//
// Not to be confused with apps/<idea>/web/.env.local, which is the Next.js app's own file.

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { run } from "./exec.mjs";
import { ROOT } from "./manifest.mjs";

export const ENV_FILE = join(ROOT, ".env.labs");
export const ENV_EXAMPLE = join(ROOT, ".env.example");

/**
 * Everything the tooling reads from the environment. `.env.example` is checked against
 * this list by a test, so the two cannot drift. A target only appears here once its
 * release exists.
 */
export const ENV_SPEC = [
  { key: "ASC_KEY_ID", target: "ios", what: "App Store Connect API key id" },
  { key: "ASC_ISSUER_ID", target: "ios", what: "App Store Connect issuer id" },
  { key: "ASC_KEY_PATH", target: "ios", what: "path to the key file, AuthKey_<id>.p8 (or use ASC_KEY_OP_REF)" },
  { key: "ASC_KEY_OP_REF", target: "ios", what: "1Password reference to the key file, op://vault/item/field (or use ASC_KEY_PATH)" },
  { key: "LABS_APPLE_TEAM_ID", target: "ios", what: "Apple developer team id, for every iOS idea (or DEVELOPMENT_TEAM in Config/Local.xcconfig)" },
  { key: "VERCEL_TOKEN", target: "web", what: "Vercel access token, or a 1Password reference to it (op://vault/item/field)" },
  { key: "VERCEL_TEAM_ID", target: "web", what: "Vercel team id (team_...), only if the projects belong to a team" },
];

/**
 * KEY=value lines, with `export `, comments, and single or double quotes allowed.
 * No variable expansion. Problems name a line number, never its content.
 */
export function parseEnv(text) {
  const vars = {};
  const problems = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) {
      problems.push(`line ${i + 1} is not KEY=value`);
      return;
    }
    let value = m[2];
    if (value.startsWith('"') || value.startsWith("'")) {
      const end = value.indexOf(value[0], 1);
      if (end === -1) {
        problems.push(`line ${i + 1} has an unterminated quote`);
        return;
      }
      value = value.slice(1, end);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    vars[m[1]] = value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
  });
  return { vars, problems };
}

/**
 * Reads the file into `env` without overriding anything already set. An empty value
 * (as `.env.example` ships) means "not filled in yet" and is skipped.
 * @returns {{ file, exists, loaded: string[], shadowed: string[], problems: string[] }}
 */
export function loadLocalEnv({ file = ENV_FILE, env = process.env } = {}) {
  const result = { file, exists: existsSync(file), loaded: [], shadowed: [], problems: [] };
  if (!result.exists) return result;

  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    result.problems.push(`cannot read .env.labs (${e.code ?? e.message})`);
    return result;
  }
  const parsed = parseEnv(text);
  result.problems.push(...parsed.problems);
  for (const [key, value] of Object.entries(parsed.vars)) {
    if (value === "") continue;
    if (typeof env[key] === "string" && env[key] !== "") result.shadowed.push(key);
    else {
      env[key] = value;
      result.loaded.push(key);
    }
  }

  const mode = statSync(file).mode & 0o777;
  if (mode & 0o077) result.problems.push(`.env.labs can be read by other users (mode ${mode.toString(8)}). Run: chmod 600 .env.labs`);
  return result;
}

/**
 * A secret from the environment. A value that starts with op:// is a 1Password reference and is
 * read with `op` at the moment it is needed, so the file can hold the reference and never the secret.
 * @returns {{ ok: true, value: string } | { ok: false, out: string }}
 */
export function resolveSecret(key, env = process.env) {
  const value = typeof env[key] === "string" ? env[key].trim() : "";
  if (value === "") return { ok: false, out: `${key} is not set` };
  if (!value.startsWith("op://")) return { ok: true, value };
  const r = run("op", ["read", "--no-newline", value], { timeoutMs: 2 * 60 * 1000 });
  if (!r.ok || r.stdout.trim() === "") return { ok: false, out: `could not read ${key} from 1Password:\n${r.stderr.trim().split("\n").slice(-3).join("\n")}` };
  return { ok: true, value: r.stdout.trim() };
}
