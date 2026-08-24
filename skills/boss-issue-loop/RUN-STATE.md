# Run-state interface

`boss-run-state.ps1` and `boss-run-state.sh` expose the same commands and JSON
shape. The state path defaults to Git metadata (`git rev-parse --git-path
boss-issue-loop`/`run-state.json`), so it is outside the worktree. Set
`BOSS_ISSUE_LOOP_STATE_PATH` only for isolated tests or an equivalent metadata
location. Writes use a same-directory temporary file followed by replacement.

The compact interface is (PowerShell uses `-Issue`; Bash uses `--issue` and
the corresponding long-option spelling):

```text
PowerShell: boss-run-state.ps1 init -Issue N -Base COMMIT -Workspace ID
Bash:       boss-run-state.sh init --issue N --base COMMIT --workspace ID
Both:       get; transition; record; consume; permission; reconcile; outcome
record:     -Kind/--kind verification|review|preservation|fixedPoint|remote
            -Value/--value passed|approved|commit:<id>|pushed|closed
permission: -PermissionId/--permission-id ID
```

The lifecycle phases are `selected`, `implementing`, `verifying`, `reviewing`,
`fixing`, `integrating`, `pushed`, `closed`, and `cleaned`. Terminal outcomes
are `complete`, `blocked`, and `degraded`. A transition already in the state,
an already-observed reconciliation value, and an already-recorded remote
outcome return the current state without changing the lifecycle. Conflicting
identities, invalid transitions, missing verification/review/preservation,
duplicate ownership, conflicting accepted bases, exhausted budgets, repeated
permission identifiers, and terminal-state mutation return a non-zero status
with a JSON error on stderr. Permission identifiers and commit values are
opaque, bounded safe identifiers; only normalized IDs are persisted.

`record fixedPoint -Value commit:<id>` stores the verified fixed-point commit
separately from `acceptedBase`; `record preservation -Value commit:<id>` stores
the preservation evidence. `complete` is accepted only from `cleaned` after
verification, approved review, and preservation. A completed cleaned ledger
may be retired atomically into Git metadata `history/` when `init` starts the
next issue; an active or incomplete ledger retains ownership.

The normalized state object is:

```json
{"schemaVersion":1,"issue":68,"workspace":"wks_…","acceptedBase":"cef0eb4",
 "phase":"selected","outcome":null,"revision":0,
 "budgets":{"recoveryPrompts":0,"writerLaunches":0,"reviewRounds":0,"reviewerReplacements":0},
 "verified":false,"reviewed":false,"preserved":false,"preservedCommit":null,
 "fixedPointCommit":null,"preservationEvidence":null,"observations":[],
 "permissionAttempts":0,"handledPermissionIds":[]}
```

Only opaque identifiers and boolean/result facts belong in state. Credentials,
secret-bearing command output, and transcripts are not accepted by the
interface.
