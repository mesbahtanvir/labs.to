// `network: none` in idea.yaml is a promise to users: the app makes no network call at all
// (it runs a local model, for example). These checks keep the promise mechanically, so no
// one has to remember it. They are pure functions over files: no I/O beyond reading the idea.
//
// A static scan can not prove a negative, so this is a tripwire for the ways a network call
// gets in by accident: a permission, a networking API, a networking dependency, a backend
// folder. The Android check on the merged manifest (after the build) also catches a
// permission that a library brings in. A deliberate false positive is marked with
// `labs:allow-network` on its line.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".next", "build", ".gradle", "DerivedData", "Generated", ".git", "out"]);
// Tests and test fixtures do not ship in the app.
const TEST_PATH = /(^|\/)(Tests|test|androidTest|__tests__)\/|\.(test|spec)\.[a-z]+$/;
const ALLOW = "labs:allow-network";

const ANDROID_PERMISSIONS = /android\.permission\.(INTERNET|ACCESS_NETWORK_STATE|ACCESS_WIFI_STATE|CHANGE_NETWORK_STATE)|usesCleartextTraffic/;
const GRADLE_DEPS = /supabase|okhttp|retrofit|ktor-client|ktor\.client|firebase|volley|apollo|grpc|coil-network|play-services|datadog|sentry|crashlytics|amplitude|mixpanel/i;
const KOTLIN_API = /\b(HttpURLConnection|HttpsURLConnection|okhttp3|io\.ktor\.client|android\.net\.http|DownloadManager)\b|java\.net\.(URL|Socket|URI)\b|\bURL\(\s*"https?:/;
const SWIFT_API = /\b(URLSession|URLRequest|NWConnection|NWPathMonitor|NWListener|CFNetwork|URLSessionWebSocketTask|NSURLConnection)\b|^\s*import\s+Network\b|\bURL\(string:\s*"https?:/m;
const IOS_CONFIG = /NSAppTransportSecurity|NSAllowsArbitraryLoads|supabase|alamofire|firebase|sentry|amplitude|mixpanel/i;
const WEB_API = /\b(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|navigator\.serviceWorker\.register)/;
const WEB_DEPS = /"(@supabase\/[^"]+|axios|ky|firebase|@sentry\/[^"]+|swr|@tanstack\/react-query|socket\.io-client)"\s*:/;

function* files(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else yield p;
  }
}

function scan(root, dir, rule, matches, pathOk, found) {
  for (const file of files(dir)) {
    const rel = relative(root, file).split("\\").join("/");
    if (!pathOk(rel) || TEST_PATH.test(rel.slice(rel.indexOf("/") + 1))) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, i) => {
      // A comment that mentions a backend is not a call to one.
      if (!text.includes(ALLOW) && !/^\s*(\/\/|#|\*)/.test(text) && matches.test(text)) found.push({ file: rel, line: i + 1, rule });
    });
  }
}

/**
 * Where a `network: none` idea breaks its promise, as `{ file, line?, rule }`.
 * @param ideaDir apps/<idea>
 * @param manifest the parsed idea.yaml
 */
export function offlineViolations(ideaDir, manifest) {
  const found = [];
  const root = ideaDir;
  const has = (p) => (manifest.platforms ?? []).includes(p);

  if (existsSync(join(ideaDir, "supabase"))) found.push({ file: "supabase/", rule: "a backend folder: network: none has no backend" });

  if (has("android")) {
    const dir = join(ideaDir, "android");
    scan(root, dir, "network permission or cleartext traffic in an Android manifest", ANDROID_PERMISSIONS, (f) => f.endsWith("AndroidManifest.xml"), found);
    scan(root, dir, "networking or telemetry dependency", GRADLE_DEPS, (f) => f.endsWith(".gradle.kts") || f.endsWith("libs.versions.toml"), found);
    scan(root, dir, "networking API", KOTLIN_API, (f) => f.endsWith(".kt") || f.endsWith(".java"), found);
  }
  if (has("ios")) {
    const dir = join(ideaDir, "ios");
    scan(root, dir, "networking API", SWIFT_API, (f) => f.endsWith(".swift"), found);
    scan(root, dir, "networking setting or dependency", IOS_CONFIG, (f) => /\.(yml|xcconfig|plist)$/.test(f) && !f.endsWith(".example"), found);
  }
  if (has("web")) {
    const dir = join(ideaDir, "web");
    scan(root, dir, "networking API", WEB_API, (f) => /\.(m?[jt]sx?)$/.test(f) && !/(^|\/)(next|eslint)\.config\./.test(f), found);
    scan(root, dir, "networking or telemetry dependency", WEB_DEPS, (f) => f.endsWith("web/package.json"), found);
  }
  return found;
}

/**
 * Network permissions in the manifest Android actually merged, which includes what libraries
 * add. Run it after a debug build. `found` is how many merged manifests were looked at: none
 * means the build output was not where this expects, and the caller should say so.
 */
export function mergedManifestViolations(androidDir) {
  const out = [];
  let found = 0;
  for (const file of files(join(androidDir, "app", "build", "intermediates"))) {
    // Only the app's own merged manifest (not androidTest's), whatever AGP names the folder.
    if (!/merged_manifests?\//.test(file) || /androidTest/i.test(file) || !file.endsWith("AndroidManifest.xml")) continue;
    found++;
    const m = readFileSync(file, "utf8").match(new RegExp(ANDROID_PERMISSIONS.source, "g"));
    for (const hit of new Set(m ?? [])) out.push({ file: relative(androidDir, file), rule: `merged manifest has ${hit}` });
  }
  return { found, violations: out };
}
