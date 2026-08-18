#!/usr/bin/env bash
#
# Standalone test runner for bash usage helpers.
# Used when bats-core is not installed. Preferred: use bash-usage-helpers.bats.
#
# Run:  bash skills/boss-issue-loop/scripts/tests/run-bash-tests.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CODEX_SCRIPT="$SCRIPTS_DIR/get-codex-usage.sh"
OPENCODE_SCRIPT="$SCRIPTS_DIR/get-opencode-go-usage.sh"

PASS=0
FAIL=0
SKIP=0
FAILURES=()

# --- Helpers ----------------------------------------------------------------

jq_field() { jq -r "$1" <<<"$2"; }

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

run_opencode_go() {
  local http_code="$1"
  local body="$2"
  (
    export OPENCODE_GO_API_KEY="sk-test-fake-key-12345"
    export OPENCODE_GO_ENDPOINT="http://localhost:0/unused"
    export OPENCODE_GO_USAGE_TIMEOUT="5"
    source "$OPENCODE_SCRIPT"
    fetch_opencode_go_usage() {
      case "$http_code" in
        200) echo "$body";;
        401) echo "HTTP_401";;
        403) echo "HTTP_403";;
        500) echo "HTTP_500";;
        "")  echo "";;
        *)   echo "HTTP_$http_code";;
      esac
    }
    main
  ) 2>/dev/null
}

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    ((PASS++))
  else
    ((FAIL++))
    FAILURES+=("FAIL: $label — expected '$expected', got '$actual'")
  fi
}

assert_match() {
  local label="$1" pattern="$2" actual="$3"
  if [[ "$actual" == *"$pattern"* ]]; then
    ((PASS++))
  else
    ((FAIL++))
    FAILURES+=("FAIL: $label — expected to match '$pattern', got '$actual'")
  fi
}

assert_not_match() {
  local label="$1" pattern="$2" actual="$3"
  if [[ "$actual" != *"$pattern"* ]]; then
    ((PASS++))
  else
    ((FAIL++))
    FAILURES+=("FAIL: $label — should NOT contain '$pattern', got '$actual'")
  fi
}

# --- Dependency check -------------------------------------------------------

check_deps() {
  local missing=()
  command -v jq   >/dev/null 2>&1 || missing+=("jq")
  command -v curl >/dev/null 2>&1 || missing+=("curl")
  date -u -d "@0" +%Y-%m-%dT%H:%M:%SZ >/dev/null 2>&1 || missing+=("GNU date")
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "SKIP: missing dependencies: ${missing[*]}"
    exit 0
  fi
}

# --- Codex tests ------------------------------------------------------------

test_codex_success_weekly() {
  local r; r="$(run_codex '{"rateLimits":{"primary":{"usedPercent":28,"resetsAt":1768435200,"windowDurationMins":10080}}}')"
  assert_eq "codex success: status"       "ok"  "$(jq_field '.status' "$r")"
  assert_eq "codex success: remaining"    "72"  "$(jq_field '.weeklyRemainingPercent' "$r")"
  assert_eq "codex success: provider"     "codex" "$(jq_field '.provider' "$r")"
}

test_codex_success_no_resets() {
  local r; r="$(run_codex '{"rateLimits":{"primary":{"usedPercent":10,"resetsAt":null,"windowDurationMins":10080}}}')"
  assert_eq "codex no-resets: status"    "ok"   "$(jq_field '.status' "$r")"
  assert_eq "codex no-resets: remaining" "90"   "$(jq_field '.weeklyRemainingPercent' "$r")"
  assert_eq "codex no-resets: resetsAt"  "null" "$(jq_field '.resetsAt' "$r")"
}

test_codex_unavailable() {
  local r; r="$(run_codex '{"rateLimits":{"primary":{"usedPercent":10,"windowDurationMins":60}}}')"
  assert_eq "codex unavailable: status"    "unavailable" "$(jq_field '.status' "$r")"
  assert_eq "codex unavailable: remaining" "null"        "$(jq_field '.weeklyRemainingPercent' "$r")"
}

test_codex_malformed_json() {
  local r; r="$(run_codex '{not json')"
  assert_eq "codex malformed: status" "error" "$(jq_field '.status' "$r")"
}

test_codex_malformed_null() {
  local r; r="$(run_codex 'null')"
  assert_eq "codex null: status" "error" "$(jq_field '.status' "$r")"
}

test_codex_malformed_empty() {
  local r; r="$(run_codex '')"
  assert_eq "codex empty: status" "error" "$(jq_field '.status' "$r")"
}

