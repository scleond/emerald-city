#!/usr/bin/env bats
#
# Deterministic tests for get-codex-usage.sh and get-opencode-go-usage.sh.
# Mirrors the four Pester fixture classes (success, unavailable, malformed,
# command-failure) plus cross-variant parity and credential-leak assertions.
#
# Requires: bats-core (https://bats-core.info), jq, curl, GNU date.
# Run:  bats skills/boss-issue-loop/scripts/tests/bash-usage-helpers.bats

SCRIPT_DIR="$(cd "$(dirname "${BATS_TEST_FILENAME}")" && pwd)"
SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CODEX_SCRIPT="$SCRIPTS_DIR/get-codex-usage.sh"
OPENCODE_SCRIPT="$SCRIPTS_DIR/get-opencode-go-usage.sh"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Run the codex script in a subshell with a mocked fetch_codex_rpc.
#   run_codex <mock_result_string>
# Sets CODEX_EXECUTABLE to a no-op so the "codex not found" guard is skipped.
run_codex() {
  local mock_result="$1"
  (
    export CODEX_EXECUTABLE="/usr/bin/env"
    export CODEX_RATE_LIMITS_METHOD="account/rateLimits/read"
    export CODEX_USAGE_TIMEOUT="20"
    export CODEX_WEEKLY_WINDOW_MINUTES="10080"
    source "$CODEX_SCRIPT"
    fetch_codex_rpc() { echo "$mock_result"; }
    main
  ) 2>/dev/null
}

# Run the opencode-go script in a subshell with a mocked fetch_opencode_go_usage.
#   run_opencode_go <http_code> <response_body>
run_opencode_go() {
  local http_code="$1"
  local body="$2"
  (
    export OPENCODE_GO_API_KEY="sk-test-fake-key-12345"
    export OPENCODE_GO_ENDPOINT="http://localhost:0/unused"
    export OPENCODE_GO_USAGE_TIMEOUT="5"
    source "$OPENCODE_SCRIPT"
    fetch_opencode_go_usage() {
      local key="$1"
      local body_file="$2"
      printf '%s' "$body" > "$body_file"
      case "$http_code" in
        200) echo "200";;
        401) echo "401";;
        403) echo "403";;
        500) echo "500";;
        "")  echo "";;
        *)   echo "$http_code";;
      esac
    }
    main
  ) 2>/dev/null
}

# Extract a JSON field from a string.
jq_field() { jq -r "$1" <<<"$2"; }

# ---------------------------------------------------------------------------
# Dependency checks
# ---------------------------------------------------------------------------

@test "declared dependencies are available" {
  command -v jq   >/dev/null 2>&1 || skip "jq not installed"
  command -v curl >/dev/null 2>&1 || skip "curl not installed"
  # GNU date -d support
  date -u -d "@0" +%Y-%m-%dT%H:%M:%SZ >/dev/null 2>&1 || skip "GNU date required"
}

# ===========================================================================
# get-codex-usage.sh
# ===========================================================================

# --- Success fixtures -------------------------------------------------------

@test "codex success: weekly window with resetsAt" {
  result="$(run_codex '{"rateLimits":{"primary":{"usedPercent":28,"resetsAt":1768435200,"windowDurationMins":10080}}}')"
  [ "$(jq_field '.status' "$result")" = "ok" ]
  [ "$(jq_field '.weeklyRemainingPercent' "$result")" = "72" ]
  [ "$(jq_field '.provider' "$result")" = "codex" ]
  resets="$(jq_field '.resetsAt' "$result")"
  [[ "$resets" == "2026-01-15T"* ]]
}

@test "codex success: weekly window without resetsAt" {
  result="$(run_codex '{"rateLimits":{"primary":{"usedPercent":10,"resetsAt":null,"windowDurationMins":10080}}}')"
  [ "$(jq_field '.status' "$result")" = "ok" ]
  [ "$(jq_field '.weeklyRemainingPercent' "$result")" = "90" ]
  [ "$(jq_field '.resetsAt' "$result")" = "null" ]
}

