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
  guarantees the layout, manifest and template that tooling expects. A spark
  (`--stage spark`) is created without platforms: its code arrives with `pnpm grow`.
- **An idea that exists grows with `pnpm grow <idea>`, never by hand.** A platform
  (`--platforms`) or a backend (`--backend supabase`) is not added by copying `templates/` or
  by listing it in `idea.yaml` yourself: the command stamps out the same files `pnpm new` would
  have, claims the port block, applies the overlays and updates the manifest (a spark becomes a
  prototype with its first platform). It never overwrites a platform folder. If it refuses
  because the backend overlay would replace an edited file, `--force` is the user's decision,
  not a way past the message. Both commands share `tooling/lib/scaffold.mjs`: change the
  stamping there, never in one command.
- **Every idea is its own Spec Kit project, and a feature starts as a spec.** `pnpm new` installs
  the kit in `apps/<idea>/` (`.specify/`, `.claude/skills/speckit-*`) and writes the idea's
  constitution. A change in behavior goes through that idea's `speckit-specify`, `speckit-plan`,
  `speckit-tasks` and `speckit-implement` (the `build-feature` skill), run with `apps/<idea>` as
  the working directory: Spec Kit's "repo root" is the idea folder, and specs live in
  `apps/<idea>/specs/`. Never add a `.specify/` at this repository's root and never run
  `specify init` here (a test enforces the first). The kit files are copies of
  `templates/speckit/kit/`, which is itself the unedited output of `specify init`: do not edit
  either by hand (a test compares checksums). `pnpm speckit <idea>` repairs an idea's kit;
  the constitution and `specs/` are the idea's own and are never overwritten.
- **`apps/<idea>/idea.yaml` is the source of truth.** Never hardcode an idea's name
  in a workflow, script or config. Anything that needs the list of ideas reads the
  manifests through `tooling/lib/manifest.mjs`.
- **Never add per-idea workflows.** CI is `ci.yml` plus reusable `_<kind>.yml`
  workflows that call `pnpm verify`. There is one definition of "checks pass". The one
  other workflow is `release.yml`, which only turns a pushed release tag into a GitHub
  Release. **GitHub holds no secrets:** no workflow reads `secrets.*` (a test enforces it)
  and deploys run from this machine through `pnpm release`. Moving a deploy onto GitHub is a
  decision for the user, not a convenience to slip in.
- **Project skills live in `.claude/skills/`** (`setup`, `new-idea`, `build-feature`, `try-locally`, `design-review`, `ship`).
  Use them for those jobs, and when a command or rule here changes, update the skill that
  mentions it (a test fails if a skill names a `pnpm` script that does not exist).
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
- **Releases are `pnpm release <idea> <platform>`, never by hand.** The version is the tag
  `<idea>/<platform>/vX.Y.Z` and the build number is the commit count, so never edit
  `MARKETING_VERSION` or a version code to cut a release, and never create or push such a tag
  yourself. Never upload to App Store Connect or a store outside it. Only `alpha` and `live`
  ideas release. Do not work around a blocker it reports: fix the cause (verify, push, stage).
- **Signing material never enters the repo or the output.** The App Store Connect key comes from
  the environment or the git-ignored `.env.labs` (`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH` or
  `ASC_KEY_OP_REF`), the team from `Config/Local.xcconfig` or `LABS_APPLE_TEAM_ID`; the Vercel token is
  `VERCEL_TOKEN` (an `op://` reference is best), with `VERCEL_TEAM_ID` for a team. `pnpm doctor`
  shows what is set, by name only. Do not read `.env.labs`, a `.p8` or a 1Password item to look
  at a value, do not ask the user to paste one into the chat, and do not print or log them. A Release
  build gets its backend from `Config/Release.xcconfig` (hosted URL and publishable key, which
  are public), never from `Local.xcconfig`.
- **Backend-specific template changes go in `templates/overlays/supabase/<platform>/`**,
  not into the base platform template, so `--backend none` stays clean. Prefer an overlay file
  that is new to one that replaces a base file: `pnpm grow --backend` has to write a replacing
  file over an existing app, and refuses when that file was edited.
- **Secrets never enter the repo.** Only `.env.example` is tracked (it lists exactly the
  variables the tooling reads, all empty; a test keeps it in step with `tooling/lib/env.mjs`).
  This machine's values go in the git-ignored `.env.labs` (`pnpm doctor --init`), with secret
  keys in the macOS Keychain or a password manager and only a path or `op://` reference in
  the file. If the scanner flags a deliberate false positive, mark that line with `labs:allow-secret`.
