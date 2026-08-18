# Contributing

## Spec-driven ticket workflow (Matt Pocock skills: to-spec / to-tickets)

This project uses a two-stage issue workflow:

1. **`to-spec`** produces a single issue describing the problem, solution, and
   user stories for a body of work. Label it `spec`.
2. **`to-tickets`** reads that spec issue and generates one issue per
   deliverable slice. Each child issue must be linked to the spec as a **native
   GitHub sub-issue** (the `subIssues` GraphQL connection) — body cross-references
   alone do not establish the parent → child relation the loop depends on.
   Label every generated issue `generated`.

### Linkage requirement

The `boss-issue-loop` scope selection traverses native sub-issues via
`SUB-ISSUE-TRAVERSAL.md`. For `to-tickets` output to be visible to the loop,
each generated child must be a native sub-issue of the spec. Body references
(`#N` mentions) are supplementary traceability only — they do not populate the
`subIssues` connection. When both exist, native sub-issues are the authoritative
relation; body references are a fallback for humans reading the issue.

### Closing the spec issue

Once the spec issue's own acceptance criteria are satisfied (i.e. `to-tickets`
has produced its full set of child issues, or the described work is done),
**close the spec issue** — don't leave it open as a long-lived tracker.

- The generated issues are native sub-issues of the spec, so GitHub's
  sub-issue UI and GraphQL `subIssues` connection preserve traceability after
  the spec issue is closed. No separate epic bookkeeping is required.
- Add a closing comment naming the range of generated issues, e.g.
  `Spec complete — work split into #3-#15 via to-tickets.`

### Labels

| Label       | Applied to                                   |
|-------------|-----------------------------------------------|
| `spec`      | The `to-spec` issue (source-of-truth design)  |
| `generated` | Every issue `to-tickets` created from a spec  |

Only use an `epic`-style live tracker (e.g. a GitHub task-list checklist in
the spec issue body) if a spec is large enough that you genuinely want a
running progress view instead of closing it — treat this as the exception,
not the default. Closed-and-linked is the default because spec issues are
design docs, not project trackers, and an open "epic" checklist tends to go
stale unless someone maintains it deliberately.
