# Orchestration Selection

`adapter: paseo`

Packaged adapters:

- `paseo` — [`orchestration/paseo.md`](orchestration/paseo.md)
- `herdr` — [`orchestration/herdr.md`](orchestration/herdr.md)

A repository may override this selection with
`.agents/boss-issue-loop/ORCHESTRATION.md`. Put exactly one `adapter: <name>`
directive in the override. Use a packaged name above or a path to an adapter
document that satisfies every operation in the orchestration interface defined
by `SKILL.md`. Resolve relative paths from the repository root.

Load exactly one adapter for an issue attempt and report its name. Keep that
adapter through implementation, review, integration, and cleanup. Select a new
adapter only before a fresh attempt begins.

If the override is missing, unreadable, names multiple adapters, or leaves an
interface operation undefined, warn and use the packaged Paseo adapter. If the
packaged adapter is also unavailable, stop before launching agents.
