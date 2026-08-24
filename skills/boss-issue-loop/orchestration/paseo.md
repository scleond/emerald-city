# Paseo Adapter

Use the Paseo skill or MCP tools to satisfy the Boss issue loop's orchestration
interface.

- Inspect: read Paseo preferences, provider catalog, agents, workspaces, scripts,
  and ownership labels before selecting work.
- Isolate: create `issue-<number>-<slug>` from the accepted base in a disposable
  Paseo worktree. Record its workspace ID and accepted base.
- Implement: launch or resume one writer with write access only to that worktree.
  Pass the issue number, accepted base, workspace ID, and rendered implementer
  contract. The child reports permission needs to the coordinator and has no
  permission-response or parent/sibling orchestration control.
- Review: launch the reviewer count resolved by `MODEL-SELECTION.md` in
  independent read-only review mode against the fixed-point diff. Pass the
  workspace ID and rendered reviewer contract.
- Reviewers cannot approve permissions, launch/resume/archive agents, push,
  close issues, or clean parent resources.
- Clean: archive completed agents and disposable workspaces, including stale
  Paseo instances with the completed issue label. Preserve the accepted commit
  and review evidence first.

Only the top-level coordinator may call `respond_to_permission` or mutate
parent/sibling orchestration state. It handles each request ID once, then may
perform one status reconciliation when state is inconsistent. Recursive or
superseding requests latch degraded mode immediately and block every later
agent launch; a bounded recovery prompt to an existing writer remains allowed.
Degraded mode may inspect and verify safely, but an unmet independent-review
gate remains unmet and cannot be recorded as approved.

Push, completion comment, issue closure, and completed-resource cleanup are
coordinator loop operations attempted directly by the coordinator; only the
host approval surface prompts the user. Record an `*-attempted` state before
invoking the remote mutation and an `*-observed` state only after verification;
reconcile observations before retrying after restart. Record active and
archived agent/workspace resources around coordinator mutations; cleanup
observation requires preservation and zero active resources. Child agents
never perform them.

Enforce the issue-agent concurrency limit from `MODEL-SELECTION.md`. Treat
Paseo permission denial, unavailable providers, or failure to guarantee
review isolation as an unsupported operation and return control to the core
loop.

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