- **Never stop containers that belong to other projects on this machine.** Other
  local Supabase stacks run here. Only touch `<idea>` and `<idea>-verify` stacks. The
  same goes for simulators and emulators: the user's own are theirs; only the iOS
  `labs-verify` device and the Android `labs-verify` AVD (`emulator-5584`) are ours to
  boot, shut down or delete. Never run `gradlew --stop` or kill other Gradle daemons.

## Commands

```bash
pnpm new <name> [--platforms web,ios,android] [--stage prototype] [--backend supabase|none] [--title "Name"]
pnpm grow <idea> [--platforms ios,android] [--backend supabase] [--force]   # add platforms or the backend to an idea that exists
pnpm verify [idea...] [--all] [--keep] [--cleanup]   # the local gate; writes the stamp on success
pnpm sb <idea> start|stop|status|db reset|test db|... # pinned Supabase CLI for one idea
pnpm types <idea> [--check]                          # client types from the dev stack's schema
pnpm ios <idea> [open|generate]                      # generate the Xcode project from project.yml, open it
pnpm speckit <idea>|--all                            # put the Spec Kit files back in an idea (keeps its constitution and specs)
pnpm speckit --refresh-template                      # regenerate templates/speckit/kit with the specify CLI on this machine
pnpm release <idea> ios|web [--dry-run] [--bump minor|--version X.Y.Z]   # TestFlight or Vercel, from this machine
pnpm doctor [--for ios|web] [--init]                 # tools and .env.labs: what is missing, by name; --init creates .env.labs
node tooling/release-notes.mjs <tag>                 # what the GitHub Release for a release tag would say
pnpm test                                            # the tooling's own unit tests (part of verify)
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
compiler warning and a formatting violation, and for Spec Kit an idea without `.specify/`, a
constitution left as the unfilled template and a hand-edited file in `templates/speckit/kit/`,
and confirm `verify` fails each time. A change to how the Supabase CLI is run
(`tooling/lib/exec.mjs`, `watch.mjs`, `supabase.mjs`) is also rehearsed with a CLI that stalls:
point `SUPABASE_CLI_BINARY_OVERRIDE` (read by the CLI's own launcher) at a script that prints
and never exits for one command and runs the real binary otherwise; verify must give up on it,
run it once more and say so, and fail when it stalls twice. Restore mutated files with a checksum-based copy
(`rsync -ac`), since a same-second, same-size edit can look unchanged to a plain
`rsync`. A change to the stamping (`tooling/lib/scaffold.mjs`, `pnpm new`, `pnpm grow`) is also
rehearsed by growing: a spark sample that gets `web`, then `ios,android`, and a `--backend none`
sample that gets `--backend supabase`, each passing `pnpm verify`, and a platform that exists
being refused. Then delete the sample (`pnpm sb sample-idea stop --no-backup` if a dev stack
is up; `pnpm verify --cleanup` stops the verify simulator). Dependency pins (TypeScript, ESLint, the Supabase CLI) exist for
compatibility reasons; read the Decisions in `README.md` before bumping them.

A change to `pnpm release` is rehearsed in a scratch clone, never in this repository: clone
into a scratch folder with its own bare `origin`, generate an `alpha` sample, commit, verify
and push there, and put test doubles of `xcodebuild -exportArchive` and `op` first on `PATH`.
Then try to break it: a dirty tree, an unverified commit, a commit not on `origin/main`, a
branch other than `main`, a `prototype` idea, a tag that exists only on origin, missing
credentials, and a failing upload (no tag may be created, and no temporary key may be left).
Never run a real release, or push a release tag to GitHub, as a test. A web release is
rehearsed against a stand-in Vercel API on loopback (`VERCEL_API_URL=http://127.0.0.1:<port>`, honoured
only for loopback): the real `vercel` CLI and the project calls run against it, with a fake
token. Break it too: a failing deploy (no tag), no token (blocked before any API call), a project whose
settings drifted (corrected), a Supabase idea whose environment is empty or local (blocked before the
build), and an untracked `.env.local` (it must not reach the export). The same scratch clone
rehearses `pnpm doctor`, `.env.labs` (loose permissions, a malformed line, a shell variable
overriding the file) and `tooling/release-notes.mjs` (a tag that is not on main, a tag that is
not a release tag, a lightweight tag), and a test double of `gh` stands in for GitHub.

## Not built yet

Releases of Android (device builds, signing, the Play tracks), hosted Supabase environments,
design tokens, end-to-end flows. Spec Kit is installed in every idea, but nothing checks that
code matches its spec, and the kit comes from the Spec Kit build on this machine (see Known gaps). iOS releases to TestFlight exist but have never been run against
Apple for real, web releases to Vercel exist but have never been run against the real Vercel
(only a stand-in API), and `release.yml` has never run on GitHub. Do not
pretend otherwise in docs, and
do not list an unsupported platform in a manifest (the generator refuses, and
`verify` fails).
