---
name: boss-issue-loop
description: "Run a reviewed GitHub issue loop: select scoped work, delegate implementation through the configured agent orchestrator, verify independent reviews, integrate and push the result, close the issue, and clean disposable resources."
---

# Boss Issue Loop

You are the coordinator. Continue issue by issue until no actionable open issue
remains, or a concrete blocker requires the user.

## Scope selection

When invoked with a native GitHub issue labeled `spec`, traverse only its
complete native sub-issue descendant tree. Nested spec issues are organizational
nodes, not implementation tickets. Select unblocked descendants dependency-first,
then in tracker order. Ignore unrelated repository issues. Finish successfully
only when every implementation descendant is closed; otherwise report the blocked
descendants explicitly. Leave the parent spec open and report it ready for
acceptance.

When no spec is selected, preserve the existing repository-wide behavior below,
processing all open implementation issues in tracker order.

## Provider selection

Consult [`MODEL-SELECTION.md`](MODEL-SELECTION.md) for the difficulty rubric,
capability tiers, equivalent providers, capacity tie-breaking, and escalation
policy. A repository override at `.agents/boss-issue-loop/MODEL-SELECTION.md`
takes precedence when present; report which policy is selected.

Rank each task `low`, `medium`, or `high` with a one-sentence rationale, and
choose the lowest capable tier. Among equivalent providers, prefer the larger
remaining weekly usage percentage when comparable data is available; otherwise
use the stable order and report the unavailable capacity data. Use the provider
usage helpers in [`USAGE-HELPERS.md`](USAGE-HELPERS.md) to obtain normalized
weekly capacity; compare only when equivalent providers both report
`status: ok`. Keep at most one writer per worktree, two reviewers, and three
child agents total.

## Orchestration

Read [`ORCHESTRATION.md`](ORCHESTRATION.md), then load the selected adapter
before inspecting or launching agents. A repository override at
`.agents/boss-issue-loop/ORCHESTRATION.md` takes precedence; report the selected
policy and adapter.

Use the adapter only through this interface:

- inspect agents, isolated workspaces, and ownership labels;
- create an isolated writer workspace from an accepted base;
- launch or resume one writer in that workspace;
- launch independent reviewers with read-only access to the fixed-point diff;
- archive agents and disposable workspaces while preserving accepted commits
  and review evidence.

If the adapter cannot provide an operation, stop before mutating repository or
tracker state and report the unsupported operation.

## Issue Loop

1. Read the repository issue-tracker docs, preferences, provider catalog, worktree status, configured orchestration policy and adapter, active agents, and open GitHub issues.
2. Select the first unblocked issue in scope and tracker order. Confirm no active agent or workspace already owns its issue label. Record the accepted base commit.
3. Through the adapter, create `issue-<number>-<slug>` from the accepted base commit. Pass the exact issue number, base commit, and workspace ID to the implementer.
4. Render and send the Implementer Handoff Contract below. Fill every placeholder with the exact issue, accepted base, workspace, and repository-specific commands discovered in step 1. Keep the commit before the final ticket verification gate.
5. Accept only a committed, linear, clean worktree whose verification gates pass. A clearly correctable stall gets one targeted recovery instruction; repeated failure, non-progress, scope corruption, or an explicit blocker follows the escalation policy in MODEL-SELECTION.md (archive the agent and its disposable worktree, retry from the accepted base at the next capability tier).
6. Launch exactly two read-only reviewers in parallel, one from each review tier. Give both the fixed-point diff and issue specification, and deliver the Reviewer Contract below. Ask for concrete findings with file/line references and separate hard defects from advisory concerns.
7. Verify every claimed failure yourself. Resolve actionable findings in the issue worktree, commit the fixes, and rerun the repository and ticket verification gates. Repeat review when a fix materially changes behavior.
8. Integrate only the verified commit into the coordinator branch with a non-interactive fast-forward or merge. Inspect status, diff, and log before integration.
9. Push the integrated branch to its configured remote. Close the issue with a concise implementation and verification comment only after the push succeeds.
10. Through the adapter, archive completed issue agents and disposable workspaces, including stale instances carrying the completed issue label. Preserve the commit and useful review evidence before cleanup.
11. Re-read the open issue frontier and start the next iteration from the new accepted base commit.

## Stop Conditions

- Stop when the open issue frontier is empty.
- Stop and report when the requested provider tier is unavailable after its defined capacity fallback, a required permission is denied, tests remain failing after reasonable fixes, or push cannot complete.
- Never integrate a dirty or unverified worktree, silently skip a blocked issue, overwrite unrelated user changes, or use destructive Git commands.

## Reviewer Contract

For every review, deliver this contract with concrete values:

> Review issue #N at commit `<commit>` against base `<base>` in workspace
> `<workspace>`. Read the complete issue and inspect only the fixed-point diff.
> Do not modify files. Run the verification command `<verification-command>` and
> report its result. Report hard defects first with file/line evidence, then
> advisory concerns. For each finding, name the violated acceptance criterion or
> demonstrated failure. Finish with `approve`, `changes requested`, or `blocked`.
> `blocked` identifies an exact missing dependency, command failure, or
> unavailable item of evidence. Advisory concerns alone yield `approve`.

The implementer supplies the review packet evidence. Bounded review fixes may
resume the same implementer once; failed recovery follows the normal
fresh-worktree escalation with verified findings in the failure note.

## Implementer Handoff Contract

For every writer launch, render this template with concrete values and commands:

> Implement only GitHub issue #<issue-number>, "<issue-title>", from accepted base
> `<base-commit>` in isolated workspace `<workspace-id>` managed by
> `<orchestration-adapter>`.
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
