---
name: boss-issue-loop
description: "Run a reviewed GitHub issue loop: select scoped work, delegate implementation through the configured agent orchestrator, verify independent reviews, integrate and push the result, close the issue, and clean disposable resources."
---

# Boss Issue Loop

You are the coordinator. Continue issue by issue until no actionable open issue
remains, or a concrete blocker requires the user.

## Scope selection

When invoked with a native GitHub issue labeled `spec`, traverse its complete
native sub-issue descendant tree using the query in
[`SUB-ISSUE-TRAVERSAL.md`](SUB-ISSUE-TRAVERSAL.md). Native sub-issues are the
`subIssues` GraphQL connection — body cross-references (`#N` mentions) do not
qualify. Nested spec issues (also labeled `spec`) are organizational nodes, not
implementation tickets: enumerate them, but select only their implementation
descendants for work.

### Zero-descendant guard

If the spec issue has zero implementation descendants (issues not labeled
`spec`) after traversing the full descendant tree, report: `Spec #N has zero
discovered implementation descendants — not eligible for loop processing.` Do
not treat this as successful completion. A spec with no implementation work to
select; the loop moves on.

### Selection order

Select unblocked descendants dependency-first, then in tracker order. Ignore
unrelated repository issues. Finish successfully only when every
implementation descendant is closed; otherwise report the blocked descendants
explicitly. Leave the parent spec open and report it ready for acceptance.

When no spec is selected, preserve the existing repository-wide behavior below,
processing all open implementation issues in tracker order.

## Provider selection

Policy is resolved **per section** through a three-level merge, most-specific
wins. Each section of `MODEL-SELECTION.md` is resolved independently — a
repository that wants to floor everything at tier 3 must not restate the user's
whole roster to do it.

### Resolution levels

| Level | Source | Contains | Committed? |
|-------|--------|----------|------------|
| **Packaged** | `skills/boss-issue-loop/MODEL-SELECTION.md` | Portable policy only: difficulty rubric, escalation policy, tie-break rules. | Yes (never edited, blanked, or git-ignored) |
| **User/machine** | `~/.config/opencode/boss-issue-loop/MODEL-SELECTION.md` (Linux); `~/Library/Application Support/opencode/boss-issue-loop/MODEL-SELECTION.md` (macOS); `%APPDATA%\opencode\boss-issue-loop\MODEL-SELECTION.md` (Windows) | Local inventory: model roster, tier assignments, adapter selection. | No — never committed to a repository |
| **Repository** | `.agents/boss-issue-loop/MODEL-SELECTION.md` | Only what genuinely varies per repository: verification commands, a minimum capability floor, per-repository tier pinning. | Yes |

### Per-section merge rules

For each heading in `MODEL-SELECTION.md`:

1. Start with the **packaged** default for that section.
2. If the **user/machine** level defines the same section heading, merge its
   content in. Sections present only in the user file are added; sections absent
   from it leave the packaged default untouched.
3. If the **repository** level defines the same section heading, merge its
   content in last. Same rules: add new sections, override existing ones.

Most-specific wins per section: if a section exists at a higher level it
completely replaces the same section at lower levels; there is no field-by-field
deep merge within a section.

### Worked example

Given these three files:

**Packaged** (always present):
```markdown
## Difficulty rubric
[default rubric — low/medium/high definitions]

## Capability tiers
[default tier definitions — Tier 1 through 4]

## Escalation policy
[default escalation rules]
```

**User/machine** (`~/.config/opencode/boss-issue-loop/MODEL-SELECTION.md`):
```markdown
## Capability tiers
- **Tier 1** — `{ provider: "opencode", model: "opencode-go/mimo-v2.5", effort: "low" }`
- **Tier 2** — `{ provider: "opencode", model: "opencode-go/gpt-5.6-luna", effort: "low" }`
```

**Repository** (`.agents/boss-issue-loop/MODEL-SELECTION.md`):
```markdown
## Capability tiers
- **Tier 1** — `{ provider: "opencode", model: "opencode-go/mimo-v2.5", effort: "low" }`
- **Tier 2** — `{ provider: "codex", model: "gpt-5.6-luna", effort: "high" }`
```

**Resolved output:**

| Section | Source used | Why |
|---------|-------------|-----|
| Difficulty rubric | Packaged | No user or repository override for this section |
| Capability tiers | Repository | Repository overrides user overrides packaged for this section |
| Escalation policy | Packaged | No user or repository override for this section |

The repository pins capability tiers without repeating the user's full roster
and without restating the packaged escalation policy.

### Absent, unreadable, or partially specified levels

- **Absent** — missing file or directory: that level contributes nothing. The
  next-more-specific level applies. If all three are absent for a section, the
  section is empty and the coordinator reports it.
- **Unreadable** — file exists but cannot be read (permission error, encoding
  failure): warn at coordinator startup that the level was skipped, then
  continue as if it were absent.
