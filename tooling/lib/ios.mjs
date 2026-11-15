// iOS helpers for `pnpm verify`: project generation, formatting, and a dedicated
// simulator.
//
// Like the throwaway Supabase stack, verification never uses a simulator you
// work with. It owns one device named "labs-verify" (created on demand on the
// runtime that matches the installed Xcode SDK) and boots and shuts it down
// itself, so a run can not disturb the simulators you have open.

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";
import { CACHE_ROOT } from "./cache.mjs";
import { run } from "./exec.mjs";

export const SIM_NAME = "labs-verify";

// Shared by every idea: each Swift package is cloned once, not once per idea.
export const PACKAGES_DIR = join(CACHE_ROOT, "SourcePackages");

// First match wins; otherwise any iPhone the runtime supports.
const PREFERRED_DEVICES = ["iPhone 17 Pro", "iPhone 17", "iPhone 16 Pro", "iPhone 16"];

const fail = (out) => ({ ok: false, out });
const json = (r) => {
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
};

/** Is everything needed to build and test an iOS app installed? */
export function iosPreflight() {
  if (platform() !== "darwin") return fail("iOS checks need macOS with Xcode. They never run on GitHub or Linux by design.");
  if (!run("xcodebuild", ["-version"]).ok) return fail("Xcode is not installed or not selected. Install Xcode, then: sudo xcode-select -s /Applications/Xcode.app");
  if (!run("xcrun", ["simctl", "help"]).ok) return fail("xcrun simctl is unavailable. Open Xcode once and accept its license and first-launch install.");
  if (!run("xcodegen", ["--version"]).ok) return fail("XcodeGen is not installed. Run: brew install xcodegen");
  if (!run("xcrun", ["swift-format", "--version"]).ok) return fail("swift-format is not available in the selected Xcode toolchain (needs Xcode 16 or newer).");
  return { ok: true, out: "" };
}

/** Builds <dir>/Idea.xcodeproj from <dir>/project.yml. */
export function generateProject(dir) {
  return run("xcodegen", ["generate", "--quiet"], { cwd: dir });
}

function swiftFiles(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".swift"))
    .map((e) => join(e.parentPath, e.name))
    .filter((f) => !/[\\/]Generated[\\/]/.test(f)); // generated code (Supabase types) is not ours to format
}

/** swift-format in strict mode over the app's own sources and tests. */
export function lintSwift(dir) {
  const files = [...swiftFiles(join(dir, "Sources")), ...swiftFiles(join(dir, "Tests"))];
  if (files.length === 0) return fail("no Swift files found under Sources/ and Tests/");
  return run("xcrun", ["swift-format", "lint", "--strict", "--configuration", join(dir, ".swift-format"), ...files], { cwd: dir });
}

// ---- the verify simulator -----------------------------------------------------

function versionKey(v) {
  return String(v)
    .split(".")
    .map((n) => Number(n) || 0)
    .reduce((acc, n) => acc * 1000 + n, 0);
}

function pickRuntime() {
  const override = process.env.LABS_IOS_RUNTIME;
  const list = json(run("xcrun", ["simctl", "list", "runtimes", "-j"]));
  const all = (list?.runtimes ?? []).filter((r) => r.isAvailable && r.platform === "iOS");
  if (override) return all.find((r) => r.identifier === override) ?? null;

  // Plain runtimes (iOS-27-2) before device-specific variants (iOS-27-2-iPhone19-4).
  const plain = all.filter((r) => /SimRuntime\.iOS-\d+-\d+$/.test(r.identifier));
  const pool = (plain.length > 0 ? plain : all).sort((a, b) => versionKey(b.version) - versionKey(a.version));
  const sdk = run("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-version"]).stdout.trim();
  return pool.find((r) => r.version === sdk) ?? pool[0] ?? null;
}

function pickDeviceType(runtime) {
  const types = runtime.supportedDeviceTypes ?? [];
  for (const name of PREFERRED_DEVICES) {
    const hit = types.find((t) => t.name === name);
    if (hit) return hit;
  }
  return types.find((t) => /iPhone/.test(t.name)) ?? null;
}

/**
 * Finds or creates the labs-verify device and boots it.
 * Devices named labs-verify on another runtime (left over from an older Xcode) are deleted.
 * @returns {{ ok: boolean, out: string, udid?: string }}
 */
