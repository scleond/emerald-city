# Provider usage helpers

`get-codex-usage.ps1` and `get-opencode-go-usage.ps1` are provider-usage
helpers for the Boss issue loop's capacity tie-breaking
(`skills/boss-issue-loop/MODEL-SELECTION.md`). Each hides provider-specific
authentication and usage lookup behind one normalized JSON result.

Native bash equivalents are provided for Linux hosts without PowerShell:
`get-codex-usage.sh` and `get-opencode-go-usage.sh`. They emit the same
normalized interface and follow the same trust/fallback rules; they require
`curl`, `jq`, and (for the codex script) GNU `date`. Both the PowerShell and bash
variants are configured via environment variables listed in each script's
header (for example `CODEX_EXECUTABLE`, `OPENCODE_GO_API_KEY`).

## Normalized interface

Both scripts write a single JSON object to stdout with this shape:

```json
{
  "provider": "codex | opencode-go",
  "status": "ok | unavailable | error",
  "weeklyRemainingPercent": 72,
  "resetsAt": "ISO-8601 timestamp or null",
  "source": "provider-specific source or null",
  "warning": "message or null"
}
```

`weeklyRemainingPercent` and `resetsAt` are `null` when the capacity or reset
value is unknown. The boss consumes only this interface.

## Status semantics

- `ok` — a usable weekly rate-limit window was found and normalized. `status: ok`
  is the only state on which a provider comparison may be attempted.
- `unavailable` — structurally valid but no authoritative capacity could be
  obtained (no weekly window, or the session is not usable for the read). A
  useful `warning` names why.
- `error` — the fetch command failed or returned a malformed response.

A helper failure never aborts issue selection and never exposes credentials.

## `get-codex-usage.ps1`

Spawns `codex app-server --stdio` and speaks newline-delimited JSON-RPC over
stdio: `initialize`, `initialized`, then `account/rateLimits/read`. It selects
the weekly rate-limit window from the response (`primary`/`secondary` windows
across `rateLimits` and `rateLimitsByLimitId`). `weeklyRemainingPercent =
100 - usedPercent`, clamped to `[0, 100]`; `resetsAt` is normalized from Unix
seconds to ISO-8601 UTC.

Codex exposes no non-interactive usage subcommand, and the interactive `/usage`
screen is intentionally not automated. Driving the app-server's JSON-RPC
`account/rateLimits/read` (the same surface the TUI uses) is the clean shell-out:
it needs no TTY and never touches credentials.

- Credentials live in the logged-in Codex session handled by the app-server; the
  script never reads, prints, copies, or persists access tokens, and never
  requests a new login.
- Returns `unavailable` (with a warning) when the session is unavailable for the
  read; returns `error` when the RPC fails, times out, or the response is
  malformed.
- Parameters: `-CodexExecutable` (default `codex`), `-RateLimitsMethod`
  (default `account/rateLimits/read`), `-TimeoutSeconds` (default `20`),
  `-WeeklyWindowMinutes` (default `10080`, i.e. 7 days).

## `get-opencode-go-usage.ps1`

Queries the official OpenCode Go usage endpoint
(`https://opencode.ai/zen/go/v1/usage`, upstream
[anomalyco/opencode#16513](https://github.com/anomalyco/opencode/pull/16513))
and normalizes the weekly window from the response
(`usage.weekly.percent` / `resetInSec`). The API key is resolved from the
OpenCode auth store (`~/.local/share/opencode/auth.json`), or from
`OPENCODE_GO_API_KEY` / `-ApiKey`, and is used only in memory for the Bearer
header.

- The key is never printed, logged, copied, or persisted by the script.
- It does **not** treat `opencode stats` local session history as authoritative
  server-side plan usage.
- It does **not** scrape the web console, browser cookies, or stored credential
  files.
- Returns `unavailable` (with a warning) when no key is found or the key has no
  Go subscription (HTTP 401/403); returns `error` on transport failure or a
  malformed/non-200 response.
- Parameters: `-Endpoint` (default `https://opencode.ai/zen/go/v1/usage`),
  `-TimeoutSeconds` (default `20`), `-ApiKey` (explicit override),
  `-AuthStorePath` (override the auth store location).

## Trust and fallback

- The boss compares weekly remaining percentage only when equivalent providers
  both return `status: ok` and comparable values; otherwise it keeps the stable
  provider order and reports the unavailable capacity data.
- Never fall back from an `unavailable` result to a guessed value.
- The OpenCode Go script's local-history and scraping prohibitions are hard
  constraints, not fallback candidates.

## Tests

Deterministic Pester tests live in `scripts/tests/`. They cover representative
success, unavailable, malformed-response, and command-failure fixtures, and
validate the emitted JSON shape plus percentage bounds.

Run from the repo root:

```powershell
Invoke-Pester .\skills\boss-issue-loop\scripts\tests
```

The scripts are designed so the fetch step (`Invoke-RateLimitsRead` /
`Invoke-GoUsage`) can be mocked; each script's main body only runs when it is
executed as a script, not when dot-sourced by the test harness.
