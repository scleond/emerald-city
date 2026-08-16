# Orchestration Selection

Use [`orchestration/paseo.md`](orchestration/paseo.md) as the packaged adapter.

A repository may override this selection with
`.agents/boss-issue-loop/ORCHESTRATION.md`. The override must name one adapter
document and explain how it satisfies every operation in the orchestration
interface defined by `SKILL.md`. Resolve relative adapter paths from the
repository root.

Load exactly one adapter for an issue attempt and report its name. Keep that
adapter through implementation, review, integration, and cleanup. Select a new
adapter only before a fresh attempt begins.

If the override is missing, unreadable, names multiple adapters, or leaves an
interface operation undefined, warn and use the packaged Paseo adapter. If the
packaged adapter is also unavailable, stop before launching agents.