export function bootVerifySimulator() {
  const runtime = pickRuntime();
  if (!runtime) return fail("no available iOS simulator runtime. Install one in Xcode > Settings > Components.");
  const deviceType = pickDeviceType(runtime);
  if (!deviceType) return fail(`runtime ${runtime.name} supports no iPhone device type`);

  const devices = json(run("xcrun", ["simctl", "list", "devices", "-j"]))?.devices ?? {};
  let udid = null;
  for (const [runtimeId, list] of Object.entries(devices)) {
    for (const d of list) {
      if (d.name !== SIM_NAME) continue;
      if (runtimeId === runtime.identifier && d.isAvailable && d.deviceTypeIdentifier === deviceType.identifier) udid = d.udid;
      else run("xcrun", ["simctl", "delete", d.udid]); // stale: wrong runtime or device type
    }
  }
  if (!udid) {
    const created = run("xcrun", ["simctl", "create", SIM_NAME, deviceType.identifier, runtime.identifier]);
    if (!created.ok) return fail(`could not create the verify simulator:\n${created.out}`);
    udid = created.stdout.trim();
  }

  // Boots when shut down, and waits until the device is actually ready.
  const booted = run("xcrun", ["simctl", "bootstatus", udid, "-b"], { timeoutMs: 5 * 60 * 1000 });
  if (!booted.ok) return fail(`the verify simulator did not boot:\n${booted.out}`);
  return { ok: true, out: "", note: `${deviceType.name}, ${runtime.name}`, udid };
}

/** Shuts down every labs-verify device that is running. Never touches other simulators. */
export function shutdownVerifySimulators() {
  const devices = json(run("xcrun", ["simctl", "list", "devices", "-j"]))?.devices ?? {};
  let stopped = 0;
  for (const list of Object.values(devices)) {
    for (const d of list) {
      if (d.name === SIM_NAME && d.state === "Booted" && run("xcrun", ["simctl", "shutdown", d.udid]).ok) stopped++;
    }
  }
  return stopped;
}

// ---- xcodebuild -----------------------------------------------------------------

/**
 * xcodebuild prints a lot. Keep the lines that say what went wrong (compiler
 * errors, failed expectations, the list of failing tests), without Xcode's own
 * [MT] chatter, and fall back to the end of the log when nothing matches.
 */
export function summarize(out) {
  const lines = out.split("\n").filter((l) => l.trim() && !/\[MT\]|the following command failed|^\s*[|`]/.test(l));
  const wanted = lines.filter(
    (l) => /error:|warning:|✘ Test .*recorded an issue|Failing tests:|^\tLaunchTests|^\t\w+\.\w+\(|\.xcresult$|\*\* .* FAILED \*\*/.test(l),
  );
  const seen = new Set();
  const unique = wanted.filter((l) => !seen.has(l) && seen.add(l));
  const shown = unique.length > 0 ? unique.slice(0, 25) : lines.slice(-15);
  return shown.join("\n");
}

/**
 * Runs `xcodebuild <action>` for the Idea scheme against the verify simulator.
 * action: "build-for-testing" or "test-without-building".
 */
export function xcodebuild({ idea, dir, udid, action }) {
  const derived = join(CACHE_ROOT, "ios", idea, "DerivedData");
  mkdirSync(derived, { recursive: true });
  mkdirSync(PACKAGES_DIR, { recursive: true });

  const args = [
    action,
    "-project", "Idea.xcodeproj",
    "-scheme", "Idea",
    "-destination", `platform=iOS Simulator,id=${udid}`,
    "-derivedDataPath", derived,
    "-clonedSourcePackagesDirPath", PACKAGES_DIR,
  ];
  // Quiet hides the noise of a build, but a quiet test run names the failing
  // tests without saying why. Keep the test log: it is small, and failures need it.
  if (action === "build-for-testing") args.push("-quiet");
  if (action === "test-without-building") {
    // Parallel testing would clone the simulator for UI tests; one device is plenty.
    args.push("-parallel-testing-enabled", "NO", "-maximum-concurrent-test-simulator-destinations", "1");
  }
  const r = run("xcodebuild", args, { cwd: dir, timeoutMs: 30 * 60 * 1000 });
  return { ok: r.ok, out: r.ok ? "" : summarize(r.out) };
}
