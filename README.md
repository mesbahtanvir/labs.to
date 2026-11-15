# labs.to

A monorepo for trying ideas fast. Every idea is a folder with a manifest; checks,
releases and scaffolding are shared and driven by that manifest, so starting an
idea never means rebuilding the pipeline.

Each idea is **native per platform**: a Next.js web app, a Swift/SwiftUI iOS app
and a Kotlin/Compose Android app, backed by Supabase. They are independent
projects that share tooling and conventions, not UI code.

**Validation is local-first.** `pnpm verify` runs everything on this machine, in
about 25-60 seconds for an idea. GitHub Actions is a thin safety net, not the
place where quality is decided.

## Layout

```
apps/<idea>/
  idea.yaml        source of truth: name, stage, platforms, backend, owner, bundle_id
  idea.md          problem, hypothesis, success metric, kill criteria
  supabase/        migrations, RLS tests, seed, local config (the backend)
  web/             Next.js project (a pnpm workspace package)
  ios/             SwiftUI app; project.yml (XcodeGen) is the source of the Xcode project
  android/         Jetpack Compose app (Gradle); :app, plus :backend when there is a backend
packages/<platform>/   code shared across ideas on one platform
templates/<platform>/  what `pnpm new` stamps out (overlays/ add backend-specific files)
tooling/               generator, verify, release, doctor, planner, secrets scanner, Supabase wrappers
.githooks/             pre-commit and pre-push, installed by `pnpm install`
.github/workflows/     ci.yml plus reusable _web.yml and _supabase.yml; release.yml (GitHub Releases)
.claude/skills/        setup, try-locally, ship, new-idea: the local-to-landing flow for Claude
.env.example           what this machine needs (copied to the git-ignored .env.labs)
```

## The flow, in one screen

```
pnpm doctor --init       once per machine: creates .env.labs; fill in the iOS lines
pnpm doctor --for ios    says what is still missing, by name (never a value)

pnpm new my-idea         start an idea
(try it)                 pnpm sb my-idea start, pnpm --filter @labs/my-idea-web dev, pnpm ios my-idea
pnpm verify my-idea      the gate; push when it passes (the hook checks)
pnpm release my-idea ios --dry-run     then, without --dry-run, to TestFlight
```

Everything you set up is on this machine: **GitHub holds no secrets.** The only secrets are
the App Store Connect key (keep the `.p8` in 1Password or on disk) and ids in `.env.labs`.
After a release, a small workflow turns the pushed tag into a GitHub Release. Claude drives
the same commands through the skills in `.claude/skills/` (see "Working with Claude").

## Start an idea

```bash
pnpm install
pnpm new my-idea                          # web + supabase, stage: prototype
pnpm new my-idea --platforms web,ios,android   # any mix of platforms
pnpm new my-idea --stage spark            # idea.md only, no code
pnpm new my-idea --backend none           # no Supabase (default is supabase)
```

With the Supabase backend, the idea has its own local dev stack (needs Docker):

```bash
pnpm sb my-idea start       # the pinned Supabase CLI, pointed at apps/my-idea
pnpm sb my-idea status      # URLs and the local publishable key for .env.local
pnpm sb my-idea db reset    # apply migrations + seed from scratch
pnpm types my-idea          # regenerate client types after a schema change
pnpm sb my-idea stop        # stop it when idle (a minimal stack uses ~440 MiB)
```

An iOS app needs Xcode and `brew install xcodegen` (once). It reads its backend
address from `ios/Config/*.xcconfig`; copy `Config/Local.xcconfig.example` to
`Local.xcconfig` (git-ignored) and paste the local publishable key from `pnpm sb my-idea status`.

```bash
pnpm ios my-idea            # generate Idea.xcodeproj from project.yml and open it in Xcode
pnpm ios my-idea generate   # generate only
```

The Xcode project is generated and git-ignored. Change settings, targets and
packages in `project.yml`, never in Xcode's project editor, or the change is lost
the next time the project is generated. New Swift files under `Sources/` and
`Tests/` are picked up automatically.