- **Partially specified** — file exists and is readable but a particular section
  is missing: that section is absent at this level; the lower level's version
  applies. A file that overrides `Capability tiers` but not `Escalation policy`
  inherits the escalation policy from whichever lower level defines it.

### Coordinator reporting

At the start of each run, report which levels contributed to the selected
policy for each section. Example output:

```
Provider policy resolved:
  Difficulty rubric     → packaged
  Capability tiers      → repository (.agents/boss-issue-loop/MODEL-SELECTION.md)
  Escalation policy     → packaged
```

If a level was skipped due to absence or unreadability, say so explicitly
(e.g. `User/machine level skipped — file not found`).

Rank each task `low`, `medium`, or `high` with a one-sentence rationale, and
choose the lowest capable tier. Among equivalent providers, if both report
`status: ok` prefer the larger remaining weekly usage percentage; otherwise use
the stable declared order. Use the provider usage helpers in
[`USAGE-HELPERS.md`](USAGE-HELPERS.md) to obtain normalized weekly capacity.
Keep at most one writer per worktree, two reviewers, and three child agents
total.

## Orchestration

Resolve the adapter **per run** through a three-level merge, most-specific wins.
Do this before inspecting or launching agents.

### Adapter selection

| Level | Source | Contains |
|-------|--------|----------|
| **Packaged** | `skills/boss-issue-loop/orchestration/` | Built-in adapters: `paseo`, `herdr`. Default: `paseo`. |
| **User/machine** | `~/.config/opencode/boss-issue-loop/ORCHESTRATION.md` (Linux); `~/Library/Application Support/opencode/boss-issue-loop/ORCHESTRATION.md` (macOS); `%APPDATA%\opencode\boss-issue-loop\ORCHESTRATION.md` (Windows) | `adapter: <name>` directive selecting a packaged adapter. |
| **Repository** | `.agents/boss-issue-loop/ORCHESTRATION.md` | `adapter: <name>` or `adapter: <path>` for a custom adapter document. |

Resolution: start with the packaged default (`paseo`). If the user/machine
level defines `adapter:`, use it. If the repository level defines `adapter:`,
use it. A repository-level custom adapter path is resolved from the repository
root.

### Fallback rules

- If the override is missing, unreadable, names multiple adapters, or leaves
  an interface operation undefined, warn and use the packaged Paseo adapter.
- If the packaged adapter is also unavailable, stop before launching agents.

### Adapter guarantees

Load exactly one adapter for an issue attempt and report its name. Keep that
adapter through implementation, review, integration, and cleanup. Select a new
adapter only before a fresh attempt begins.

### Loading the adapter

After resolution, load the adapter document:
- `paseo` → [`orchestration/paseo.md`](orchestration/paseo.md)
- `herdr` → [`orchestration/herdr.md`](orchestration/herdr.md)
- custom path → load from the resolved path

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

**Coordinator branch** is the branch the coordinator maintains for integration.
Default: `main`. The accepted base commit is the coordinator branch head at the
start of each iteration; the coordinator never advances the branch except in
step 8.

1. Read the repository issue-tracker docs, preferences, provider catalog, worktree status, configured orchestration policy and adapter, active agents, and open GitHub issues.
2. Select the first unblocked issue in scope and tracker order. Confirm no active agent or workspace already owns its issue label. Record the accepted base commit (the current HEAD of the coordinator branch).
3. Through the adapter, create `issue-<number>-<slug>` from the accepted base commit. Pass the exact issue number, base commit, and workspace ID to the implementer.
4. Render and send the Implementer Handoff Contract below. Fill every placeholder with the exact issue, accepted base, workspace, and repository-specific commands discovered in step 1. The implementer must commit all changes before running the final ticket verification gate.
5. Accept only a committed, linear, clean worktree whose verification gates pass. A clearly correctable stall gets one targeted recovery instruction; repeated failure, non-progress, scope corruption, or an explicit blocker follows the escalation policy in MODEL-SELECTION.md (archive the agent and its disposable worktree, retry from the accepted base at the next capability tier).
6. Launch exactly two independent read-only reviewers in parallel. Select review tiers appropriate to the ranked difficulty: `low` tasks draw from the lowest review tier, `medium` from the mid tier, and `high` from the highest available tier — always two distinct reviewers regardless of tier. Give both the fixed-point diff and issue specification, and deliver the Reviewer Contract below. Report which review tiers were selected and the difficulty-ranked rationale. Ask for concrete findings with file/line references and separate hard defects from advisory concerns.
7. Verify every claimed failure yourself. Resolve actionable findings in the issue worktree, commit the fixes, and rerun the repository and ticket verification gates. Repeat review when a fix materially changes behavior — but archive the completed reviewers first to free a slot under the three-child-agent cap, then launch fresh reviewers. The implementer may be resumed once for bounded review fixes without archiving; if the resumed implementer fails or the fix materially changes behavior, archive it and escalate normally.
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
