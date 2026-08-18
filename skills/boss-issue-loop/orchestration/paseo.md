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

## Resolving a provider descriptor

Each tier entry is a structured provider descriptor with fields `provider`,
`model`, and `effort`. Map it to Paseo agent-creation arguments:

| Descriptor field | Paseo target |
|------------------|--------------|
| `provider` / `model` | Combined as `provider` in `create_agent` (e.g. `opencode` / `opencode-go/mimo-v2.5` → provider `opencode`, model `opencode-go/mimo-v2.5`) |
| `effort: "low"` | No `thinkingOptionId`; no thinking features enabled |
| `effort: "medium"` | `thinkingOptionId` set to the provider's medium-thinking option |
| `effort: "high"` | `thinkingOptionId` set to the provider's high-thinking option; enable `fast_mode: false` if available |

When a descriptor cannot be resolved — the provider is not in the Paseo
catalog, the model is unknown, or the effort level has no corresponding thinking
option — return `unsupported` before creating any agent. Do not guess a
substitute.