test_codex_malformed_bad_percent() {
  local r; r="$(run_codex '{"rateLimits":{"primary":{"usedPercent":"abc","windowDurationMins":10080}}}')"
  assert_eq "codex bad-percent: status" "error" "$(jq_field '.status' "$r")"
}

test_codex_rpc_error() {
  local r; r="$(run_codex 'RPC_ERROR:boom')"
  assert_eq "codex rpc-error: status" "error" "$(jq_field '.status' "$r")"
  assert_match "codex rpc-error: warning" "boom" "$(jq_field '.warning' "$r")"
}

test_codex_rpc_auth_error() {
  local r; r="$(run_codex 'RPC_ERROR:codex login required')"
  assert_eq "codex rpc-auth-error: status" "unavailable" "$(jq_field '.status' "$r")"
}

test_codex_clamp_high() {
  local r; r="$(run_codex '{"rateLimits":{"primary":{"usedPercent":130,"windowDurationMins":10080}}}')"
  assert_eq "codex clamp-high: remaining" "0" "$(jq_field '.weeklyRemainingPercent' "$r")"
}

test_codex_clamp_low() {
  local r; r="$(run_codex '{"rateLimits":{"primary":{"usedPercent":-20,"windowDurationMins":10080}}}')"
  assert_eq "codex clamp-low: remaining" "100" "$(jq_field '.weeklyRemainingPercent' "$r")"
}

# --- OpenCode Go tests ------------------------------------------------------

test_opencode_go_success() {
  local r; r="$(run_opencode_go 200 '{"usage":{"weekly":{"status":"ok","percent":30,"resetsAt":"2026-08-17T00:00:00Z"}}}')"
  assert_eq "ocgo success: status"    "ok" "$(jq_field '.status' "$r")"
  assert_eq "ocgo success: remaining" "70" "$(jq_field '.weeklyRemainingPercent' "$r")"
  assert_eq "ocgo success: provider"  "opencode-go" "$(jq_field '.provider' "$r")"
}

test_opencode_go_success_weekly_usage() {
  local r; r="$(run_opencode_go 200 '{"weeklyUsage":{"status":"ok","usagePercent":15,"resetsAt":"2026-09-01T00:00:00Z"}}')"
  assert_eq "ocgo weeklyUsage: status"    "ok" "$(jq_field '.status' "$r")"
  assert_eq "ocgo weeklyUsage: remaining" "85" "$(jq_field '.weeklyRemainingPercent' "$r")"
}

test_opencode_go_unavailable_no_weekly() {
  local r; r="$(run_opencode_go 200 '{"usage":{"rolling":{"percent":1,"resetsAt":"2026-08-16T00:00:00Z"}}}')"
  assert_eq "ocgo no-weekly: status"    "unavailable" "$(jq_field '.status' "$r")"
  assert_eq "ocgo no-weekly: remaining" "null"        "$(jq_field '.weeklyRemainingPercent' "$r")"
}

test_opencode_go_401() {
  local r; r="$(run_opencode_go 401 '{}')"
  assert_eq "ocgo 401: status" "unavailable" "$(jq_field '.status' "$r")"
}

test_opencode_go_403() {
  local r; r="$(run_opencode_go 403 '{}')"
  assert_eq "ocgo 403: status" "unavailable" "$(jq_field '.status' "$r")"
}

test_opencode_go_malformed_body() {
  local r; r="$(run_opencode_go 200 'not json')"
  assert_eq "ocgo malformed: status" "error" "$(jq_field '.status' "$r")"
}

test_opencode_go_empty_body() {
  local r; r="$(run_opencode_go 200 '')"
  assert_eq "ocgo empty: status" "error" "$(jq_field '.status' "$r")"
}

test_opencode_go_curl_error() {
  local r; r="$(run_opencode_go "" '{}')"
  assert_eq "ocgo curl-err: status" "error" "$(jq_field '.status' "$r")"
}

test_opencode_go_500() {
  local r; r="$(run_opencode_go 500 'oops')"
  assert_eq "ocgo 500: status" "error" "$(jq_field '.status' "$r")"
}

test_opencode_go_clamp_high() {
  local r; r="$(run_opencode_go 200 '{"usage":{"weekly":{"status":"ok","percent":150}}}')"
  assert_eq "ocgo clamp-high: remaining" "0" "$(jq_field '.weeklyRemainingPercent' "$r")"
}

test_opencode_go_clamp_low() {
  local r; r="$(run_opencode_go 200 '{"usage":{"weekly":{"status":"ok","percent":-5}}}')"
  assert_eq "ocgo clamp-low: remaining" "100" "$(jq_field '.weeklyRemainingPercent' "$r")"
}

# --- Parity tests -----------------------------------------------------------

