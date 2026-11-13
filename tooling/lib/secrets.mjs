// A small, dependency-free secrets scanner: high-signal patterns only, so it
// can run on every commit and in CI without noise or a license. It is a safety
// net, not a replacement for a full scanner such as gitleaks (which is a
// drop-in upgrade if more coverage is wanted).
//
// Never prints a matched value, only where it was found, so findings can sit in
// logs safely. Add `labs:allow-secret` to a line to allow a deliberate match.

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { run } from "./exec.mjs";
import { ROOT } from "./manifest.mjs";

const ALLOW_MARKER = "labs:allow-secret";
const MAX_BYTES = 2 * 1024 * 1024;

const RULES = [
  { id: "private-key", re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  { id: "supabase-secret-key", re: /\bsb_secret_[A-Za-z0-9_-]{20,}/ },
  { id: "aws-access-key-id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: "github-fine-grained-token", re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/ },
  { id: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { id: "stripe-live-key", re: /\b[sr]k_live_[A-Za-z0-9]{20,}/ },
  { id: "anthropic-api-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
];

const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g;

// Files that should never be tracked, whatever they contain.
const SENSITIVE_FILE_RE = /(^|\/)(\.env(\.(?!example$)[^/]+)?|[^/]+\.(p12|p8|jks|keystore|mobileprovision))$/;

function isServiceRoleJwt(payloadB64) {
  try {
    return JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")).role === "service_role";
  } catch {
    return false;
  }
}

/** Files to scan: staged additions/changes, or everything not ignored (tracked + untracked). */
export function listFiles({ staged = false } = {}) {
  const args = staged ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"] : ["ls-files", "-co", "--exclude-standard", "-z"];
  const r = run("git", args, { cwd: ROOT });
  if (!r.ok) throw new Error(`git ${args[0]} failed: ${r.out.trim()}`);
  return r.stdout.split("\0").filter(Boolean);
}

function readText(path, staged) {
  let buf;
  if (staged) {
    const r = run("git", ["show", `:${path}`], { cwd: ROOT });
    if (!r.ok) return null;
    buf = Buffer.from(r.stdout, "utf8");
  } else {
    try {
      const abs = join(ROOT, path);
      if (statSync(abs).size > MAX_BYTES) return null;
      buf = readFileSync(abs);
    } catch {
      return null; // deleted but still listed, or unreadable
    }
  }
  if (buf.length > MAX_BYTES || buf.subarray(0, 8000).includes(0)) return null; // large or binary
  return buf.toString("utf8");
}

/** @returns {{ file: string, line: number, rule: string }[]} */
export function findSecrets({ files, staged = false }) {
  const findings = [];
  for (const file of files) {
    if (SENSITIVE_FILE_RE.test(file)) findings.push({ file, line: 0, rule: "sensitive-file (should not be committed)" });

    const text = readText(file, staged);
    if (text === null) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(ALLOW_MARKER)) continue;
      for (const { id, re } of RULES) {
        if (re.test(line)) findings.push({ file, line: i + 1, rule: id });
      }
      for (const m of line.matchAll(JWT_RE)) {
        if (isServiceRoleJwt(m[1])) findings.push({ file, line: i + 1, rule: "supabase-service-role-jwt" });
      }
    }
  }
  return findings;
}