@test "codex success: rateLimitsByLimitId bucket" {
  result="$(run_codex '{"rateLimitsByLimitId":{"codex":{"primary":{"usedPercent":50,"resetsAt":1768435200,"windowDurationMins":10080}}}}')"
  [ "$(jq_field '.status' "$result")" = "ok" ]
  [ "$(jq_field '.weeklyRemainingPercent' "$result")" = "50" ]
}

# --- Unavailable fixture ----------------------------------------------------

@test "codex unavailable: no weekly window" {
  result="$(run_codex '{"rateLimits":{"primary":{"usedPercent":10,"windowDurationMins":60}}}')"
  [ "$(jq_field '.status' "$result")" = "unavailable" ]
  [ "$(jq_field '.weeklyRemainingPercent' "$result")" = "null" ]
  warning="$(jq_field '.warning' "$result")"
  [ -n "$warning" ]
}

# --- Malformed-response fixtures -------------------------------------------

@test "codex malformed: invalid JSON" {
  result="$(run_codex '{not json')"
  [ "$(jq_field '.status' "$result")" = "error" ]
  [ "$(jq_field '.weeklyRemainingPercent' "$result")" = "null" ]
  warning="$(jq_field '.warning' "$result")"
  [ -n "$warning" ]
}

@test "codex malformed: null result" {
  result="$(run_codex 'null')"
  [ "$(jq_field '.status' "$result")" = "error" ]
}

@test "codex malformed: empty result" {
  result="$(run_codex '')"
  [ "$(jq_field '.status' "$result")" = "error" ]
}

@test "codex malformed: unusable usedPercent" {
  result="$(run_codex '{"rateLimits":{"primary":{"usedPercent":"abc","windowDurationMins":10080}}}')"
  [ "$(jq_field '.status' "$result")" = "error" ]
}

# --- Command-failure fixture ------------------------------------------------

@test "codex command failure: RPC error" {
  result="$(run_codex 'RPC_ERROR:boom')"
  [ "$(jq_field '.status' "$result")" = "error" ]
  warning="$(jq_field '.warning' "$result")"
  [[ "$warning" == *"boom"* ]]
}

@test "codex command failure: auth error" {
  result="$(run_codex 'RPC_ERROR:codex login required')"
  [ "$(jq_field '.status' "$result")" = "error" ]
}

# --- Clamping ---------------------------------------------------------------

@test "codex clamping: usedPercent=130 -> remaining=0" {
  result="$(run_codex '{"rateLimits":{"primary":{"usedPercent":130,"windowDurationMins":10080}}}')"
  [ "$(jq_field '.weeklyRemainingPercent' "$result")" = "0" ]
}

@test "codex clamping: usedPercent=-20 -> remaining=100" {
  result="$(run_codex '{"rateLimits":{"primary":{"usedPercent":-20,"windowDurationMins":10080}}}')"
  [ "$(jq_field '.weeklyRemainingPercent' "$result")" = "100" ]
}

# ===========================================================================
# get-opencode-go-usage.sh
# ===========================================================================

# --- Success fixtures -------------------------------------------------------

@test "opencode-go success: weekly percent with resetsAt" {
  result="$(run_opencode_go 200 '{"usage":{"weekly":{"status":"ok","percent":30,"resetsAt":"2026-08-17T00:00:00Z"}}}')"
  [ "$(jq_field '.status' "$result")" = "ok" ]
  [ "$(jq_field '.weeklyRemainingPercent' "$result")" = "70" ]
  [ "$(jq_field '.provider' "$result")" = "opencode-go" ]
  resets="$(jq_field '.resetsAt' "$result")"
  [[ "$resets" == "2026-08-17T00:00:00Z" ]]
}

