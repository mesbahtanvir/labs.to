---
name: new-idea
description: Start a new idea in this repository. Use when the user wants to start, create, add or scaffold a new app, project or idea, or turns a spark into code.
---

# Start a new idea

A new idea is created with `pnpm new`, never by hand. The generator guarantees the layout,
the manifest and the template that all the other tooling expects.

## Steps

1. Get a short lowercase name (letters, digits and hyphens), and whether it is only a written idea
   (`--stage spark`, just `idea.md`) or code. Default to web with Supabase; add `ios` and `android`
   only when the idea needs them, because every platform is implemented separately.
2. Create it:

   ```bash
   pnpm new <name> [--platforms web,ios,android] [--stage prototype] [--backend supabase|none] [--title "Name"]
   pnpm install
   ```

3. Fill in `apps/<name>/idea.md` with the user: the problem, the hypothesis, the success metric and
   the kill criteria. This is the part that decides whether the idea deserves more work.
4. Run it, using the `try-locally` skill, then `pnpm verify <name>`.
5. Commit. The pre-commit hook scans for secrets. When it is time to get it to testers, use the
   `ship` skill; the idea must first be promoted to `alpha`.

## Rules

- `apps/<idea>/idea.yaml` is the source of truth. Do not hardcode an idea's name in a script,
  workflow or config.
- Do not list a platform the generator refuses; `verify` fails on it.
