// Android helpers for `pnpm verify`: toolchain checks, Gradle, and a dedicated emulator.
//
// Like the throwaway Supabase stack and the iOS simulator, verification never uses
// an emulator you work with. It owns one AVD named "labs-verify" on its own console
// port (5584, so adb serial emulator-5584), created on demand from a system image
// you already have installed, started headless, and shut down afterwards. Gradle is
// pointed at that one device, so a running emulator of yours is never touched.

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { arch, homedir } from "node:os";
import { join } from "node:path";
import { CACHE_ROOT } from "./cache.mjs";
import { run } from "./exec.mjs";

export const AVD_NAME = "labs-verify";
const EMULATOR_PORT = 5584; // even; the adb port is +1. Well clear of the default 5554.
const SERIAL = `emulator-${EMULATOR_PORT}`;
const MIN_API = 26; // the template's minSdk
const TARGET_API = 37; // the template's targetSdk: test on the platform we target, or the newest older one
const TAG_PREFERENCE = ["google_apis", "default", "google_apis_playstore"];

const LOG_DIR = join(CACHE_ROOT, "android");
const EMULATOR_LOG = join(LOG_DIR, "emulator.log");

const fail = (out) => ({ ok: false, out });
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function waitFor(predicate, { timeoutMs, intervalMs = 2000 }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > deadline) return false;
    sleep(intervalMs);
  }
}

export function sdkRoot() {
  const candidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(homedir(), "Library", "Android", "sdk"), join(homedir(), "Android", "Sdk")];
  return candidates.find((p) => p && existsSync(join(p, "platform-tools"))) ?? null;
}

const tool = (root, ...parts) => join(root, ...parts);

function avdmanagerPath(root) {
  const base = join(root, "cmdline-tools");
  if (!existsSync(base)) return null;
  const dirs = readdirSync(base).sort((a, b) => (a === "latest" ? -1 : b === "latest" ? 1 : b.localeCompare(a, undefined, { numeric: true })));
  for (const d of dirs) {
    const p = join(base, d, "bin", "avdmanager");
    if (existsSync(p)) return p;
  }
  return null;
}

