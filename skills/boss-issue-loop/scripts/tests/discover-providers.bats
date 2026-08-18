#!/usr/bin/env bats
#
# Deterministic tests for discover-providers.sh.
# Mirrors the four fixture classes (success, unavailable, malformed, command-failure)
# plus credential-leak assertions.
#
# Requires: bats-core (https://bats-core.info), jq.
# Run:  bats skills/boss-issue-loop/scripts/tests/discover-providers.bats

SCRIPT_DIR="$(cd "$(dirname "${BATS_TEST_FILENAME}")" && pwd)"
SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DISCOVERY_SCRIPT="$SCRIPTS_DIR/discover-providers.sh"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Run the discovery script with mocked codex and opencode.
#   run_discovery <codex_exists> <codex_auth_ok> <codex_models_json> \
#                 <opencode_exists> <opencode_auth_ok> <opencode_models_json>
run_discovery() {
  local codex_exists="$1" codex_auth_ok="$2" codex_models="$3"
  local opencode_exists="$4" opencode_auth_ok="$5" opencode_models="$6"

  (
    export CODEX_EXECUTABLE="mock-codex"
    export OPENCODE_EXECUTABLE="mock-opencode"
    export DISCOVERY_TIMEOUT_SECONDS="5"

    # Override command existence checks
    command() {
      local cmd="$2"
      case "$cmd" in
        mock-codex)
          if [[ "$codex_exists" == "true" ]]; then return 0; else return 1; fi
          ;;
        mock-opencode)
          if [[ "$opencode_exists" == "true" ]]; then return 0; else return 1; fi
          ;;
        jq)
          # Always available
          return 0
          ;;
        *)
          # Fall through to real command for others
          builtin command "$@"
          ;;
      esac
    }
    export -f command

    # Mock codex commands
    mock-codex() {
      local subcmd="${1:-}"
      case "$subcmd" in
        models)
          echo "$codex_models"
          return 0
          ;;
        auth)
          if [[ "$codex_auth_ok" == "true" ]]; then
            echo '{"status":"authenticated"}'
            return 0
          else
            return 1
          fi
          ;;
        *)
          return 0
          ;;
      esac
    }
    export -f mock-codex

    # Mock opencode commands
    mock-opencode() {
      local subcmd="${1:-}"
      case "$subcmd" in
        models)
          echo "$opencode_models"
          return 0
          ;;
        auth)
          if [[ "$opencode_auth_ok" == "true" ]]; then
            echo '{"status":"authenticated"}'
            return 0
          else
            return 1
          fi
          ;;
        *)
          return 0
          ;;
      esac
    }
    export -f mock-opencode

    source "$DISCOVERY_SCRIPT"
    main
  ) 2>/dev/null
}

# Extract a JSON field from a string.
jq_field() { jq -r "$1" <<<"$2"; }

# ---------------------------------------------------------------------------
# Dependency checks
# ---------------------------------------------------------------------------

@test "declared dependencies are available" {
  command -v jq >/dev/null 2>&1 || skip "jq not installed"
}

# ===========================================================================
# Success fixtures
# ===========================================================================

@test "success: both providers found and authenticated" {
  result="$(run_discovery true true '{"models":[{"id":"gpt-5.6-luna","name":"GPT-5.6 Luna"}]}' \
                         true true '{"models":[{"id":"mimo-v2.5","name":"Mimo v2.5"}]}')"
  [ "$(jq_field '.status' "$result")" = "ok" ]

  codex_status="$(jq_field '.providers[0].status' "$result")"
  opencode_status="$(jq_field '.providers[1].status' "$result")"
  [ "$codex_status" = "ok" ]
  [ "$opencode_status" = "ok" ]

  codex_auth="$(jq_field '.providers[0].authenticated' "$result")"
  opencode_auth="$(jq_field '.providers[1].authenticated' "$result")"
  [ "$codex_auth" = "true" ]
  [ "$opencode_auth" = "true" ]
}

@test "success: providers with models" {
  result="$(run_discovery true true '{"models":[{"id":"gpt-5.6-luna","name":"GPT-5.6 Luna"},{"id":"gpt-5.6-sol","name":"GPT-5.6 Sol"}]}' \
                         true true '{"models":[{"id":"mimo-v2.5","name":"Mimo v2.5"}]}')"
  [ "$(jq_field '.status' "$result")" = "ok" ]

  codex_model_count="$(jq '.providers[0].models | length' <<<"$result")"
  opencode_model_count="$(jq '.providers[1].models | length' <<<"$result")"
  [ "$codex_model_count" = "2" ]
  [ "$opencode_model_count" = "1" ]

  first_model_id="$(jq_field '.providers[0].models[0].id' "$result")"
  [ "$first_model_id" = "gpt-5.6-luna" ]
}

@test "success: providers without models" {
  result="$(run_discovery true true '{}' true true '{}')"
  [ "$(jq_field '.status' "$result")" = "ok" ]

  codex_model_count="$(jq '.providers[0].models | length' <<<"$result")"
  [ "$codex_model_count" = "0" ]
}

@test "success: one authenticated, one not" {
  result="$(run_discovery true true '{}' true false '{}')"
  [ "$(jq_field '.status' "$result")" = "ok" ]

  codex_auth="$(jq_field '.providers[0].authenticated' "$result")"
  opencode_auth="$(jq_field '.providers[1].authenticated' "$result")"
  [ "$codex_auth" = "true" ]
  [ "$opencode_auth" = "false" ]
}

# ===========================================================================
# Unavailable fixtures
# ===========================================================================