test_parity_identical_window() {
  local c; c="$(run_codex '{"rateLimits":{"primary":{"usedPercent":28,"resetsAt":1768435200,"windowDurationMins":10080}}}')"
  local o; o="$(run_opencode_go 200 '{"usage":{"weekly":{"status":"ok","percent":28,"resetsAt":"2026-01-15T00:00:00Z"}}}')"
  assert_eq "parity: status"    "ok" "$(jq_field '.status' "$c")"
  assert_eq "parity: remaining" "72" "$(jq_field '.weeklyRemainingPercent' "$c")"
  assert_eq "parity: remaining (ocgo)" "72" "$(jq_field '.weeklyRemainingPercent' "$o")"
  assert_eq "parity: status (ocgo)"    "ok" "$(jq_field '.status' "$o")"
}

test_parity_unavailable() {
  local c; c="$(run_codex '{"rateLimits":{"primary":{"usedPercent":10,"windowDurationMins":60}}}')"
  local o; o="$(run_opencode_go 200 '{"usage":{"rolling":{"percent":1}}}')"
  assert_eq "parity unavailable: codex"    "unavailable" "$(jq_field '.status' "$c")"
  assert_eq "parity unavailable: opencode" "unavailable" "$(jq_field '.status' "$o")"
}

test_parity_clamping() {
  local c; c="$(run_codex '{"rateLimits":{"primary":{"usedPercent":130,"windowDurationMins":10080}}}')"
  local o; o="$(run_opencode_go 200 '{"usage":{"weekly":{"status":"ok","percent":130}}}')"
  assert_eq "parity clamp: codex"    "0" "$(jq_field '.weeklyRemainingPercent' "$c")"
  assert_eq "parity clamp: opencode" "0" "$(jq_field '.weeklyRemainingPercent' "$o")"
}

# --- Credential leak tests --------------------------------------------------

test_codex_no_creds_success() {
  local r; r="$(run_codex '{"rateLimits":{"primary":{"usedPercent":50,"windowDurationMins":10080}}}')"
  assert_not_match "codex cred ok: sk-"    "sk-"    "$r"
  assert_not_match "codex cred ok: api_key" "api_key" "$r"
  assert_not_match "codex cred ok: Bearer"  "Bearer"  "$r"
}

test_codex_no_creds_error() {
  local r; r="$(run_codex 'RPC_ERROR:auth required')"
  assert_not_match "codex cred err: sk-"    "sk-"    "$r"
  assert_not_match "codex cred err: api_key" "api_key" "$r"
}

test_opencode_go_no_creds_success() {
  local r; r="$(run_opencode_go 200 '{"usage":{"weekly":{"status":"ok","percent":30}}}')"
  assert_not_match "ocgo cred ok: sk-"    "sk-"    "$r"
  assert_not_match "ocgo cred ok: api_key" "api_key" "$r"
  assert_not_match "ocgo cred ok: Bearer"  "Bearer"  "$r"
}

test_opencode_go_no_creds_401() {
  local r; r="$(run_opencode_go 401 '{}')"
  assert_not_match "ocgo cred 401: sk-"    "sk-"    "$r"
  assert_not_match "ocgo cred 401: api_key" "api_key" "$r"
}

test_opencode_go_no_creds_500() {
  local r; r="$(run_opencode_go 500 'oops')"
  assert_not_match "ocgo cred 500: sk-"    "sk-"    "$r"
  assert_not_match "ocgo cred 500: api_key" "api_key" "$r"
}

# --- Main --------------------------------------------------------------------

check_deps

echo "Running bash usage helper tests..."
echo ""

test_codex_success_weekly
test_codex_success_no_resets
test_codex_unavailable
test_codex_malformed_json
test_codex_malformed_null
test_codex_malformed_empty
test_codex_malformed_bad_percent
test_codex_rpc_error
test_codex_rpc_auth_error
test_codex_clamp_high
test_codex_clamp_low

test_opencode_go_success
test_opencode_go_success_weekly_usage
test_opencode_go_unavailable_no_weekly
test_opencode_go_401
test_opencode_go_403
test_opencode_go_malformed_body
test_opencode_go_empty_body
test_opencode_go_curl_error
test_opencode_go_500
test_opencode_go_clamp_high
test_opencode_go_clamp_low

test_parity_identical_window
test_parity_unavailable
test_parity_clamping

test_codex_no_creds_success
test_codex_no_creds_error
test_opencode_go_no_creds_success
test_opencode_go_no_creds_401
test_opencode_go_no_creds_500

echo "Results: $PASS passed, $FAIL failed"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo "Failures:"
  for f in "${FAILURES[@]}"; do
    echo "  $f"
  done
  exit 1
fi

echo "All tests passed."
exit 0
