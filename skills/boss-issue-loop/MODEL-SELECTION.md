# Model Selection

Portable provider-selection policy for the Boss issue loop. A repository
may override this file by placing its own copy at
`.agents/boss-issue-loop/MODEL-SELECTION.md`; when present, prefer it and
report that the repository policy is in use. If a selected policy lacks proper
tiers, warn and fall back to this packaged default.

## Implementation difficulty rubric

Rank every task `low`, `medium`, or `high` with a one-sentence rationale, then
choose the lowest capable tier that can do the job.

- `low` — small, well-specified, single-file change; no subtle interaction or
  cross-file ripple.
- `medium` — multi-file or multi-concept change with modest interaction; needs
  focused tests and careful reading of neighbouring code.
- `high` — cross-cutting, ambiguous, or architecture-affecting change; needs
  deep reasoning and reconciliation across many files.

## Review risk

Classify review risk separately from implementation difficulty and give each a
one-sentence rationale. Use `low` for documentation-only or otherwise isolated
changes, `medium` for changes with limited behavioural interaction, and `high`
for changes affecting trust boundaries or multiple runtime concerns. Treat
changes to auth, permissions, persistence, concurrency, lifecycle, migration,
or a public interface as requiring high-risk review regardless of difficulty.

Use one independent reviewer for low-risk work and two for medium- or
high-risk work. The protected concerns above always require two reviewers. When
two reviewers are required, select distinct reviewers.

## Issue budgets

Apply these counters per issue:

- Keep at most three child agents active for an issue, with at most one writer
  in any worktree.
- Allow at most one targeted recovery prompt per writer. Define a targeted
  recovery prompt as the single bounded follow-up for a clearly correctable
  stall or non-progress by the current writer.
- Allow at most two writer launches: the initial capable tier plus at most one
  retry at the next capable tier. A harder issue may start at a higher tier;
  higher tiers do not create an unbounded per-issue retry ladder.
- Allow at most two review rounds, counting the initial review and one
  follow-up review.
- Allow at most one reviewer replacement per issue.

Increment each counter when its action starts and stop that action when its
limit is reached. For review fixes, use targeted re-review while behavior is
unchanged. Treat a material behavior change as a change to runtime behavior,
data shape or persistence, public interfaces, security or permission
semantics, concurrency or lifecycle behavior, or externally observable
workflow outcomes. Only a material behavior change permits a full fresh review.

## Capability tiers

Ordered lowest-capability first. Escalation moves up one tier at a time.
Escalation is a problem with execution, not model availability.

### Capability attempts

- Allow one attempt per capability tier within the issue budget.
- **Launch and infrastructure failures do not consume a tier's attempt
  budget.** A failed launch or infrastructure error (network timeout, rate
  limit, provider outage) allows choosing another model in the same tier
  without advancing the tier counter, while the issue's writer-launch limit
  still applies.
- **Verification and quality failures consume a tier's attempt.** A failed
  verification gate, test suite failure, or quality rejection counts as the
  tier's single attempt.
- If an agent fails to launch or complete twice, archive it, record its
  unavailability, and choose another model in the same tier only when the
  issue's writer-launch limit permits it. Never retry the same model more than
  twice.

### Tier definitions

- **Tier 1** — Single-file, well-specified tasks. The agent reads a small
  scope, applies a focused change, and passes a straightforward verification
  gate.
- **Tier 2** — Multi-file or multi-concept changes with modest interaction.
  The agent reads neighbouring code, writes focused tests, and resolves
  straightforward failures.
- **Tier 3** — Focused multi-file work requiring deeper reasoning. The agent
  reconciles cross-file dependencies, debugs subtle interaction failures, and
  validates behavior across components.
- **Tier 4** — Cross-cutting, ambiguous, or architecture-affecting work. The
  agent reasons across the full codebase, reconciles conflicting constraints,
  and produces changes that affect many files and components.

### Worked example roster

The following roster is provided as a concrete reference only. **It is not
read as policy.** A user/machine or repository override replaces it entirely
when present.

Implementation tiers:

- **Tier 1** — `{ provider: "opencode", model: "opencode-go/mimo-v2.5", effort: "low" }`
- **Tier 2** — `{ provider: "opencode", model: "opencode-go/gpt-5.6-luna", effort: "low" }`, `{ provider: "codex", model: "gpt-5.6-luna", effort: "low" }`, `{ provider: "opencode", model: "opencode-go/deepseek-v4-flash", effort: "low" }`
- **Tier 3** — `{ provider: "codex", model: "gpt-5.6-luna", effort: "high" }`, `{ provider: "codex", model: "gpt-5.6-terra", effort: "medium" }`, `{ provider: "codex", model: "gpt-5.6-sol", effort: "low" }`
- **Tier 4** — `{ provider: "codex", model: "gpt-5.6-sol", effort: "high" }`

Review tiers:

- **Tier 1** — `{ provider: "opencode", model: "opencode-go/mimo-v2.5", effort: "low" }`, `{ provider: "opencode", model: "mimo-v2.5-free", effort: "low" }`, `{ provider: "opencode", model: "deepseek-v4-flash-free", effort: "low" }`, `{ provider: "opencode", model: "hy3-free", effort: "low" }`, `{ provider: "opencode", model: "nemotron-3.5-lightning-free", effort: "low" }`, `{ provider: "opencode", model: "nemotron-3-ultra-free", effort: "low" }`, `{ provider: "opencode", model: "laguna-s-2.1-free", effort: "low" }`
- **Tier 2** — `{ provider: "opencode", model: "opencode-go/qwen3.7-plus", effort: "low" }`, `{ provider: "codex", model: "gpt-5.6-luna", effort: "low" }`

## Capacity tie-breaking

Among equivalent providers in the same tier, use exactly one tie-break rule:

1. If both candidates report `status: ok`, prefer the one with the larger
   remaining weekly usage percentage.
2. Otherwise, use the stable declared order.

Use the provider usage helpers in [`USAGE-HELPERS.md`](USAGE-HELPERS.md) to
obtain normalized weekly capacity. Compare only when equivalent providers both
report `status: ok`.

## Escalation policy

- A clearly correctable stall gets one targeted recovery instruction to the
  same agent.
- Repeated failure, non-progress, scope corruption, or an explicit blocker
  archives the failed writer. Preserve its clean worktree and committed
  changes by default, then use the next fresh writer launch at the next
  capability tier. Archive or replace the disposable worktree only when it is
  corrupted, has invalid ancestry, or has escaped scope.
- Pass to the new attempt only: the prior approach, the observed failure, a
  relevant command/output excerpt, and the paths already investigated.
- If the local policy lacks proper tiers, warn and use this packaged default.
- If neither this default nor the local policy has proper tiers, warn, treat
  available models as one equal tier, disable capability escalation, allow one
  fresh retry with the next provider, then stop if it fails.
