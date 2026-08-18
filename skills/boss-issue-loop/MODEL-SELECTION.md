# Model Selection

Portable provider-selection policy for the Boss issue loop. A repository
may override this file by placing its own copy at
`.agents/boss-issue-loop/MODEL-SELECTION.md`; when present, prefer it and
report that the repository policy is in use. If a selected policy lacks proper
tiers, warn and fall back to this packaged default.

## Difficulty rubric

Rank every task `low`, `medium`, or `high` with a one-sentence rationale, then
choose the lowest capable tier that can do the job.

- `low` — small, well-specified, single-file change; no subtle interaction or
  cross-file ripple.
- `medium` — multi-file or multi-concept change with modest interaction; needs
  focused tests and careful reading of neighbouring code.
- `high` — cross-cutting, ambiguous, or architecture-affecting change; needs
  deep reasoning and reconciliation across many files.

## Capability tiers

Ordered lowest-capability first. Escalation moves up one tier at a time. Escalation is a problem with execution, not model availability. 
Within a tier, entries are equivalent; ties are intentional — pick a random
available provider and move to the next only on capacity failure.

If an agent fails to launch or complete twice, archive it, record its unavailability, and choose another reviewer model; never retry the same reviewer more than twice. A failed launch should choose another model in the same tier. 

Implementation tiers:

- **Tier 1** — `opencode/opencode-go/mimo-v2.5`
- **Tier 2** — `opencode/opencode-go/gpt-5.6-luna` (low thinking);`codex/gpt-5.6-luna`(low thinking); `opencode/opencode-go/deepseek-v4-flash`
- **Tier 3** — `codex/gpt-5.6-luna` (high thinking); `codex/gpt-5.6-terra` (medium thinking)`; `codex/gpt-5.6-sol`(low thinking)
- **Tier 4** - `codex/gpt-5.6-sol`(high thinking)

Review tiers:

- **Tier 1** — `opencode/opencode-go/mimo-v2.5`; `opencode/mimo-v2.5-free`; `opencode/deepseek-v4-flash-free`; `opencode/hy3-free`; `opencode/nemotron-3.5-lightning-free`; `opencode/nemotron-3-ultra-free`; `opencode/laguna-s-2.1-free`
- **Tier 2** — `opencode/opencode-go/qwen3.7-plus`; `codex/gpt-5.6-luna`(low thinking)

## Capacity tie-breaking

Among equivalent providers, prefer the one with the larger remaining weekly
usage percentage when comparable usage data is available. When comparable data
is unavailable, keep the stable order above and report the unavailable data
rather than guessing.

## Escalation policy

- A clearly correctable stall gets one targeted recovery instruction to the
  same agent.
- Repeated failure, non-progress, scope corruption, or an explicit blocker
  archives the agent and its disposable worktree, then retries from the
  accepted base at the next capability tier.
- Pass to the new attempt only: the prior approach, the observed failure, a
  relevant command/output excerpt, and the paths already investigated.
- Allow one attempt per capability tier; stop after the highest tier fails.
- If the local policy lacks proper tiers, warn and use this packaged default.
- If neither this default nor the local policy has proper tiers, warn, treat
  available models as one equal tier, disable capability escalation, allow one
  fresh retry with the next provider, then stop if it fails.
