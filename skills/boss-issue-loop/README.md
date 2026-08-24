# Boss Issue Loop

A reviewed GitHub issue loop: select scoped work, delegate implementation, verify independent reviews, integrate and push, close the issue, and clean disposable resources.

## Prerequisites

- **`gh` CLI** — authenticated (`gh auth status`), with permission to read/write issues, labels, and comments on the target repository.
- **An agent orchestrator** — Paseo (default) or Herdr. The adapter is resolved from `ORCHESTRATION.md` at runtime. A repository may override the adapter selection.
- **Provider credentials** — at least one provider with a model capable of Tier 1 work. The skill escalates through capability tiers on failure within the hard issue budgets defined in [`MODEL-SELECTION.md`](MODEL-SELECTION.md).

## Configuration levels

Configuration is resolved per section through a three-level merge — most specific wins:

| Level | Source | Contains |
|-------|--------|----------|
| **Packaged** | `skills/boss-issue-loop/MODEL-SELECTION.md` | Portable policy: difficulty rubric, escalation rules, tie-break logic. Committed; never edited. |
| **User/machine** | `~/.config/opencode/boss-issue-loop/MODEL-SELECTION.md` (Linux); `~/Library/Application Support/opencode/boss-issue-loop/MODEL-SELECTION.md` (macOS); `%APPDATA%\opencode\boss-issue-loop\MODEL-SELECTION.md` (Windows) | Local inventory: model roster, tier assignments, adapter selection. Never committed. |
| **Repository** | `.agents/boss-issue-loop/MODEL-SELECTION.md` | Repository-specific overrides: verification commands, capability floors, tier pinning. Committed. |

Each heading in `MODEL-SELECTION.md` is resolved independently. A section at a higher level completely replaces the same section at lower levels — no field-by-field merge within a section. Absent or unreadable levels are skipped; the next-more-specific level applies.

## Adapter choice

The orchestration adapter is selected from `ORCHESTRATION.md`:

- **Paseo** — default packaged adapter.
- **Herdr** — alternative packaged adapter.
- **Custom** — a repository may point to a custom adapter document that satisfies every operation in the orchestration interface.

The adapter is loaded once per issue attempt and kept through implementation, review, integration, and cleanup. A repository override at `.agents/boss-issue-loop/ORCHESTRATION.md` takes precedence.

## Verification guarantees

The loop provides these verification gates:

1. **Implementation gate** — the implementer must pass repository verification commands and a handoff-verify command before the commit is accepted.
2. **Adaptive independent review** — low-risk work receives one independent reviewer; medium- and high-risk work receives two, with protected auth, permissions, persistence, concurrency, lifecycle, migration, and public-interface changes always receiving two. Hard defects require file/line evidence.
3. **Coordinator verification** — every claimed failure is verified by the coordinator. Actionable findings are resolved in the worktree, committed, and the verification gates are rerun.
4. **Integration gate** — only a committed, linear, clean worktree with passing verification gates is integrated. Dirty or unverified worktrees are never integrated.

The loop has hard bounds: one recovery prompt per writer, two writer launches
per issue, two review rounds, and one reviewer replacement. Bounded findings
resume the current writer with targeted re-review; a full fresh review follows
only a material behavior change. Capability escalation preserves a clean
worktree and commit by default, restarting from the accepted base only for
corruption, invalid ancestry, or scope escape. The issue-agent concurrency
bound is resolved from the same policy. See
[`MODEL-SELECTION.md`](MODEL-SELECTION.md) for the authoritative policy.

## How the loop runs

1. Select the first unblocked issue in scope and tracker order.
2. Create an isolated worktree from the accepted base commit.
3. Delegate implementation through the adapter.
4. Classify review risk and launch the required number of distinct independent reviewers on the fixed-point diff, using the authoritative review-risk rule in [`MODEL-SELECTION.md`](MODEL-SELECTION.md).
5. Verify findings, resolve defects, rerun gates.
6. Integrate the verified commit, push, and close the issue.
7. Archive completed agents and disposable workspaces.
8. Repeat until no actionable open issue remains.

## Assumptions

- The repository uses GitHub Issues for tracking.
- The `gh` CLI is authenticated and has the necessary permissions.
- At least one agent provider is configured and available.
- The accepted base commit is clean and CI-passing.

## Setup

For initial setup including provider configuration, model selection tuning, and adapter selection, see the [root README](../../README.md) and follow the setup instructions for your agent tooling. Place repository overrides at `.agents/boss-issue-loop/MODEL-SELECTION.md` and `.agents/boss-issue-loop/ORCHESTRATION.md`.
