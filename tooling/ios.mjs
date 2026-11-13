#!/usr/bin/env node
// Generates an idea's Xcode project from its project.yml, and opens it.
//
//   pnpm ios <idea>             generate Idea.xcodeproj and open it in Xcode
//   pnpm ios <idea> generate    generate only
//
// The project is a build artifact (git-ignored): project.yml is the source, so
// run this again after pulling changes or editing project.yml.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { APPS_DIR, isValidName } from "./lib/manifest.mjs";
import { generateProject, iosPreflight } from "./lib/ios.mjs";

const [idea, action = "open"] = process.argv.slice(2);
if (!idea || !["open", "generate"].includes(action)) {
  console.error("usage: pnpm ios <idea> [open|generate]");
  process.exit(1);
}
const dir = join(APPS_DIR, idea, "ios");
if (!isValidName(idea) || !existsSync(join(dir, "project.yml"))) {
  console.error(`apps/${idea}/ios/project.yml not found. Is "${idea}" an idea with the ios platform?`);
  process.exit(1);
}

const pre = iosPreflight();
if (!pre.ok) {
  console.error(pre.out);
  process.exit(1);
}
const gen = generateProject(dir);
if (!gen.ok) {
  console.error(gen.out);
  process.exit(1);
}
console.log(`generated apps/${idea}/ios/Idea.xcodeproj`);
if (action === "open") spawnSync("open", [join(dir, "Idea.xcodeproj")], { stdio: "inherit" });
