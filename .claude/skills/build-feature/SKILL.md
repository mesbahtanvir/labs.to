---
name: build-feature
description: Build or change a feature in an idea, spec first, through that idea's own Spec Kit. Use when the user asks to add, build, change or fix what an idea does, to write or update a spec, a plan or tasks, or asks what an idea is supposed to do.
---

# Build a feature, spec first

Every idea is its own Spec Kit project. `pnpm new` put the kit there:

```
apps/<idea>/
  idea.md                           why the idea exists: problem, hypothesis, metric, kill criteria
  .specify/memory/constitution.md   how this idea is built; every plan is checked against it
  .specify/                         Spec Kit's scripts and templates (a copy of templates/speckit/kit)
  .claude/skills/speckit-*/         the Spec Kit commands, as skills
  specs/<NNN-short-name>/           one folder per feature: spec.md, plan.md, tasks.md
```

## Steps

1. Know which idea the work is for. If the user did not say and more than one exists, ask.
2. Work with `apps/<idea>` as the working directory. When a Spec Kit skill says "repo root" or
   "project root" it means that folder, never this repository's root: its scripts are
   `apps/<idea>/.specify/scripts/bash/...` and they find the project from the folder you run
   them in.
3. Run the idea's Spec Kit skills in order. They become available once you read or edit a
   file under `apps/<idea>/`, marked as coming from that idea; with several ideas, use the copies
   from the idea you are working on. If they are not listed, read
   `apps/<idea>/.claude/skills/speckit-<step>/SKILL.md` and follow it.
   - `speckit-specify`: what the feature does and why, with no technology. Read `idea.md` first;
     a feature that does not serve the hypothesis is a conversation, not a spec.
   - `speckit-clarify`: only when the spec leaves real questions open.
   - `speckit-plan`: the technical plan, for the platforms in `idea.yaml`, one platform folder at
     a time. The stack is fixed by the constitution and by this repository's `CLAUDE.md`.
   - `speckit-tasks`, then `speckit-implement`.
4. Prove it: `pnpm verify <idea>`. After a schema change, `pnpm types <idea>` first. To look at
   it, use the `try-locally` skill.
5. Commit the spec, the plan, the tasks and the code together.

## Rules

- A change in behavior starts as a spec. A typo, a refactor, or a fix that restores what a spec
  already says needs no new spec; if the fix shows the spec was wrong, correct the spec in the
  same change.
- The constitution and `specs/` belong to the idea. Everything else under `.specify/` and the
  `speckit-*` skills are copies of `templates/speckit/kit/`: do not edit them in an idea. If one
  is missing or changed, `pnpm speckit <idea>` puts the kit back and leaves the constitution and
  the specs alone.
- Never run `specify init` in an idea or at the repository root, and never add a `.specify/` at
  the root: Spec Kit takes the nearest one as the project, so a root one captures every idea.
- `speckit-implement` asks for ignore files. The repository's root `.gitignore` already covers
  every idea, so check that one and add to it; do not create a `.gitignore` inside an idea.
- Spec Kit does not create a branch here (its git extension is not installed). Branch, verify
  and push the usual way.
- Amend the constitution with the idea's `speckit-constitution`, in a commit of its own. Where it
  disagrees with this repository's `CLAUDE.md`, `CLAUDE.md` wins.