An Android app needs Android Studio (for the SDK, emulator and command-line tools) and
a JDK 17 or newer on your `PATH`. Its Supabase address and key come from
`android/local.properties` (git-ignored; copy `local.properties.example`). Debug builds
reach the local stack at `10.0.2.2`, which is your computer as the emulator sees it.

```bash
cd apps/my-idea/android && ./gradlew assembleDebug   # or open the folder in Android Studio
```

Everything lives in Gradle, so there is no generated project to protect. Versions are
pinned in `gradle/libs.versions.toml` and `gradle/wrapper/`.

Fill in `apps/my-idea/idea.md`, build, then verify and push.

## Verify, then push

```bash
pnpm verify                 # what changed since origin/main (everything if unsure)
pnpm verify my-idea         # exactly this idea
pnpm verify --keep          # leave the throwaway Supabase stack, simulator and emulator up
pnpm verify --cleanup       # stop leftover throwaway stacks, the simulator and the emulator
pnpm scan                   # secrets scan on its own
```

`verify` runs: frozen-lockfile install, manifests, secrets scan, the tooling's own unit
tests (`pnpm test`, under a second), then per idea
the backend (migrations apply from scratch, pgTAP tests, schema lint, client
types up to date), the web app (typecheck, lint, test, build), the iOS app
(generate project, swift-format, build, unit and UI tests on a simulator) and the
Android app (ktlint, unit tests, Android lint, build, Compose UI tests on an
emulator). Every step is a plain script; nothing needs an LLM until a step fails.

Measured on the maintainer's machine for one idea: web + backend about 56s cold
(the Supabase stack starts), about 24s warm. iOS about 100s the first time
(creates the simulator, clones and compiles the Supabase package) and about 25-40s
after that. Android about 15-40s warm, with the emulator restored from its quick-boot
snapshot in a few seconds. Web, backend, iOS and Android together: about 2.5 minutes.

Android's first run is the slow one: Gradle, Android Lint and the test libraries
download once (more than half an hour in total on a slow network), and the emulator is
created and cold-booted (about 5 minutes). The emulator tests are also the step most
sensitive to machine load: the same step took from 5 seconds to a few minutes while
the maintainer's machine was busy.

- **It never touches your dev database.** The backend checks run on a throwaway
  stack (`<idea>-verify`, ports 2000 below the dev ports) that is deleted after
  the run. A running dev stack and a verify run coexist.
- **It never touches your simulators either.** iOS tests run on a simulator that
  verify owns, named `labs-verify` (an iPhone 17 Pro on the iOS runtime matching
  the installed Xcode SDK, created on first use). It is shut down after the run
  unless you pass `--keep`. Build caches live in `~/Library/Caches/labs.to/`
  (derived data per idea, Swift packages shared); delete that folder any time to
  start cold.
- **Nor your emulators.** Android UI tests run on an AVD that verify owns, named
  `labs-verify`, on its own port (adb serial `emulator-5584`), started headless and shut
  down afterwards unless you pass `--keep`. It is created from a system image you
  already have installed (verify never downloads one; it tells you the `sdkmanager`
  command if none is installed). Gradle is pointed at that one device, so an emulator
  you have open is left alone. The AVD takes about 5 GB (`~/.android/avd/labs-verify.avd`,
  mostly its quick-boot snapshot); remove it any time with
  `avdmanager delete avd -n labs-verify` and the next run recreates it.
- **A passing full-scope run writes a stamp** keyed to the git tree hash of the
  exact files verified, stored in `.git/labs-verified/`. Any content change,
  including a rebase that pulls in someone else's work, invalidates it.
- **Hooks.** `pre-commit` scans staged changes for secrets and validates manifests
  (under a second). `pre-push` refuses commits that have no stamp. It does not
  run the checks itself, so a push never hangs. `git push --no-verify` bypasses
  both on purpose; the CI guard below is the backstop.

## Release

