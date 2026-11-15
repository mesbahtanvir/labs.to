---
name: try-locally
description: Run an idea on this machine so the user can see and use it, then prove it. Use when the user wants to try, run, preview or demo an idea, see a change working, or test the app locally before pushing.
---

# Try an idea locally

Trying an app and verifying it are different. Trying lets the user look at it; `pnpm verify`
proves it. Do the first, then always the second.

## Backend (when `apps/<idea>/supabase` exists)

```bash
pnpm sb <idea> start      # the idea's own local stack; needs Docker
pnpm sb <idea> status     # URLs and the local publishable key
pnpm sb <idea> db reset   # migrations and seed from scratch, when the schema changed
```

After a schema change also run `pnpm types <idea>` and commit the regenerated types.
Stop the stack when you are done: `pnpm sb <idea> stop`. Only ever touch `<idea>` and
`<idea>-verify` stacks; other projects' containers on this machine are not yours.

## Web

1. If `apps/<idea>/web/.env.local` is missing, copy `.env.example` there and put the local
   publishable key from `pnpm sb <idea> status` in it (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`).
2. Start it in the background: `pnpm --filter @labs/<idea>-web dev`, then open
   http://localhost:3000 and look at the page, not only at the logs.

## iOS

1. If `apps/<idea>/ios/Config/Local.xcconfig` is missing, copy `Local.xcconfig.example` there and
   paste the key from `pnpm sb <idea> status`.
2. `pnpm ios <idea>` generates the Xcode project and opens it. Never edit the generated project;
   change `project.yml`.
3. To run on a simulator, use one the user already has booted, or ask which to boot. `labs-verify`
   belongs to `pnpm verify`; leave it alone.

## Android

1. If `apps/<idea>/android/local.properties` is missing, copy `local.properties.example` and
   paste the key. Debug builds reach the stack at `10.0.2.2`.
2. `cd apps/<idea>/android && ./gradlew installDebug` onto an emulator the user has open. The
   `labs-verify` AVD (`emulator-5584`) belongs to `pnpm verify`; leave it alone.

## Then prove it

`pnpm verify <idea>`. Report what passed and what failed, fix failures at the cause, and say plainly
what you could not check (for example a flow you did not click through). When it passes and the
user is happy, the next step is the `ship` skill.
