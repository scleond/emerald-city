# Contributing

## Spec-driven ticket workflow (Matt Pocock skills: to-spec / to-tickets)

This project uses a two-stage issue workflow:

1. **`to-spec`** produces a single issue describing the problem, solution, and
   user stories for a body of work. Label it `spec`.
2. **`to-tickets`** reads that spec issue and generates one issue per
   deliverable slice, each referencing the spec issue by number (e.g.
   `#2`) somewhere in its body. Label every generated issue `generated`.

### Spec-issue lifecycle policy

This section is the single source of truth for how spec issues move through
their lifecycle. Other documents (including `boss-issue-loop/SKILL.md`) reference
this section rather than restating it.

**Phases:**

1. **Active** — The spec issue is open. Child implementation issues are being
   generated (`to-tickets`) or worked on.
2. **Ready for acceptance** — All child implementation issues are closed and
   integrated, and every verification gate has passed. The spec issue remains
   open at this point.
3. **Closed** — A human has accepted the work and closed the spec issue.

**Who closes a spec:** A human, not the issue loop. The loop reports that a
spec is ready for acceptance; the human decides whether the work meets the
spec's intent and closes the issue. Acceptance is a judgment call — the loop
can verify mechanical conditions (child issues closed, gates passed, code
pushed), but only a human can judge whether the result satisfies the original
design.

**When a spec is ready for acceptance (checkable conditions):**

- Every implementation descendant issue is closed.
- Verification gates (lint, typecheck, tests) pass on the integrated commit.
- The integrated commit is pushed to the remote.

If any implementation descendant is still open or blocked, the loop must report
it explicitly — name the issue, its status, and the reason it is blocked —
rather than silently leaving the spec in limbo.

**What the human does on acceptance:**

- Close the spec issue with a comment summarizing the completed work.
- Reference the generated issues (e.g. `Resolved via #3-#15.`).
- The generated issues' cross-references preserve traceability without
  maintaining an open epic-style tracker.

### Labels

| Label       | Applied to                                   |
|-------------|----------------------------------------------|
| `spec`      | The `to-spec` issue (source-of-truth design) |
| `generated` | Every issue `to-tickets` created from a spec |

Only use an `epic`-style live tracker (e.g. a GitHub task-list checklist in
the spec issue body) if a spec is large enough that you genuinely want a
running progress view instead of closing it — treat this as the exception,
not the default. Closed-and-linked is the default because spec issues are
design docs, not project trackers, and an open "epic" checklist tends to go
stale unless someone maintains it deliberately.