```bash
pnpm release my-idea ios --dry-run     # everything except signing, uploading and tagging
pnpm release my-idea ios               # next patch version (0.1.0 for a first release)
pnpm release my-idea ios --bump minor  # or --version 1.0.0
pnpm release my-idea web               # the same three forms for a web app
```

Releasing is a local command, like `verify`: no CI minutes, no macOS runner. iOS
(TestFlight) and web (Vercel) exist so far; Android and the hosted backend come next.

- **The tag is the version.** A release is the annotated tag `<idea>/<platform>/vX.Y.Z`
  (for example `notes/ios/v0.2.1`). The next version is computed from the highest
  existing tag, so there is no version file to edit and no "bump" commit that would
  invalidate the verify stamp. The build number is the commit count, which only grows.
  Both are passed to the build as settings; nothing in the tree changes.
- **A release is refused unless** the idea is `alpha` or `live`, you are on `main`, the
  tree is clean, this exact commit has a `verify` stamp, it is already on `origin/main`,
  and the tag is free locally and on origin. For a Supabase idea, the Release
  configuration (iOS) or the Vercel project's environment (web) must also point at an https
  hosted project (not a local address) and have a publishable key. Every reason is listed
  at once. `--dry-run` reports the same list as "would be blocked by" and still builds, so
  a work in progress can prove that it builds.
- **The tag is created last**, after the upload succeeded and then pushed, so a failed
  upload leaves no tag and re-running simply tries again. If only the tag push fails, the
  message gives the exact `git push` to run.

**iOS.** `xcodebuild archive` for a device, then one `xcodebuild -exportArchive` that
signs for the App Store and uploads to App Store Connect. No fastlane: Xcode already
does both, and an API key lets it do so without an Apple ID session. `alpha` builds are
marked internal-only (reachable by your own App Store Connect users, never external
testers or the store); `live` builds are not. The dry run builds an unsigned archive and
checks that it carries the version, build number and bundle id it should.

**Web.** The release builds a clean export of `HEAD` (`git archive`), never the working copy,
so an untracked `.env.local`, a stale `.next` or a file that was never committed cannot
change what ships: you release exactly the commit that passed `verify`. Then Vercel's own
`vercel build` runs here, and `vercel deploy --prebuilt` uploads the result, so nothing is
built on Vercel's servers. Each idea is one Vercel project, `labs-<idea>`, with Root Directory
`apps/<idea>/web`; the first real release creates it and later ones put its settings back if
they were changed. `live` ideas deploy to production. `alpha` ideas deploy to a preview
deployment, which Vercel keeps behind its own sign-in by default (the web counterpart of
internal TestFlight). The dry run builds the exported tree with the app's own scripts, which
proves that the commit builds from a clean checkout, without an account and without touching
Vercel. For a Supabase idea, the real release stops until the Vercel project's environment
has a hosted `NEXT_PUBLIC_SUPABASE_URL` and publishable key (hosted Supabase is not built
yet, so that step is manual for now).

One-time setup, per machine and per app. The per-machine settings live in one git-ignored
file, `.env.labs`, which `pnpm release` and `pnpm doctor` read (a real environment
variable still wins over it):

```bash
pnpm doctor --init       # creates .env.labs from .env.example, mode 600
pnpm doctor --for ios    # lists, by name, what is still missing; exits 1 until it is all there
pnpm doctor --for web    # the same for Vercel
```

1. In App Store Connect, Users and Access, Integrations: create an API key (an Admin
   key is the safe choice, since Xcode uses it to create and update provisioning
   profiles) and download the `.p8` once. Keep it in 1Password.
2. In `.env.labs`: `ASC_KEY_ID`, `ASC_ISSUER_ID`, and the key as `ASC_KEY_PATH` (a file) or
   `ASC_KEY_OP_REF` (a 1Password reference such as `op://Private/App Store Connect key/file`;
   the key is read into a private temporary file for the upload and deleted afterwards).
   Apple's conventional `~/.appstoreconnect/private_keys/AuthKey_<id>.p8` also works.
