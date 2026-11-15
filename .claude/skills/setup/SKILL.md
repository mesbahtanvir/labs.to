---
name: setup
description: One-time setup of this machine for testing and releasing ideas, which means the secrets, the tools and the App Store Connect key. Use when the user asks to set up, configure or "get ready to ship", when a credential is missing, or when `pnpm doctor` or `pnpm release` reports that something is not set.
---

# Set up this machine

Everything the tooling needs from outside the repository lives in one git-ignored file,
`.env.labs`, which `pnpm release` and `pnpm doctor` read. A real environment variable
beats the file. GitHub holds no secrets: releases run from this machine.

## Steps

1. Run `pnpm doctor`, adding `--for ios` (TestFlight) or `--for web` (Vercel) for the goal. It names every missing
   tool and credential, and how to fix a tool. It prints states, never values.
2. If `.env.labs` does not exist, run `pnpm doctor --init`. It copies `.env.example` and sets mode 600.
3. For each missing iOS item, tell the user where to get it and let them fill the line in:
   - `ASC_KEY_ID`, `ASC_ISSUER_ID`: App Store Connect, Users and Access, Integrations,
     App Store Connect API. Create an Admin key (Xcode uses it to manage provisioning) and
     download the `.p8` once; Apple shows it only once.
   - The key itself: keep the `.p8` in 1Password and set `ASC_KEY_OP_REF=op://vault/item/field`,
     or save the file and set `ASC_KEY_PATH`.
   - `LABS_APPLE_TEAM_ID`: the 10-character Team ID in developer.apple.com, Membership details.
   - Once per app: create the app in App Store Connect with the idea's `bundle_id` (in
     `apps/<idea>/idea.yaml`; Apple's API cannot create apps), and add an internal testing
     group with automatic distribution turned on.
4. For web, the one thing needed is `VERCEL_TOKEN`, from vercel.com/account/tokens. It can deploy to
   the user's account, so suggest keeping it in 1Password and putting only `op://vault/item/field`
   in `.env.labs`. `VERCEL_TEAM_ID` is needed only if the projects belong to a team. The Vercel CLI
   must be installed (`npm install --global vercel`). Nothing is created in Vercel until a real
   release: the first one creates the idea's project, named `labs-<idea>`.
5. Run `pnpm doctor --for ios` and/or `--for web` until it ends with `doctor: OK`.
6. Prove the whole path without shipping anything: `pnpm release <idea> <ios|web> --dry-run`.

## Rules

- Never ask the user to paste a secret into the chat. Never read `.env.labs`, a `.p8` file or a
  1Password item to look at a value, and never print one. `pnpm doctor` is all the visibility
  you need.
- You may write a non-secret id the user tells you (a key id, an issuer id, a team id) into
  `.env.labs`. Anything that is a secret is theirs to place.
- `.env.labs` is not the Next.js app's `apps/<idea>/web/.env.local`; do not mix them up.
- Android (Play) and hosted Supabase are not built yet. Do not invent setup for them.
