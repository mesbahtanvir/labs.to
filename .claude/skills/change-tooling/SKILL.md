---
name: change-tooling
description: Prove a change to templates/ or tooling/ by generating a sample idea from it and trying to break it. Use when editing anything under templates/ or tooling/, the stamping (scaffold.mjs, pnpm new, pnpm grow), how the Supabase CLI is run, or pnpm release and pnpm doctor, and before calling such a change done.
---

# Change templates or tooling, and prove it

A change to `templates/` or `tooling/` is not verified until a generated idea passes
`pnpm verify`, and until you have tried to make `verify` fail and it did. Unit tests
(`pnpm test`) are necessary and not enough: they do not exercise a real stack, build or
simulator. Never rehearse in a way that touches a real idea, a real release or other
projects' containers.

## 1. Generate a sample from the change

```bash
pnpm new sample-idea --platforms web,ios,android   # include only the platforms the change touches
pnpm install
pnpm verify sample-idea
```

It must pass before you break anything. If it fails now, the change is wrong (or the machine
is: run `pnpm doctor`).

## 2. Try to break it

Pick the rows that match what you changed, and confirm `pnpm verify sample-idea` fails each
time, for the reason you expect. Undo each one before the next.

| Area | Break it with | Expected |
|---|---|---|
| Backend | a table in `public` without RLS | fails |
| Backend | a migration that leaves generated types stale | fails (stale types) |
| Web | a type error | fails |
| iOS | a failing unit test; a failing UI test; a compiler warning; a formatting violation | each fails |
| Android | the same four | each fails |
| Spec Kit | an idea without `.specify/`; a constitution left as the unfilled template; a hand-edited file in `templates/speckit/kit/` | each fails |

## 3. Special rehearsals

- **Stamping** (`tooling/lib/scaffold.mjs`, `pnpm new`, `pnpm grow`): also grow. A spark sample
  that gets `web`, then `ios,android`; a `--backend none` sample that gets `--backend supabase`.
  Each must pass `pnpm verify`. Growing a platform that already exists must be refused.
- **How the Supabase CLI is run** (`tooling/lib/exec.mjs`, `watch.mjs`, `supabase.mjs`): point
  `SUPABASE_CLI_BINARY_OVERRIDE` at a script that prints and never exits for one command and runs
  the real binary otherwise. `verify` must give up on it, run it once more and say so, and fail
  when it stalls twice.
- **`pnpm release` or `pnpm doctor`**: do not rehearse here. Use the `rehearse-release` skill
  if it exists, otherwise follow the scratch-clone procedure in `CLAUDE.md`. Never run a real
  release or push a release tag.

## 4. Restore and clean up

- Restore any file you mutated with a checksum-based copy: `rsync -ac <original> <mutated>`.
  A plain `rsync` can miss an edit made in the same second with the same size.
- Delete the sample. If its dev stack is up, `pnpm sb sample-idea stop --no-backup` first.
  `pnpm verify --cleanup` stops the verify simulator.
- Only ever stop `sample-idea` and `sample-idea-verify` stacks. Other Supabase stacks,
  simulators and emulators on this machine belong to the user. Never run `gradlew --stop` or
  kill Gradle daemons.
- `git status` should show only the change you meant to make.

## 5. Report

Say which rows you tried and what each did, what you could not try (for example no emulator
available), and the final `pnpm verify` result. Do not call the change done on unit tests alone.
If the tooling and the docs or skills disagree after your change, update them in the same change.
