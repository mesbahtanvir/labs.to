# labs.to: conventions for agents and humans

Monorepo of ideas, native per platform (web, iOS, Android) with a Supabase
backend. Read `README.md` for the layout, stages and decisions. These are the rules
that keep it uniform.

## Principles

- **Validate locally, first.** `pnpm verify` is the gate. GitHub Actions is a thin
  safety net for what must not depend on one laptop. Before proposing any workflow
  job, ask whether a local command could prove the same thing.
- **Optimize for money and quality.** Prefer free tiers and local builds. Never add
  macOS CI. Gate paid or hosted things behind an idea's `stage`.
- **Checks are scripts, not LLM calls.** Run `pnpm verify` and read the output; use
  your judgment only to fix what fails.

## Rules

- **A new idea is created with `pnpm new <name>`, never by hand.** The generator
  guarantees the layout, manifest and template that tooling expects.
- **`apps/<idea>/idea.yaml` is the source of truth.** Never hardcode an idea's name
  in a workflow, script or config. Anything that needs the list of ideas reads the
  manifests through `tooling/lib/manifest.mjs`.
- **Never add per-idea workflows.** CI is `ci.yml` plus reusable `_<kind>.yml`
  workflows that call `pnpm verify`. There is one definition of "checks pass".
- **Platform folders are self-contained.** `apps/<idea>/web`, `ios` and `android`
  must not import from each other. Share through `packages/<platform>/` (code for
  one platform) or generated types and tokens (across platforms).
- **Fix the template, not the copies.** If every new idea needs the same change,
  change `templates/<platform>/`. Existing ideas are updated by a normal change.
- **Promote by editing `stage`.** Do not add ad-hoc gates for one idea.
- **Drive Supabase through `pnpm sb <idea> ...`, never a global `supabase`.** The
  wrapper pins the CLI version and points it at the right folder.
- **Migrations are append-only.** Never edit a migration that has been merged; add a
  new one. Every table in `public` gets RLS and explicit policies (a test enforces
  it).
- **After a schema change, run `pnpm types <idea>`** (dev stack running) and commit the
  regenerated types (TypeScript and Swift); `verify` fails on stale types. Kotlin has no
  generator: update Android models by hand.
- **iOS: edit `apps/<idea>/ios/project.yml`, never the generated `Idea.xcodeproj`.** The
  project is git-ignored and regenerated (`pnpm ios <idea> generate`); changes made in
  Xcode's project editor are lost. Keep the fixed target names (`Idea`, `IdeaTests`,
  `IdeaUITests`): tooling relies on them. Swift is Swift 6 with warnings as errors, so
  fix a warning, do not silence it. Per-machine values (signing team, local key) go in
  the untracked `Config/Local.xcconfig`.
- **Android: Gradle is the source of truth, and names are fixed.** Modules are `:app` (and
  `:backend` when the idea has one), the Kotlin package is `to.labs.idea`, and the real
  app identity (`applicationId`) comes from `idea.yaml`. Kotlin warnings and Android Lint
  warnings fail the build, so fix them, do not suppress them. Versions are pinned in
  `gradle/libs.versions.toml` and `gradle/wrapper/`; read the Decisions in `README.md`
  before bumping AGP or Gradle (they move together). Per-machine values (the local key,
  a LAN address) go in the untracked `local.properties`. Kotlin models of the schema are
  written by hand in `:backend`: update them in the same change as the migration.
- **Backend-specific template changes go in `templates/overlays/supabase/<platform>/`**,
  not into the base platform template, so `--backend none` stays clean.
- **Secrets never enter the repo.** Only `.env.example` is tracked. Put secret keys in
  the macOS Keychain or a password manager. If the scanner flags a deliberate false
  positive, mark that line with `labs:allow-secret`.
- **Never stop containers that belong to other projects on this machine.** Other
  local Supabase stacks run here. Only touch `<idea>` and `<idea>-verify` stacks. The
  same goes for simulators and emulators: the user's own are theirs; only the iOS
  `labs-verify` device and the Android `labs-verify` AVD (`emulator-5584`) are ours to
  boot, shut down or delete. Never run `gradlew --stop` or kill other Gradle daemons.

## Commands

```bash
pnpm new <name> [--platforms web,ios,android] [--stage prototype] [--backend supabase|none] [--title "Name"]
pnpm verify [idea...] [--all] [--keep] [--cleanup]   # the local gate; writes the stamp on success
pnpm sb <idea> start|stop|status|db reset|test db|... # pinned Supabase CLI for one idea
pnpm types <idea> [--check]                          # client types from the dev stack's schema
pnpm ios <idea> [open|generate]                      # generate the Xcode project from project.yml, open it
(cd apps/<idea>/android && ./gradlew <task>)         # Android builds are plain Gradle (assembleDebug, lintKotlin, ...)
pnpm scan [--staged]                                 # secrets scan
pnpm validate                                        # check every idea.yaml
pnpm plan                                            # what verify/CI would cover (all active ideas)
pnpm --filter @labs/<idea>-web dev|build|typecheck|lint|test
```

## Workflow

1. Change things. Run `pnpm verify` (add `--keep` while iterating on the backend).
2. Commit. The pre-commit hook scans for secrets.
3. Push. The pre-push hook requires a stamp for exactly that content; if you rebased or
   changed anything after verifying, run `pnpm verify` again.
4. Never use `git push --no-verify` or bypass hooks unless the user explicitly asks.

## Verify before declaring done

A change to `templates/` or `tooling/` is not verified until you have generated an
idea from it (`pnpm new sample-idea`), run `pnpm install`, and `pnpm verify` passes
for it (this exercises the Supabase stack, the web checks and, with
`--platforms web,ios,android`, the iOS and Android builds and tests on the simulator and
emulator). Also try to break it: a table without RLS, a type error, a stale-types
migration, and for each mobile platform a failing unit test, a failing UI test, a
compiler warning and a formatting violation, and confirm `verify` fails each time. Restore mutated files with a checksum-based copy
(`rsync -ac`), since a same-second, same-size edit can look unchanged to a plain
`rsync`. Then delete the sample (`pnpm sb sample-idea stop --no-backup` if a dev stack
is up; `pnpm verify --cleanup` stops the verify simulator). Dependency pins (TypeScript, ESLint, the Supabase CLI) exist for
compatibility reasons; read the Decisions in `README.md` before bumping them.

## Not built yet

Releases and deploys (including iOS and Android device builds, signing, TestFlight and
the Play tracks), hosted Supabase environments, design tokens, end-to-end flows. Do not pretend otherwise in docs, and
do not list an unsupported platform in a manifest (the generator refuses, and
`verify` fails).
