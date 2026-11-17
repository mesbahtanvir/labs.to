# {{title}} Constitution

<!--
  Written by `pnpm new` from templates/speckit/constitution.md. From here on it is this
  idea's own: amend it with /speckit-constitution. The repository's CLAUDE.md still
  applies to every idea.
-->

## Core Principles

### I. Spec Before Code

Every change in behavior starts as a spec in `specs/`, written before the code and kept
true after it. `idea.md` says why this idea exists (problem, hypothesis, success metric,
kill criteria). A spec says what one feature does for a user, in terms a test can check.
The plan and the tasks say how. Code that no spec asks for is not built, and a spec the
code no longer matches is corrected in the same change.

### II. The Smallest Thing That Tests the Hypothesis

This idea exists to prove or kill the hypothesis in `idea.md`. Every feature names the
user story it serves, can ship on its own, and is the simplest version that produces a
signal. Work that does not move the success metric waits. Complexity is justified in the
plan or removed.

### III. Native Per Platform, One Contract

Web, iOS and Android are independent projects (`web/`, `ios/`, `android/`) that never
import from each other. A feature is specified once and planned per platform, for the
platforms `idea.yaml` lists, starting with one. What the platforms share is the contract:
the database schema and the types generated from it.

### IV. The Schema Is the Contract

When this idea has a backend, its migrations are the source of truth and are append-only.
Every table in `public` has row level security and explicit policies, because the
publishable key ships in every client. Client types are regenerated after every schema
change (`pnpm types {{name}}`), and the Kotlin models are updated by hand in the same change.

### V. Verified on This Machine

`pnpm verify {{name}}` is the gate: a task is done when it passes, not when the code is
written. Warnings are errors on every platform, so fix them and never silence them. From
`alpha` on, every user story has an automated test at the level where it can fail
(database, unit or UI); in a prototype a story may be accepted by hand, and the spec says
how. Secrets never enter the repository.

## Constraints

- The stack is fixed: Next.js on the web, Swift 6 and SwiftUI on iOS, Kotlin and Jetpack
  Compose on Android, Supabase for the backend. A plan does not add another framework,
  backend or cross-platform layer without an amendment to this constitution.
- The repository's `CLAUDE.md` and `README.md` (layout, pinned versions, release rules)
  bind every idea. Where they and this constitution disagree, they win and this file is
  corrected.
- Releases happen only through `pnpm release {{name}} <platform>`, and only once `stage`
  in `idea.yaml` is `alpha` or `live`.

## Workflow

1. `/speckit-specify` a feature: what and why, no technology.
2. `/speckit-clarify` when the spec leaves questions open.
3. `/speckit-plan`: the technical plan, per platform, checked against this constitution.
4. `/speckit-tasks`, then `/speckit-implement`.
5. `pnpm verify {{name}}`, then commit the spec, the plan, the tasks and the code together.

Run these with `apps/{{name}}` as the working directory: that folder, not the repository
root, is this Spec Kit project's root.

## Governance

This constitution outranks habit and convenience for work inside `apps/{{name}}`. Amend it
with `/speckit-constitution`, in a commit of its own that gives the reason, and bump the
version: major when a principle is removed or redefined, minor when a principle or section
is added, patch for wording. Every plan carries a constitution check; a violation is fixed,
or written down in the plan with its justification.

**Version**: 1.0.0 | **Ratified**: {{date}} | **Last Amended**: {{date}}