function javaMajor() {
  const r = run("java", ["-version"]);
  const m = r.out.match(/version "(\d+)(?:\.(\d+))?/);
  if (!r.ok || !m) return null;
  return m[1] === "1" ? Number(m[2]) : Number(m[1]); // "1.8.0" is Java 8
}

/** Is everything needed to build and test an Android app installed? */
export function androidPreflight() {
  const major = javaMajor();
  if (major === null) return fail("Java is not installed. Install a JDK 17 or newer (for example: brew install openjdk@17) and make sure `java` is on your PATH.");
  if (major < 17) return fail(`Java ${major} is too old: the Android Gradle plugin needs 17 or newer.`);

  const root = sdkRoot();
  if (!root) return fail("The Android SDK was not found. Install Android Studio, or set ANDROID_HOME to your SDK folder.");
  const missing = [
    ["adb", tool(root, "platform-tools", "adb"), "Platform-Tools"],
    ["emulator", tool(root, "emulator", "emulator"), "Emulator"],
    ["avdmanager", avdmanagerPath(root), "Android SDK Command-line Tools"],
  ].filter(([, path]) => !path || !existsSync(path));
  if (missing.length > 0) {
    return fail(`Missing from the Android SDK (${root}): ${missing.map(([n]) => n).join(", ")}.\nInstall in Android Studio > SDK Manager > SDK Tools: ${missing.map(([, , pkg]) => pkg).join(", ")}.`);
  }
  return { ok: true, out: "" };
}

// ---- Gradle ---------------------------------------------------------------------

/** The lines of a Gradle run that say what went wrong, instead of the whole log. */
function summarize(out) {
  const lines = out.split("\n");
  const keep = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\* What went wrong:/.test(l)) {
      // The whole block, minus blank lines: a dependency check can list many issues.
      for (let j = i + 1; j < lines.length && !/^\* Try:/.test(lines[j]); j++) keep.push(lines[j].trimEnd());
    } else if (/^e: |Lint error|: Error:|^Error:|\bFAILED$|AssertionError|ComparisonFailure|expected:|\.kt:\d+/.test(l)) {
      keep.push(l);
    }
  }
  // Android Lint appends boilerplate about creating a baseline; it does not help here.
  const boilerplate = /updateLintBaseline|lint-baseline|^\s*```|^\s*(android|lint) \{$|^\s*\}$|For more details, see|Fix the issues identified by lint|To create a baseline/;
  const seen = new Set();
  const unique = keep.filter((l) => l.trim() && !boilerplate.test(l) && !seen.has(l) && seen.add(l));
  const shown = unique.length > 0 ? unique.slice(0, 30) : lines.filter((l) => l.trim()).slice(-15);
  return shown.join("\n");
}

/** Runs `./gradlew <tasks>` in an idea's android folder. */
export function gradle({ dir, tasks, serial }) {
  const root = sdkRoot();
  const env = { ANDROID_HOME: root, ANDROID_SDK_ROOT: root, ...(serial ? { ANDROID_SERIAL: serial } : {}) };
  const r = run(
    join(dir, "gradlew"),
    [
      ...tasks,
      "--console=plain",
      "--warning-mode=summary",
      "-Dorg.gradle.daemon.idletimeout=600000", // the daemon expires by itself; verify never stops daemons it does not own
    ],
    { cwd: dir, env, timeoutMs: 40 * 60 * 1000 },
  );
  return { ok: r.ok, out: r.ok ? "" : summarize(r.out) };
}

// ---- the verify emulator ----------------------------------------------------------

const adb = (serial, args, opts) => run(tool(sdkRoot(), "platform-tools", "adb"), serial ? ["-s", serial, ...args] : args, opts);

function deviceState() {
  const r = adb(null, ["devices"]);
  const line = r.stdout.split("\n").find((l) => l.startsWith(`${SERIAL}\t`));
  return line ? line.split("\t")[1].trim() : null; // "device", "offline", ... or null when absent
}

function avdNameOfRunning() {
  const r = adb(SERIAL, ["emu", "avd", "name"]);
  return r.ok ? r.stdout.split("\n")[0].trim() : null;
}

const booted = () => deviceState() === "device" && adb(SERIAL, ["shell", "getprop", "sys.boot_completed"]).stdout.trim() === "1";

function pickSystemImage() {
  const override = process.env.LABS_ANDROID_SYSTEM_IMAGE; // e.g. system-images;android-36;google_apis;arm64-v8a
  if (override) return { pkg: override, sysdir: override.split(";").join("/") + "/" };

  const abi = arch() === "arm64" ? "arm64-v8a" : "x86_64";
  const base = join(sdkRoot(), "system-images");
  if (!existsSync(base)) return null;
  const found = [];
  for (const platformDir of readdirSync(base)) {
    const api = platformDir.match(/^android-(\d+(?:\.\d+)?)$/)?.[1];
    if (!api || Number(api) < MIN_API) continue;
    for (const tag of readdirSync(join(base, platformDir))) {
      if (existsSync(join(base, platformDir, tag, abi))) found.push({ api: Number(api), platformDir, tag, abi });
    }
  }
  const rank = (c) => (TAG_PREFERENCE.includes(c.tag) ? TAG_PREFERENCE.indexOf(c.tag) : TAG_PREFERENCE.length);
  // The platform we target first, then the newest older one, then anything newer; plain AOSP-style tags before Play images.
  const order = (a, b) => Number(b.api <= TARGET_API) - Number(a.api <= TARGET_API) || (a.api <= TARGET_API ? b.api - a.api : a.api - b.api) || rank(a) - rank(b);
  found.sort(order);
  const pick = found[0];
  return pick ? { pkg: `system-images;${pick.platformDir};${pick.tag};${pick.abi}`, sysdir: `system-images/${pick.platformDir}/${pick.tag}/${pick.abi}/` } : null;
}

function configuredSysdir() {
  const file = join(homedir(), ".android", "avd", `${AVD_NAME}.avd`, "config.ini");
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8").match(/^image\.sysdir\.1\s*=\s*(.*)$/m)?.[1].trim() ?? null;
}

function ensureAvd(image) {
  const root = sdkRoot();
  const avdmanager = avdmanagerPath(root);
  const env = { ANDROID_HOME: root, ANDROID_SDK_ROOT: root };
  const have = run(tool(root, "emulator", "emulator"), ["-list-avds"]).stdout.split("\n").includes(AVD_NAME);
  if (have && configuredSysdir() === image.sysdir) return { ok: true };
  if (have) run(avdmanager, ["delete", "avd", "-n", AVD_NAME], { env }); // stale: another system image than today's pick

  // avdmanager asks whether to create a custom hardware profile; "no" takes the device's defaults.
  const created = run(avdmanager, ["create", "avd", "-n", AVD_NAME, "-k", image.pkg, "-d", "pixel_7", "--force"], { env, input: "no\n" });
  return created.ok ? { ok: true } : fail(`could not create the verify AVD from ${image.pkg}:\n${created.out}`);
}

/**
 * Starts (or reuses) the labs-verify emulator and waits until Android has booted.
 * @returns {{ ok: boolean, out: string, note?: string, serial?: string }}
 */
export function bootVerifyEmulator() {
  const root = sdkRoot();
  if (deviceState() !== null) {
    const name = avdNameOfRunning();
    if (name !== AVD_NAME) return fail(`${SERIAL} is already in use by another emulator (${name ?? "unknown AVD"}). Stop it, or free port ${EMULATOR_PORT}.`);
  } else {
    const image = pickSystemImage();
    if (!image) {
      return fail(`No Android system image is installed for this machine. Install one, then run verify again:\n  sdkmanager "system-images;android-${TARGET_API};google_apis;${arch() === "arm64" ? "arm64-v8a" : "x86_64"}"\n(or set LABS_ANDROID_SYSTEM_IMAGE).`);
    }
    const avd = ensureAvd(image);
    if (!avd.ok) return avd;

    mkdirSync(LOG_DIR, { recursive: true });
    // Headless and detached: it keeps running after this process exits, so --keep can reuse it.
    const args = ["-avd", AVD_NAME, "-port", String(EMULATOR_PORT), "-no-window", "-no-audio", "-no-boot-anim", "-gpu", "swiftshader_indirect"];
    run("sh", ["-c", 'log="$1"; shift; nohup "$@" >"$log" 2>&1 </dev/null &', "sh", EMULATOR_LOG, tool(root, "emulator", "emulator"), ...args]);
  }

  if (!waitFor(booted, { timeoutMs: 5 * 60 * 1000 })) {
    const tail = existsSync(EMULATOR_LOG) ? readFileSync(EMULATOR_LOG, "utf8").trimEnd().split("\n").slice(-8).join("\n") : "(no emulator log)";
    return fail(`the verify emulator did not finish booting within 5 minutes. End of ${EMULATOR_LOG}:\n${tail}`);
  }

  // Animations make UI tests slower and flakier.
  for (const key of ["window_animation_scale", "transition_animation_scale", "animator_duration_scale"]) {
    adb(SERIAL, ["shell", "settings", "put", "global", key, "0"]);
  }
  const api = adb(SERIAL, ["shell", "getprop", "ro.build.version.sdk"]).stdout.trim();
  return { ok: true, out: "", note: `${AVD_NAME}, API ${api}`, serial: SERIAL };
}

/** Shuts down the labs-verify emulator if it is running. Never touches other emulators. */
export function shutdownVerifyEmulator() {
  if (deviceState() === null || avdNameOfRunning() !== AVD_NAME) return 0;
  adb(SERIAL, ["emu", "kill"]);
  waitFor(() => deviceState() === null, { timeoutMs: 90 * 1000, intervalMs: 1000 }); // it saves a quick-boot snapshot on the way out
  return 1;
}