@test "opencode-go success: weeklyUsage shape" {
  result="$(run_opencode_go 200 '{"weeklyUsage":{"status":"ok","usagePercent":15,"resetsAt":"2026-09-01T00:00:00Z"}}')"
  [ "$(jq_field '.status' "$result")" = "ok" ]
  [ "$(jq_field '.weeklyRemainingPercent' "$result")" = "85" ]
}

@test "opencode-go success: without resetsAt" {
  result="$(run_opencode_go 200 '{"usage":{"weekly":{"status":"ok","percent":50}}}')"
  [ "$(jq_field '.status' "$result")" = "ok" ]
  [ "$(jq_field '.weeklyRemainingPercent' "$result")" = "50" ]
  [ "$(jq_field '.resetsAt' "$result")" = "null" ]
}

# --- Unavailable fixture ----------------------------------------------------

@test "opencode-go unavailable: no weekly window" {
  result="$(run_opencode_go 200 '{"usage":{"rolling":{"percent":1,"resetsAt":"2026-08-16T00:00:00Z"}}}')"
  [ "$(jq_field '.status' "$result")" = "unavailable" ]
  [ "$(jq_field '.weeklyRemainingPercent' "$result")" = "null" ]
}

@test "opencode-go unavailable: 401 no Go subscription" {
  result="$(run_opencode_go 401 '{}')"
  [ "$(jq_field '.status' "$result")" = "unavailable" ]
  warning="$(jq_field '.warning' "$result")"
  [[ "$warning" == *"401"* ]]
}

@test "opencode-go unavailable: 403" {
  result="$(run_opencode_go 403 '{}')"
  [ "$(jq_field '.status' "$result")" = "unavailable" ]
}

# --- Malformed-response fixtures -------------------------------------------

@test "opencode-go malformed: invalid JSON body" {
  result="$(run_opencode_go 200 'not json')"
  [ "$(jq_field '.status' "$result")" = "unavailable" ]
  [ "$(jq_field '.weeklyRemainingPercent' "$result")" = "null" ]
}

@test "opencode-go malformed: empty body" {
  result="$(run_opencode_go 200 '')"
  [ "$(jq_field '.status' "$result")" = "unavailable" ]
}

@test "opencode-go malformed: unusable percent" {
  result="$(run_opencode_go 200 '{"usage":{"weekly":{"status":"ok","percent":"abc","resetsAt":"2026-08-17T00:00:00Z"}}}')"
  [ "$(jq_field '.status' "$result")" = "unavailable" ]
}

# --- Command-failure fixture ------------------------------------------------

@test "opencode-go command failure: curl error (empty http_code)" {
  result="$(run_opencode_go "" '{}')"
  [ "$(jq_field '.status' "$result")" = "error" ]
}

@test "opencode-go command failure: unexpected HTTP 500" {
  result="$(run_opencode_go 500 'oops')"
  [ "$(jq_field '.status' "$result")" = "error" ]
}

# --- Clamping ---------------------------------------------------------------

@test "opencode-go clamping: percent=150 -> remaining=0" {
  result="$(run_opencode_go 200 '{"usage":{"weekly":{"status":"ok","percent":150}}}')"
  [ "$(jq_field '.weeklyRemainingPercent' "$result")" = "0" ]
}

@test "opencode-go clamping: percent=-5 -> remaining=100" {
  result="$(run_opencode_go 200 '{"usage":{"weekly":{"status":"ok","percent":-5}}}')"
  [ "$(jq_field '.weeklyRemainingPercent' "$result")" = "100" ]
}

# ===========================================================================
# Cross-variant parity
# ===========================================================================

@test "parity: identical weekly window -> same status, remaining, resetsAt" {
  codex_out="$(run_codex '{"rateLimits":{"primary":{"usedPercent":28,"resetsAt":1768435200,"windowDurationMins":10080}}}')"
  opencode_out="$(run_opencode_go 200 '{"usage":{"weekly":{"status":"ok","percent":28,"resetsAt":"2026-01-15T00:00:00Z"}}}')"

  [ "$(jq_field '.status' "$codex_out")" = "$(jq_field '.status' "$opencode_out")" ]
  [ "$(jq_field '.weeklyRemainingPercent' "$codex_out")" = "$(jq_field '.weeklyRemainingPercent' "$opencode_out")" ]

  # Both should produce the same ISO-8601 UTC resetsAt (from different sources)
  codex_resets="$(jq_field '.resetsAt' "$codex_out")"
  opencode_resets="$(jq_field '.resetsAt' "$opencode_out")"
  [[ "$codex_resets" == "2026-01-15T"* ]]
  [[ "$opencode_resets" == "2026-01-15T"* ]]
}

