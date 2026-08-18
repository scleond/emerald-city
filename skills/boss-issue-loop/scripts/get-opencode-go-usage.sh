#!/usr/bin/env bash
#
# get-opencode-go-usage.sh - Normalized weekly usage helper for the OpenCode Go
# provider used by the Boss issue loop.
#
# Queries the official OpenCode Go usage endpoint
# (https://opencode.ai/zen/go/v1/usage, upstream anomalyco/opencode#16513) with
# the logged-in OpenCode Go API key and normalizes the weekly window. The key is
# sourced from the OpenCode auth store, or from OPENCODE_GO_API_KEY, and used
# only in the Authorization header - never printed, logged, or persisted.
#
# Emits the normalized usage JSON interface:
#
#   {"provider":"opencode-go","status":"ok|unavailable|error",
#    "weeklyRemainingPercent":72,"resetsAt":"ISO-8601|null",
#    "source":"...","warning":"..."}
#
# Does NOT use `opencode stats` local session history and does NOT scrape the
# web console or browser cookies.
#
# Requires: curl, jq, awk.
#
# Env overrides: OPENCODE_GO_ENDPOINT, OPENCODE_GO_USAGE_TIMEOUT,
#                OPENCODE_GO_API_KEY, OPENCODE_GO_AUTH_STORE_PATH

set -euo pipefail

ENDPOINT="${OPENCODE_GO_ENDPOINT:-https://opencode.ai/zen/go/v1/usage}"
TIMEOUT="${OPENCODE_GO_USAGE_TIMEOUT:-20}"
SOURCE="opencode-go:/zen/go/v1/usage"

emit() {
  local provider="$1" status="$2" pct="${3:-null}" resets="${4:-}" source="${5:-}" warning="${6:-}"
  jq -n \
    --arg provider "$provider" \
    --arg status "$status" \
    --argjson weeklyRemainingPercent "$pct" \
    --arg resetsAt "$resets" \
    --arg source "$source" \
    --arg warning "$warning" \
    '{ provider: $provider,
       status: $status,
       weeklyRemainingPercent: $weeklyRemainingPercent,
       resetsAt: (if $resetsAt == "" then null else $resetsAt end),
       source: (if $source == "" then null else $source end),
       warning: (if $warning == "" then null else $warning end) }'
}

fail_no_jq() {
  printf '%s\n' '{"provider":"opencode-go","status":"error","weeklyRemainingPercent":null,"resetsAt":null,"source":null,"warning":"jq is required but not installed."}'
  exit 0
}

fail_no_curl() {
  printf '%s\n' '{"provider":"opencode-go","status":"error","weeklyRemainingPercent":null,"resetsAt":null,"source":null,"warning":"curl is required but not installed."}'
  exit 0
}

resolve_api_key() {
  local key="${OPENCODE_GO_API_KEY:-}"
  if [[ -z "$key" ]]; then
    local auth_path="${OPENCODE_GO_AUTH_STORE_PATH:-}"
    if [[ -z "$auth_path" ]]; then
      if [[ -n "${HOME:-}" && -f "$HOME/.local/share/opencode/auth.json" ]]; then
        auth_path="$HOME/.local/share/opencode/auth.json"
      elif [[ -f "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/auth.json" ]]; then
        auth_path="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/auth.json"
      else
        auth_path="$HOME/.config/opencode/auth.json"
      fi
    fi
    if [[ -f "$auth_path" ]]; then
      key="$(jq -r '."opencode-go".key // empty' "$auth_path" 2>/dev/null || true)"
    fi
  fi
  echo "$key"
}

fetch_opencode_go_usage() {
  local key="$1"
  local body_file="$2"

  local http_code
  http_code="$(curl -sS -m "$TIMEOUT" \
    -H "Authorization: Bearer $key" \
    -o "$body_file" -w '%{http_code}' "$ENDPOINT" 2>/dev/null || true)"

  if [[ -z "$http_code" ]]; then
    return
  fi
  if [[ "$http_code" == "401" || "$http_code" == "403" || "$http_code" != "200" ]]; then
    echo "HTTP_$http_code"
    return
  fi

  cat "$body_file"
}

normalize_opencode_go_response() {
  local result="$1"

  if [[ -z "$result" ]]; then
    emit opencode-go error null "" "$SOURCE" "Empty response from the OpenCode Go usage endpoint."
    return
  fi
  if [[ "$result" == HTTP_* ]]; then
    local code="${result#HTTP_}"
    if [[ "$code" == "401" || "$code" == "403" ]]; then
      emit opencode-go unavailable null "" "$SOURCE" "OpenCode Go returned HTTP $code; the API key is invalid or has no Go subscription."
    else
      emit opencode-go error null "" "$SOURCE" "OpenCode Go usage endpoint returned unexpected HTTP $code."
    fi
    return
  fi

  if ! jq -e '.' <<<"$result" >/dev/null 2>&1; then
    emit opencode-go error null "" "$SOURCE" "OpenCode Go usage endpoint returned malformed JSON."
    return
  fi

  local has_weekly
  has_weekly="$(jq -r 'has("usage") and (.usage | has("weekly")) or has("weeklyUsage")' <<<"$result" 2>/dev/null || echo "false")"

  local percent resets_raw
  percent="$(jq -r '.usage.weekly.percent // .usage.weekly.usagePercent // .weeklyUsage.percent // .weeklyUsage.usagePercent // empty' <<<"$result" 2>/dev/null || true)"
  resets_raw="$(jq -r '.usage.weekly.resetsAt // .weeklyUsage.resetsAt // empty' <<<"$result" 2>/dev/null || true)"

  if [[ "$has_weekly" != "true" ]]; then
    emit opencode-go unavailable null "" "$SOURCE" "No weekly usage window was available in the OpenCode Go response."
    return
  fi

  if [[ -z "$percent" ]] || ! [[ "$percent" =~ ^-?[0-9]+$ ]]; then
    emit opencode-go error null "" "$SOURCE" "OpenCode Go weekly window was present but the usage-percent value was unusable."
    return
  fi

  local remaining
  remaining="$(awk -v u="$percent" 'BEGIN { r = 100 - u; if (r < 0) r = 0; if (r > 100) r = 100; printf "%d", r }')"

  local resets_at=""
  if [[ -n "$resets_raw" ]]; then
    if date -d "$resets_raw" >/dev/null 2>&1; then
      resets_at="$(date -u -d "$resets_raw" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)"
    fi
  fi

  emit opencode-go ok "$remaining" "$resets_at" "$SOURCE" ""
}

main() {
  command -v jq >/dev/null 2>&1 || fail_no_jq
  command -v curl >/dev/null 2>&1 || fail_no_curl

  local key
  key="$(resolve_api_key)"

  if [[ -z "$key" ]]; then
    emit opencode-go unavailable null "" "" "No OpenCode Go API key found; run 'opencode auth login' or set OPENCODE_GO_API_KEY."
    return
  fi

  local body_file
  body_file="$(mktemp)"
  trap 'rm -f "$body_file"' RETURN

  local result
  result="$(fetch_opencode_go_usage "$key" "$body_file")"
  normalize_opencode_go_response "$result"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main
fi
