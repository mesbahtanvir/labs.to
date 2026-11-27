# templates/speckit

What `pnpm new` installs to make an idea a [Spec Kit](https://github.com/github/spec-kit) project.

| path              | whose           | what                                                                    |
| ----------------- | --------------- | ----------------------------------------------------------------------- |
| `kit/`            | Spec Kit's      | the unedited output of `specify init --integration claude --script sh`  |
| `constitution.md` | this repository | the constitution a new idea starts with (`{{title}}`, `{{name}}`, `{{date}}`) |
| `constitution-offline.md` | this repository | the same for an idea with `network: none`: no backend, "No Network, Ever" |

Never edit `kit/` by hand: a test compares every file with the checksum Spec Kit recorded in
`kit/.specify/integrations/*.manifest.json`. Regenerate it instead, with the `specify` CLI
installed on this machine:

```bash
pnpm speckit --refresh-template   # rewrites kit/ from `specify init`
pnpm speckit --all                # brings existing ideas up to date (keeps constitutions and specs)
```

`kit/.specify/memory/` is not copied into an idea: an idea's constitution comes from
`constitution.md` here and is its own afterwards.

Spec Kit is MIT licensed, copyright GitHub, Inc. The files under `kit/` are its work.