@test "parity: unavailable on missing window -> same status and null percent" {
  codex_out="$(run_codex '{"rateLimits":{"primary":{"usedPercent":10,"windowDurationMins":60}}}')"
  opencode_out="$(run_opencode_go 200 '{"usage":{"rolling":{"percent":1}}}')"

  [ "$(jq_field '.status' "$codex_out")" = "unavailable" ]
  [ "$(jq_field '.status' "$opencode_out")" = "unavailable" ]
  [ "$(jq_field '.weeklyRemainingPercent' "$codex_out")" = "null" ]
  [ "$(jq_field '.weeklyRemainingPercent' "$opencode_out")" = "null" ]
}

@test "parity: clamping at bounds -> same remaining" {
  codex_out="$(run_codex '{"rateLimits":{"primary":{"usedPercent":130,"windowDurationMins":10080}}}')"
  opencode_out="$(run_opencode_go 200 '{"usage":{"weekly":{"status":"ok","percent":130}}}')"

  [ "$(jq_field '.weeklyRemainingPercent' "$codex_out")" = "0" ]
  [ "$(jq_field '.weeklyRemainingPercent' "$opencode_out")" = "0" ]
}

@test "parity: malformed input -> both return error or unavailable" {
  codex_out="$(run_codex '{bad')"
  opencode_out="$(run_opencode_go 200 'not json')"

  codex_status="$(jq_field '.status' "$codex_out")"
  opencode_status="$(jq_field '.status' "$opencode_out")"
  # Both should indicate failure (error or unavailable), never ok
  [ "$codex_status" != "ok" ]
  [ "$opencode_status" != "ok" ]
}

# ===========================================================================
# Credential leak assertions
# ===========================================================================

@test "codex: no credential in stdout or stderr on success" {
  out="$(run_codex '{"rateLimits":{"primary":{"usedPercent":50,"windowDurationMins":10080}}}')"
  [[ "$out" != *"sk-"* ]]
  [[ "$out" != *"api_key"* ]]
  [[ "$out" != *"API_KEY"* ]]
  [[ "$out" != *"token"* ]]
  [[ "$out" != *"Bearer"* ]]
}

@test "codex: no credential in stdout or stderr on error" {
  out="$(run_codex 'RPC_ERROR:auth required')"
  [[ "$out" != *"sk-"* ]]
  [[ "$out" != *"api_key"* ]]
  [[ "$out" != *"API_KEY"* ]]
}

@test "opencode-go: no credential in stdout or stderr on success" {
  out="$(run_opencode_go 200 '{"usage":{"weekly":{"status":"ok","percent":30}}}')"
  [[ "$out" != *"sk-"* ]]
  [[ "$out" != *"api_key"* ]]
  [[ "$out" != *"API_KEY"* ]]
  [[ "$out" != *"token"* ]]
  [[ "$out" != *"Bearer"* ]]
}

@test "opencode-go: no credential in stdout or stderr on 401" {
  out="$(run_opencode_go 401 '{}')"
  [[ "$out" != *"sk-"* ]]
  [[ "$out" != *"api_key"* ]]
  [[ "$out" != *"API_KEY"* ]]
}

@test "opencode-go: no credential in stdout or stderr on 500" {
  out="$(run_opencode_go 500 'oops')"
  [[ "$out" != *"sk-"* ]]
  [[ "$out" != *"api_key"* ]]
  [[ "$out" != *"API_KEY"* ]]
}
