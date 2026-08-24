# Ship Gate

Ship Gate is an advisory, self-contained Paseo plugin. It runs only trusted,
configured checks in an explicitly selected workspace and returns immutable,
bounded reports. It never changes repository files or performs Git mutations.

The framework-neutral runner is in `ship-gate.ts`; Paseo UI/RPC code is an
adapter layer. Run `npm test` and `npm run typecheck` from this directory.

Configured commands use fixed built-in IDs only. The current built-in is
`git-status`, which runs the immutable read-only `git status --short` spec.
`trusted-test` is rejected by the production runner and exists only for
injected test runners. The `ship-gate.run` RPC accepts an explicit workspace
and validated policy selection and returns the immutable report.

Conflict-marker checks inspect Git's `ls-files --others --ignored --exclude-standard`
listing, so ignored untracked files are covered. Dependency, generated, and
secret-like paths are excluded; enumeration and prefix reads are bounded by
file count, total bytes, output size, timeout, and cancellation.

Filesystem cancellation is cooperative: the scanner checks the signal before
each entry and bounded file read. An OS read already in progress cannot be
interrupted portably, but no later read is scheduled and the final report is
marked cancelled when cancellation is observed.
