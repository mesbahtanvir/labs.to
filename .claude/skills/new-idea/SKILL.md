---
name: new-idea
description: Start a new idea in this repository, or grow one that exists. Use when the user wants to start, create, add or scaffold a new app, project or idea, turns a spark into code, or adds a platform (web, iOS, Android) or a backend to an existing idea.
---

# Start a new idea

A new idea is created with `pnpm new`, never by hand. The generator guarantees the layout,
the manifest and the template that all the other tooling expects. An idea that already exists
is grown with `pnpm grow` (see "Grow an idea that exists" below), never by copying templates.

## Steps

1. Get a short lowercase name (letters and digits, one hyphen between words), and whether it is only a
   written idea (`--stage spark`: `idea.md` and Spec Kit, no code, so no `--platforms`) or code. Default to web
   with Supabase; add `ios` and `android` only when the idea needs them, because every platform is implemented separately.
2. Create it:

   ```bash
   pnpm new <name> [--platforms web,ios,android] [--stage prototype] [--backend supabase|none] [--title "Name"]
   pnpm install
   ```

3. Fill in `apps/<name>/idea.md` with the user: the problem, the hypothesis, the success metric and
   the kill criteria. This is the part that decides whether the idea deserves more work.
4. Specify the first feature before building it, using the `build-feature` skill. The idea is
   already a Spec Kit project: `pnpm new` installed the kit and wrote its constitution
   (`apps/<name>/.specify/memory/constitution.md`), so do not run `specify init`.
5. Run it, using the `try-locally` skill, then `pnpm verify <name>`.
6. Commit. The pre-commit hook scans for secrets. When it is time to get it to testers, use the
   `ship` skill; the idea must first be promoted to `alpha`.

## Grow an idea that exists

`pnpm new` refuses a folder that exists. To turn a spark into code, add a platform, or give an
idea its backend:

```bash
pnpm grow <name> --platforms web             # a spark's first platform: it becomes a prototype
pnpm grow <name> --platforms ios,android     # more platforms (with the backend's files, if it has one)
pnpm grow <name> --backend supabase          # a backend for an idea that has none
pnpm install                                 # when web was added, or web got the backend
```

1. Add only what the idea needs now: every platform is implemented separately.
2. Run it and follow the "Next:" steps it prints (the local key for each new platform, and
   `pnpm types <name>` when the idea's schema is no longer the template's).
3. It refuses a platform folder that exists, and it refuses to replace a file the backend
   overlay writes over if that file was edited. Read the list it prints. `--force` replaces those
   files: ask the user before using it, then put their edits back from `git diff`.
4. It only adds. Do not use it, or a hand edit of `idea.yaml`, to remove a platform or a backend
   without the user asking for exactly that.
5. `pnpm verify <name>`, then commit the new folders together with `idea.yaml` and, for web,
   `pnpm-lock.yaml`.

## Rules

- `apps/<idea>/idea.yaml` is the source of truth. Do not hardcode an idea's name in a script,
  workflow or config.
- Do not list a platform the generator refuses; `verify` fails on it.
