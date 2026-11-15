---
name: ship
description: Take an idea from working locally to testers or users. Use when the user asks to ship, release, deploy, publish, upload to TestFlight, deploy to Vercel, "push it live", cut a version, or asks what is blocking a release.
---

# Ship an idea

Landing is a local command, `pnpm release`. It builds and uploads from this machine, and only
then tags and pushes the tag. GitHub does bookkeeping afterwards (a GitHub Release from the
tag) and holds no deploy secrets. Two platforms exist:

- **ios** goes to TestFlight (`alpha` is internal testers only).
- **web** goes to Vercel, one project per idea, built here from a clean export of the committed
  tree and then uploaded. `live` deploys to production; `alpha` to a preview deployment that
  Vercel keeps behind its own sign-in.

Android (Play) and hosted Supabase are not built: say so, do not improvise a deploy.

## Steps

1. Pin down the idea and platform. Read `apps/<idea>/idea.yaml`: only `alpha` and `live` ideas
   release (`alpha` goes to internal testers only). If the stage is `prototype`, tell the user
   that promoting it means editing `stage` in `idea.yaml` in a commit, and ask before doing it.
2. `pnpm doctor --for ios` or `--for web`. If it fails, switch to the `setup` skill. Do not go on past a failure.
3. `pnpm verify <idea>` and fix failures at the cause. Never skip it and never `git push --no-verify`:
   the release refuses a commit without a verify stamp.
4. The commit must be on `main` and on `origin/main`. Commit and push only when the user has said
   to, or ask. The pre-push hook checks the stamp.
5. `pnpm release <idea> <ios|web> --dry-run`. It lists every blocker at once ("would be blocked
   by"), then builds: an unsigned archive for ios, a clean export of the committed tree for web
   (so uncommitted edits are not in it). Fix each cause. Its header shows the version, the build
   number, the tag and where it would land. A web dry run proves the commit builds from a clean
   checkout; Vercel's own build and the upload happen only in a real release.
6. A real release uploads (to App Store Connect, or to Vercel, which also creates the idea's Vercel
   project the first time) and pushes a tag. It is outward facing, so get a clear yes in this
   conversation for this idea, platform and version (quote the version and destination from the
   dry run), then run `pnpm release <idea> <ios|web>`. Add `--bump minor|major` or
   `--version X.Y.Z` only when the user asks for one.
7. Report what happened: the tag and build number, then the part that is platform specific. ios:
   App Store Connect needs a few minutes to process the build before it shows under TestFlight,
   and internal testers get it through the group's automatic distribution. web: the deployment
   URL the command printed, and whether it is production or a preview. The tag push makes GitHub
   create a Release for it.

## Rules

- Never create, move or push a release tag yourself, never edit `MARKETING_VERSION` or a build
  number, and never upload to App Store Connect, a store or Vercel by another route. `pnpm release`
  is the only way.
- Do not work around a blocker: fix verify, push, the stage or the credentials.
- Never print or log signing material or tokens (`.p8`, `VERCEL_TOKEN`, 1Password items).
- For a web idea with the Supabase backend, the release stops until the Vercel project has
  `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for hosted Supabase. Hosted
  Supabase is not built yet, so say that plainly; never point a release at the local stack.
- If only the tag push failed, the tool prints the exact `git push` command; run that one and nothing else.
- Run the real release at most once per request. If it fails after the upload, read its message
  before trying again: a re-run of an ios release would upload the same build number a second time.
