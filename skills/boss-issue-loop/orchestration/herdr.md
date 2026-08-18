# Herdr Adapter

Use Herdr's CLI from inside a Herdr-managed pane to satisfy the Boss issue
loop's orchestration interface.

## Preflight

Require `HERDR_ENV=1` and `herdr` in `PATH`. Stop as unsupported when either is
missing; do not launch or attach the Herdr TUI from outside Herdr. Inspect the
installed command groups before acting:

```text
herdr --help
herdr workspace
herdr worktree
herdr tab
herdr pane
herdr agent
```

Treat the installed CLI as authoritative. Capture identifiers from command JSON
instead of predicting them.

## Interface mapping

- **Inspect:** run `herdr workspace list`, `herdr worktree list --cwd <repo>`,
  and `herdr agent list`. Match issue ownership by workspace labels, agent names,
  branch names, and checkout paths.
- **Isolate:** run `herdr worktree create --cwd <repo> --branch
  issue-<number>-<slug> --base <accepted-base> --label issue-<number> --no-focus`.
  Record the returned workspace, root pane, checkout path, and accepted base.
- **Implement:** map the selected provider to a supported Herdr agent `--kind`
  and verified CLI arguments. Start `issue-<number>-writer` in the worktree's
  root pane with `herdr agent start`, then deliver the rendered implementer
  contract with `herdr agent prompt ... --wait`. Treat `blocked` as a handoff
  requiring inspection and `unknown` as unsettled, never successful completion.
- **Review:** create one background tab per reviewer with `herdr tab create
  --workspace <workspace-id> --cwd <checkout> --label <label> --no-focus`.
  Start uniquely named reviewers in the returned root panes and pass each the
  rendered reviewer contract. Launch each agent with its installed CLI's
  verified read-only filesystem or sandbox arguments. If read-only execution
  cannot be guaranteed, return `unsupported` before launching reviewers.
- **Collect:** wait for `idle`, `done`, or `blocked` with an explicit timeout.
  Read settled output with `herdr agent read <name> --source recent-unwrapped
  --lines <count>`. A blocked result must include the visible question or
  approval request; completion still requires the core loop's Git and
  verification gates.
- **Clean:** preserve the accepted commit and review evidence, send `ctrl+c` to
  live issue agents, and close their tabs or workspace. Remove a disposable
  checkout with `herdr worktree remove --workspace <workspace-id>`. Leave a
  dirty checkout in place and report it; use no forced removal. Herdr preserves
  the branch when it removes a worktree.

Keep one writer per worktree, two reviewers, and three child agents total. Use
unique names matching Herdr's `[a-z][a-z0-9_-]{0,31}` rule. Use explicit
workspace, pane, and agent targets; never rely on UI focus. Treat command
failure, permission denial, unavailable provider kinds, or uncertain review
isolation as an unsupported operation and return control to the core loop.

## Resolving a provider descriptor

Each tier entry is a structured provider descriptor with fields `provider`,
`model`, and `effort`. Map it to Herdr agent-launch arguments:

| Descriptor field | Herdr target |
|------------------|--------------|
| `provider` / `model` | Mapped to a supported `--kind` value (e.g. `codex / gpt-5.6-luna` → `--kind codex`) |
| `effort: "low"` | No thinking arguments; minimal resource allocation |
| `effort: "medium"` | `--thinking medium` or equivalent installed flag |
| `effort: "high"` | `--thinking high` or equivalent installed flag |

Inspect the installed `herdr agent start --help` output to confirm available
`--kind` and `--thinking` values before launching. Treat the installed CLI as
authoritative.

When a descriptor cannot be resolved — no installed `--kind` matches the
provider, the model is unknown to the kind, or the effort level has no
corresponding thinking argument — return `unsupported` before launching any
agent. Do not guess a substitute.