3. The developer team: `LABS_APPLE_TEAM_ID` in `.env.labs` (covers every iOS idea), or
   `DEVELOPMENT_TEAM` in an idea's untracked `Config/Local.xcconfig`.
4. Per app, once: create the app in App Store Connect with the idea's `bundle_id`
   (Apple's API cannot create apps), and add an internal testing group with automatic
   distribution turned on, so new builds reach your testers by themselves.
5. For web, `VERCEL_TOKEN` from vercel.com/account/tokens, and the Vercel CLI
   (`npm install --global vercel`). The token can deploy to your account, so put an
   `op://` 1Password reference in `.env.labs` rather than the token itself. Add
   `VERCEL_TEAM_ID` only if the projects belong to a team. Nothing exists in Vercel until
   the first real release creates the project.

`.env.labs` is not the web app's `apps/<idea>/web/.env.local`: that one is the Next.js app's
own. Prefer references and file paths in `.env.labs` to pasted secrets. `doctor` and
`release` print names and states, never values.

Build archives are kept in `~/Library/Caches/labs.to/ios/<idea>/releases/`; delete them
any time.

**After the upload**, `release.yml` runs on GitHub when the tag arrives and creates a GitHub
Release for it, with notes listing the commits that touched the idea since its previous
release (`alpha` builds are marked as prereleases). That is the record of what landed
where and when. It builds and deploys nothing, needs no secret (only the built-in token),
and refuses a tag that is not on `main`, which means the tag was not made by `pnpm release`.
`node tooling/release-notes.mjs <tag>` shows what it would say.

## Working with Claude

Four project skills in `.claude/skills/` carry the flow above, so an agent does not have to
rediscover it. They call the same commands you do, and the rules in `CLAUDE.md` still apply.

| skill         | for                                                                          |
| ------------- | ---------------------------------------------------------------------------- |
| `setup`       | this machine: doctor, `.env.labs`, the App Store Connect key                 |
| `new-idea`    | `pnpm new`, then `idea.md`                                                    |
| `try-locally` | run an idea (backend, web, iOS, Android) so you can look at it, then verify  |
| `ship`        | doctor, verify, dry run, then the real release, with your yes before upload  |

A test keeps them honest: each skill's name matches its folder, and every `pnpm` command a
skill mentions must exist.

## Stages

The `stage` in `idea.yaml` controls how much shared process an idea carries.
Local `verify` always runs every check, since it is cheap. Stage decides what runs
on GitHub.

| stage       | meaning                              | GitHub Actions                       |
| ----------- | ------------------------------------ | ------------------------------------ |
| `spark`     | a written idea                       | nothing                              |
| `prototype` | code, local only                     | guard only                           |
| `alpha`     | testers (TestFlight internal builds and Vercel preview deployments work; hosted Supabase and Play are not built yet) | guard only |
| `live`      | real users                           | guard + clean-checkout re-run of web and backend checks |
| `archived`  | parked                               | nothing                              |

Promote an idea by editing `stage` in a PR.

## What runs on GitHub

Deliberately little, because the real gate is local and Linux minutes are metered.
`ci.yml` has:

- **`guard`** (seconds, every PR and push): every `idea.yaml` is valid, and no
  secrets are in the tree (`tooling/scan-secrets.mjs`: high-signal patterns only,
  no history scan; gitleaks is a drop-in upgrade).
- **`web` / `supabase`** (only for `live` ideas, only when they changed): a re-run of
  the same `pnpm verify` in a clean checkout. This catches "works on my laptop".
- **`ci-ok`**: the single status to require in branch protection, since the matrix
  jobs vary and are often skipped.

`release.yml` is separate: it runs only when a release tag `<idea>/<platform>/vX.Y.Z` is
pushed, and only creates the GitHub Release (see Release). No workflow reads a repository
secret, no job runs on macOS, and a test enforces both.

iOS is never built on GitHub (macOS minutes cost about 10x Linux). Android is not
either, for now: its emulator tests are local, and a Linux job could be added for a
`live` idea if it ever earns its minutes. Both are gated by `pnpm verify` and the
pre-push hook.

## Platform status

| platform | scaffold | local `verify` | GitHub (live only) | release |
| -------- | -------- | -------------- | ------------------ | ------- |
| web      | done     | done           | written, never run | built, never run for real |
| supabase | done     | done           | written, never run | not yet |
| ios      | done     | done           | never (by design)  | built, never run for real |
| android  | done     | done           | not yet            | not yet |

## Decisions

- **Local-first validation, minimal CI.** One command proves an idea on this machine;
  the stamp and hooks keep unverified content from being pushed; GitHub only checks
  what must not depend on one laptop. Optimizes for cost and for fast iteration.
- **Native per platform, not a cross-platform framework.** Best platform fidelity
  and no framework lock-in. The cost is implementing each feature per platform,
  which is why ideas start web-only and add platforms when they earn it.
- **What is shared:** the manifest, verify and release machinery, templates, and
  (planned) design tokens. Not UI code.
- **No Turborepo yet.** One planner covers all platforms, native included. Add a
  task cache when web build times justify it.
- **Pinned for compatibility.** `typescript ~6.0` because typescript-eslint does
  not support TS 7; `eslint ^9` because the plugins behind `eslint-config-next`
  do not declare ESLint 10 support. ESLint 9 is end-of-life upstream, so revisit
  when those plugins widen their ranges.
- **Supabase is the default backend, one project per idea.** The schema is the
  contract between platforms: migrations are the source, and client types are
  generated from the local database (`pnpm types`). The CLI generates TypeScript
  and Swift but not Kotlin, so Android models are written by hand. One project per
  idea keeps ideas disposable (archive the idea, delete the project), but Supabase's
  free plan allows only 2 active projects, so hosted projects should start at
  `alpha`, not at `prototype`. Prototypes run on the local stack only.
- **Local stacks use ports 44320-49151**, one block of 10 per idea, allocated in
  order by `pnpm new`. Supabase's defaults collide with other local Supabase
  projects on the same machine. Verify stacks sit exactly 2000 below.
- **The Supabase CLI is pinned to exactly 2.105.0.** `config.toml` keys are tied to
  the CLI version (2.105.0 rejected a config written by 3.0.0), so the template
  config and the pinned CLI must come from the same version. 3.0.0 also hung on
  `start` on the maintainer's machine, while 2.105.0 is what their other projects
  already run. Upgrade deliberately: bump the pin, regenerate
  `templates/supabase/config.toml` with `supabase init`, re-verify.
- **iOS: the Xcode project is generated, not committed.** `project.yml` (XcodeGen)
  is the source, so there are no `.pbxproj` merge conflicts and an agent can edit
  the project as plain text. Targets and the scheme have fixed names (`Idea`,
  `IdeaTests`, `IdeaUITests`) in every idea so tooling never needs an idea's name;
  users see the title through `CFBundleDisplayName`. The Supabase overlay replaces
  `backend.yml`, which `project.yml` includes (XcodeGen appends arrays and merges
  maps), so `--backend none` carries no Supabase code.
- **iOS is Swift 6 with warnings as errors.** Strict concurrency catches data races
  at compile time, and a warning never lands unnoticed. Deployment target is iOS 18.
  Formatting is `swift-format` from the Xcode toolchain (no extra install), so
  its rules follow the Xcode version.
- **iOS tests are Swift Testing for unit tests and XCTest for UI tests**, run in
  one `xcodebuild` invocation on the verify simulator. Unit tests are hosted by the
  app, so a crash at launch fails them too.
- **The Supabase Swift package is pinned to an exact version** in
  `backend.yml`. Its own dependencies are not locked, because `Package.resolved`
  lives inside the generated project. Bump it deliberately, regenerate types, verify.
- **Android: Gradle is the source, and names are fixed.** Kotlin DSL with a version
  catalog. Modules are `:app` and, when the idea has a backend, `:backend` (the Supabase
  client, models and their tests). `settings.gradle.kts` includes `:backend` only if the
  folder exists, and `:app` depends on it only then, so `--backend none` carries no
  Supabase code. The Kotlin package is `to.labs.idea` in every idea; the real app
  identity (`applicationId`) is the `bundle_id` from `idea.yaml`. Compose, Material 3,
  `minSdk` 26, `compileSdk` and `targetSdk` 37.
- **Android is on AGP 9.2.1 with Gradle 9.4.1, deliberately not the newest.** AGP 9.3
  needs Gradle 9.5, and 9.4 and 9.5 need Gradle 9.6, whose distribution is served from
  GitHub release assets. On the maintainer's network that download ran at 10-20 KB/s and
  timed out, while 9.4.1 was already on the machine. 9.2.1 is the newest AGP that runs
  on it. When Gradle 9.6 is reachable, move the Gradle wrapper and AGP together
  (`./gradlew wrapper --gradle-version <v> --gradle-distribution-sha256-sum <the
  published sum>`, then `agp` in `gradle/libs.versions.toml`) and re-verify. The wrapper
  jar is the official one (its checksum matches Gradle's published value) and the
  distribution is pinned by checksum.
- **Android is as strict as iOS.** Kotlin warnings are errors, with the compiler's extra
  checks (`-Wextra`) on, because without them an unused variable is not even a warning.
  Android Lint warnings are errors, and formatting is ktlint through kotlinter
  (`ktlint_official` style). Unit
  tests are JUnit 4 on the JVM; UI tests are Compose tests on the verify emulator.
- **Supabase on Android uses supabase-kt, and its models are hand-written.** The CLI
  cannot generate Kotlin, so `:backend` mirrors the schema in `Models.kt`, and a test
  decodes a real row shape. Nothing checks the models against the live schema yet.
- **Android debug builds allow cleartext http** (the local stack is plain http) through a
  debug-only manifest; release builds keep the secure default.
- **Releases are tags, computed from tags.** No version file and no bump commit, so a
  release never invalidates the verify stamp. The build number is the commit count
  (monotonic along `main`; do not rewrite published history). `pre-push` skips tag
  pushes on purpose: the release command has already checked the commit.
- **iOS releases use `xcodebuild` directly, not fastlane.** It is already installed, signs
  and uploads in one step, and avoids a Ruby toolchain and its version drift. The
  archive is signed automatically (`-allowProvisioningUpdates` with the API key) and the
  export re-signs for distribution, which is what Xcode itself does. The API key stays
  out of the repo: it comes from the environment, a file, or 1Password.
- **A Release build must not inherit the local backend.** In the Supabase overlay,
  `Release.xcconfig` includes `Local.xcconfig` first and sets the hosted URL and key
  after it, so the local publishable key can never be shipped; Debug does the opposite.
  The hosted URL and publishable key are public by design and tracked in that file.
- **Secrets live on this machine, in one file, and GitHub holds none.** Releases run
  from the laptop, so the App Store Connect key never has to be copied into GitHub, where
  it would be one more place to leak from. `.env.labs` holds ids, paths and references;
  the one real secret stays a file or a 1Password item. If a deploy ever has to run on
  GitHub (for example web, so the laptop need not be on), that is a deliberate change with
  its own secrets, not a default.
- **Web releases build a clean export of HEAD, not the working copy.** Next.js loads
  `.env.local` into production builds too, so building in place would ship whatever local
  address sat in that file (the web counterpart of a Debug key in a Release build). Building
  from `git archive` makes that impossible and ties the deployment to the verified commit.
  The cost is a fresh install per release, which pnpm's content store keeps to seconds.
- **One Vercel project per idea, set up by the release itself.** Root Directory, install
  command (`--ignore-scripts`, so the root package's Supabase CLI never downloads a binary) and
  "include files outside the root directory" are what the pnpm workspace needs, and a
  dashboard click is the kind of manual step a release should not depend on. The token is
  handed to the Vercel CLI through a private temporary config directory, so it never
  appears in a process listing.
- **`VERCEL_API_URL` exists only for rehearsals.** It points the tooling and the real
  Vercel CLI at a stand-in server, and it is honoured only for a loopback address, so it can
  never send the token anywhere else.
- **The GitHub Release is bookkeeping, not delivery.** It is created after the fact from
  the tag, so a GitHub outage or a bug in the workflow can never block or break a release.
- **The Info.plist takes its versions from build settings.** XcodeGen otherwise writes a
  literal `1.0` and `1`, which made `MARKETING_VERSION` do nothing. The release dry run
  reads the archive back to catch exactly this.
- **Every public table must have RLS.** The publishable key ships in every client,
  so `tests/database/00_rls_enabled.test.sql` fails if any table forgets it.
- **Local Supabase stacks listen on all network interfaces with default keys**
  (the CLI says so itself). Stop them on untrusted networks.

## Known gaps

- The GitHub workflows have never run on GitHub and were not linted with
  `actionlint`; they were only parsed as YAML. Expect to fix something on the first PR.
  For `release.yml`, the notes script ran against real tags in a scratch repository and
  the `gh release create` step ran against a test double of `gh`; the first real tag push
  is its first run on GitHub (one doubt: whether `actions/checkout` keeps a tag annotated,
  which only affects the stage and build number in the notes, not the release).
- Secrets scanning covers the current tree, not git history.
- `pre-push` can be bypassed with `--no-verify`.
- iOS verification covers the simulator only, with no end-to-end flow against the
  local Supabase stack (planned with Maestro).
- `pnpm release` for iOS has never signed or uploaded for real: that needs your App Store
  Connect key and an app record. Everything else, from the checks to the unsigned device
  archive, the version and build number inside it, the tagging and the key handling, ran
  against test doubles of `xcodebuild`'s export step and of 1Password. Expect the first real
  run to teach us something (a team with no registered device can make Xcode refuse to
  create the development profile it uses for the archive).
- `pnpm release` for web has never talked to the real Vercel. The real `vercel pull`,
  `vercel build` and `vercel deploy --prebuilt` ran end to end against a stand-in API on
  loopback, so the monorepo build (pnpm workspace, Root Directory `apps/<idea>/web`, the
  install command, the output) is proven; what is not proven is Vercel's own REST API: the
  project is created and corrected with `POST /v11/projects` and `PATCH /v9/projects/{id}`,
  using field names written from documentation. Expect the first real run to teach us
  something there. A preview deployment's URL changes on every release; a stable one for
  testers would need an alias, which is not built.
- Releases of Android and the hosted Supabase project are not built yet, so `pnpm
  doctor` lists them as such, and the `ship` skill says so instead of improvising a deploy.
- iOS packages' own dependencies are resolved fresh, not locked (see Decisions).
- Android verification is emulator-only too: no device builds, signing or app bundles
  yet, and no end-to-end flow against the local stack. It does not download a system
  image for you (it prints the `sdkmanager` command), and the first run downloads Gradle
  libraries, which can take a long time on a slow network. The Gradle daemon is left to
  expire on its own (10 idle minutes).
- Android models of the schema are not checked against the database (see Decisions).
- The Android checks have run on one machine and one JDK (17).
- The iOS checks have never run on another machine or another Xcode version.

## Roadmap

1. ~~Skeleton, manifest, generator, web template~~ (done)
2. ~~Supabase backend, local `verify`, stamp, hooks, thin CI~~ (done)
3. ~~iOS template (XcodeGen + SwiftUI) with a local simulator verifier~~ (done)
4. ~~Android template (Compose + Gradle) with a local emulator verifier~~ (done)
5. Release (`pnpm release`: tags `<idea>/<platform>/vX.Y.Z`, local signing and upload)
   - ~~core: versions, tags, checks, `--dry-run`; iOS to TestFlight~~ (built; not yet run for real)
   - ~~web deploy (Vercel, built locally and uploaded)~~ (built; not yet run against the real Vercel)
   - hosted Supabase for `alpha` (`db push`, hosted URL and key per idea)
   - Android to the Play internal track
6. Design tokens shared across platforms; end-to-end flows (Playwright, Maestro)
