# Paseo Adapter

Use the Paseo skill or MCP tools to satisfy the Boss issue loop's orchestration
interface.

- Inspect: read Paseo preferences, provider catalog, agents, workspaces, scripts,
  and ownership labels before selecting work.
- Isolate: create `issue-<number>-<slug>` from the accepted base in a disposable
  Paseo worktree. Record its workspace ID and accepted base.
- Implement: launch or resume one writer with write access only to that worktree.
  Pass the issue number, accepted base, workspace ID, and rendered implementer
  contract.
- Review: launch independent agents in read-only review mode against the
  fixed-point diff. Pass the workspace ID and rendered reviewer contract.
- Clean: archive completed agents and disposable workspaces, including stale
  Paseo instances with the completed issue label. Preserve the accepted commit
  and review evidence first.

Keep one writer per worktree, two reviewers, and three child agents total. Treat
Paseo permission denial, unavailable providers, or failure to guarantee review
isolation as an unsupported operation and return control to the core loop.
