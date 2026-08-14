---
name: boss-implement-loop
description: "Run the Boss issue loop: select the next unblocked GitHub issue, delegate implementation and independent review, integrate the verified commit, push it, and clean completed Paseo resources."
---

# Boss Implement Loop

You are the coordinator. Continue issue by issue until no actionable open issue remains, or a concrete blocker requires the user.

## Provider Tiers

Choose one available provider from each tier before launching agents. Ties are intentional; choose the first available provider and use the next one only after a capacity failure.

Implementation tier, equal rank:

- `opencode/opencode-go/deepseek-v4-flash`
- `opencode/opencode-go/gpt-5.6-luna` with low thinking
- `codex/gpt-5.6-luna` with low thinking

Review tier, equal rank:

- `opencode/opencode-go/mimo-v2.5`
- `opencode/opencode-go/qwen3.7-plus`

Inspect provider availability and orchestration preferences before launch. Keep at most one writer per worktree, two reviewers, and three child agents total. Use isolated Paseo worktrees for writers and read-only review mode for reviewers.

## Issue Loop

1. Read the repository orchestration and issue-tracker docs, preferences, provider catalog, worktree status, active Paseo agents, and open GitHub issues.
2. Select the first unblocked issue in tracker order. Confirm no active agent or workspace already owns its issue label. Record the accepted base commit.
3. Create `issue-<number>-<slug>` from the accepted base commit. Pass the exact issue number, base commit, and Paseo workspace ID to the implementer.
4. Render and send the Implementer Handoff Contract below. Fill every placeholder with the exact issue, accepted base, workspace, and repository-specific commands discovered in step 1. Keep the commit before the final ticket verification gate.
5. Accept only a committed, linear, clean worktree whose `npm run ticket:verify` passes. If the writer stops without editing, resume once with a direct edit-and-verify instruction; if it still stops, archive it and take over or retry with the next equal-tier provider.
6. Launch exactly two read-only reviewers in parallel, one from each review-tier entry. Give both the fixed-point diff and issue specification. Ask for concrete findings with file/line references and separate hard defects from advisory concerns.
7. Verify every claimed failure yourself. Resolve actionable findings in the issue worktree, commit the fixes, and rerun `npm run verify` and `npm run ticket:verify`. Repeat review when a fix materially changes behavior.
8. Integrate only the verified commit into the coordinator branch with a non-interactive fast-forward or merge. Inspect status, diff, and log before integration.
9. Push the integrated branch to its configured remote. Close the issue with a concise implementation and verification comment only after the push succeeds.
10. Archive completed issue agents and their disposable workspaces. Remove stale Paseo instances carrying the completed issue label. Preserve the commit and any useful review report before cleanup.
11. Re-read the open issue frontier and start the next iteration from the new accepted base commit.

## Stop Conditions

- Stop when the open issue frontier is empty.
- Stop and report when the requested provider tier is unavailable after its defined capacity fallback, a required permission is denied, tests remain failing after reasonable fixes, or push cannot complete.
- Never integrate a dirty or unverified worktree, silently skip a blocked issue, overwrite unrelated user changes, or use destructive Git commands.

## Implementer Handoff Contract

For every writer launch, render this template with concrete values and commands:

> Implement only GitHub issue #<issue-number>, "<issue-title>", from accepted base
> `<base-commit>` in isolated Paseo workspace `<workspace-id>`.
>
> 1. Initialize the worktree and ticket with `<bootstrap-command>` when the repository
>    requires a separate bootstrap, followed by `<ticket-init-command>`.
> 2. Read the complete issue specification, including its body, labels, comments, and
>    linked requirements, with `<issue-read-command>`. Treat every stated acceptance
>    criterion as binding.
> 3. Implement the smallest coherent diff satisfying those criteria. Confine changes
>    to the code, tests, and documentation needed by this issue. Add focused tests for
>    every changed behavior and update relevant documentation when documented behavior
>    or workflows change.
> 4. Run the focused tests and `<repository-verify-command>`. Resolve failures caused by
>    the implementation.
> 5. Commit all issue changes, confirm the worktree is clean, and then run
>    `<ticket-handoff-verify-command>`.
>
> Completion requires `<ticket-handoff-verify-command>` to pass after the commit.
> Continue through implementation, verification, commit, and handoff. If an external
> or pre-existing failure prevents completion, classify the handoff as blocked and
> report the exact command, relevant output, and evidence that the failure is outside
> this issue.
>
> Report:
>
> - changed files and their purpose;
> - acceptance criteria covered;
> - focused and full verification results;
> - remaining failures or blockers, or `none`;
> - clean-worktree status;
> - final commit hash.