@test "unavailable: neither provider found on PATH" {
  result="$(run_discovery false false '{}' false false '{}')"
  [ "$(jq_field '.status' "$result")" = "unavailable" ]

  codex_status="$(jq_field '.providers[0].status' "$result")"
  opencode_status="$(jq_field '.providers[1].status' "$result")"
  [ "$codex_status" = "unavailable" ]
  [ "$opencode_status" = "unavailable" ]

  codex_warning="$(jq_field '.providers[0].warning' "$result")"
  [[ "$codex_warning" == *"not found on PATH"* ]]
}

@test "unavailable: only codex found" {
  result="$(run_discovery true true '{}' false false '{}')"
  [ "$(jq_field '.status' "$result")" = "ok" ]

  opencode_status="$(jq_field '.providers[1].status' "$result")"
  [ "$opencode_status" = "unavailable" ]
}

@test "unavailable: only opencode found" {
  result="$(run_discovery false false '{}' true true '{}')"
  [ "$(jq_field '.status' "$result")" = "ok" ]

  codex_status="$(jq_field '.providers[0].status' "$result")"
  [ "$codex_status" = "unavailable" ]
}

# ===========================================================================
# Malformed-response fixtures
# ===========================================================================

@test "malformed: codex models returns invalid JSON" {
  result="$(run_discovery true true '{not json' true true '{}')"
  [ "$(jq_field '.status' "$result")" = "ok" ]

  codex_model_count="$(jq '.providers[0].models | length' <<<"$result")"
  [ "$codex_model_count" = "0" ]
}

@test "malformed: opencode models returns invalid JSON" {
  result="$(run_discovery true true '{}' true true '{not json')"
  [ "$(jq_field '.status' "$result")" = "ok" ]

  opencode_model_count="$(jq '.providers[1].models | length' <<<"$result")"
  [ "$opencode_model_count" = "0" ]
}

# ===========================================================================
# Command-failure fixtures
# ===========================================================================

@test "command failure: codex auth fails" {
  result="$(run_discovery true false '{}' true true '{}')"
  [ "$(jq_field '.status' "$result")" = "ok" ]

  codex_auth="$(jq_field '.providers[0].authenticated' "$result")"
  [ "$codex_auth" = "false" ]
}

@test "command failure: opencode auth fails" {
  result="$(run_discovery true true '{}' true false '{}')"
  [ "$(jq_field '.status' "$result")" = "ok" ]

  opencode_auth="$(jq_field '.providers[1].authenticated' "$result")"
  [ "$opencode_auth" = "false" ]
}

# ===========================================================================
# Adapter discovery
# ===========================================================================

@test "adapters: discovers packaged adapters" {
  result="$(run_discovery true true '{}' true true '{}')"
  adapter_count="$(jq '.adapters | length' <<<"$result")"
  [ "$adapter_count" -ge 1 ]

  # Should find at least paseo and herdr
  paseo_found="$(jq '.adapters | map(.name) | index("paseo") // -1' <<<"$result")"
  herdr_found="$(jq '.adapters | map(.name) | index("herdr") // -1' <<<"$result")"
  [ "$paseo_found" != "-1" ]
  [ "$herdr_found" != "-1" ]
}

@test "adapters: each adapter has required fields" {
  result="$(run_discovery true true '{}' true true '{}')"
  for i in $(seq 0 $(jq '.adapters | length - 1' <<<"$result")); do
    name="$(jq -r ".adapters[$i].name" <<<"$result")"
    source="$(jq -r ".adapters[$i].source" <<<"$result")"
    path="$(jq -r ".adapters[$i].path" <<<"$result")"
    [ -n "$name" ]
    [ "$source" = "packaged" ]
    [ -n "$path" ]
  done
}

# ===========================================================================
# JSON output shape
# ===========================================================================

@test "JSON shape: valid JSON with all required fields" {
  result="$(run_discovery true true '{}' true true '{}')"
  # Should parse without error
  echo "$result" | jq -e '.status' >/dev/null 2>&1
  echo "$result" | jq -e '.providers' >/dev/null 2>&1
  echo "$result" | jq -e '.adapters' >/dev/null 2>&1
  echo "$result" | jq -e '.warning' >/dev/null 2>&1
}

@test "JSON shape: each provider has required fields" {
  result="$(run_discovery true true '{}' true true '{}')"
  for i in $(seq 0 $(jq '.providers | length - 1' <<<"$result")); do
    echo "$result" | jq -e ".providers[$i].name" >/dev/null 2>&1
    echo "$result" | jq -e ".providers[$i].status" >/dev/null 2>&1
    echo "$result" | jq -e ".providers[$i].authenticated" >/dev/null 2>&1
    echo "$result" | jq -e ".providers[$i].models" >/dev/null 2>&1
    echo "$result" | jq -e ".providers[$i].warning" >/dev/null 2>&1
  done
}

# ===========================================================================
# Credential leak assertions
# ===========================================================================

@test "no credential in output on success" {
  result="$(run_discovery true true '{}' true true '{}')"
  [[ "$result" != *"sk-"* ]]
  [[ "$result" != *"api_key"* ]]
  [[ "$result" != *"API_KEY"* ]]
  [[ "$result" != *"token"* ]]
  [[ "$result" != *"Bearer"* ]]
}

@test "no credential in output on unavailable" {
  result="$(run_discovery false false '{}' false false '{}')"
  [[ "$result" != *"sk-"* ]]
  [[ "$result" != *"api_key"* ]]
  [[ "$result" != *"API_KEY"* ]]
}
