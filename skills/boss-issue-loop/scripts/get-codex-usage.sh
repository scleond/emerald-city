#!/usr/bin/env bash
#
# get-codex-usage.sh - Normalized weekly usage helper for the Codex provider
# used by the Boss issue loop.
#
# Spawns `codex app-server --stdio` and speaks newline-delimited JSON-RPC over
# stdio (initialize -> initialized -> account/rateLimits/read), then selects the
# weekly rate-limit window and emits the normalized usage JSON interface:
#
#   {"provider":"codex","status":"ok|unavailable|error",
#    "weeklyRemainingPercent":72,"resetsAt":"ISO-8601|null",
#    "source":"...","warning":"..."}
#
# Credentials live in the logged-in Codex session handled by the app-server; the
# script never reads, prints, copies, or persists access tokens, and never
# requests a login. The interactive /usage screen is intentionally not automated.
#
# Requires: codex, jq, date (GNU coreutils), awk.
#
# Env overrides: CODEX_EXECUTABLE, CODEX_RATE_LIMITS_METHOD,
#                CODEX_USAGE_TIMEOUT, CODEX_WEEKLY_WINDOW_MINUTES

set -euo pipefail

CODEX="${CODEX_EXECUTABLE:-codex}"
METHOD="${CODEX_RATE_LIMITS_METHOD:-account/rateLimits/read}"
TIMEOUT="${CODEX_USAGE_TIMEOUT:-20}"
WEEKLY_MINUTES="${CODEX_WEEKLY_WINDOW_MINUTES:-10080}"
SOURCE="codex:$METHOD"

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

fail_without_jq() {
  printf '%s\n' '{"provider":"codex","status":"error","weeklyRemainingPercent":null,"resetsAt":null,"source":null,"warning":"jq is required but not installed."}'
  exit 0
}

fetch_codex_rpc() {
  coproc CODEX_CP { "$CODEX" app-server --stdio 2>/dev/null; }

  local request_id=2
  {
    printf '%s\n' '{"method":"initialize","id":1,"params":{"clientInfo":{"name":"boss-issue-loop","title":"Boss Issue Loop","version":"1.0"}}}'
    printf '%s\n' '{"method":"initialized"}'
    printf '%s\n' "{\"method\":\"$METHOD\",\"id\":$request_id}"
  } >&"${CODEX_CP[1]}"

  local result=""
  while IFS= read -r -t "$TIMEOUT" -u "${CODEX_CP[0]}" line; do
    local id
    id="$(jq -r '.id // empty' <<<"$line" 2>/dev/null || true)"
    if [[ -n "$id" && "$id" == "$request_id" ]]; then
      local err
      err="$(jq -r '.error.message // empty' <<<"$line" 2>/dev/null || true)"
      if [[ -n "$err" ]]; then
        result="RPC_ERROR:$err"
      else
        result="$(jq -c '.result // empty' <<<"$line" 2>/dev/null || true)"
      fi
      break
    fi
  done

  kill "$CODEX_CP_PID" 2>/dev/null || true
  wait "$CODEX_CP_PID" 2>/dev/null || true

  echo "$result"
}

normalize_codex_response() {
  local result="$1"

  if [[ -z "$result" ]]; then
    emit codex error null "" "$SOURCE" "Failed to read codex rate limits: no response within ${TIMEOUT}s."
    return
  fi
  if [[ "$result" == RPC_ERROR:* ]]; then
    emit codex error null "" "$SOURCE" "Codex '$METHOD' RPC error: ${result#RPC_ERROR:}"
    return
  fi
  if [[ "$result" == "null" ]]; then
    emit codex error null "" "$SOURCE" "Codex '$METHOD' returned an empty result."
    return
  fi

  local window
  window="$(jq -c --argjson wmin "$WEEKLY_MINUTES" '
    def windows:
      ([.rateLimits.primary, .rateLimits.secondary]
        + [ ((.rateLimitsByLimitId // {}) | to_entries[] | .value.primary, .value.secondary) ])
      | map(select(type == "object"));
    windows | map(select(has("usedPercent") and .windowDurationMins == $wmin))[0] // null
  ' <<<"$result")"

  if [[ -z "$window" || "$window" == "null" ]]; then
    emit codex unavailable null "" "$SOURCE" "No weekly rate-limit window was available in the codex response."
    return
  fi

  local used
  used="$(jq -r '.usedPercent // empty' <<<"$window")"
  if [[ -z "$used" ]] || ! [[ "$used" =~ ^-?[0-9]+$ ]]; then
    emit codex error null "" "$SOURCE" "Weekly rate-limit window was present but the used-percent value was unusable."
    return
  fi

  local remaining
  remaining="$(awk -v u="$used" 'BEGIN { r = 100 - u; if (r < 0) r = 0; if (r > 100) r = 100; printf "%d", r }')"

  local resets_at="" resets_sec
  resets_sec="$(jq -r '.resetsAt // empty' <<<"$window")"
  if [[ -n "$resets_sec" ]] && [[ "$resets_sec" =~ ^[0-9]+$ ]]; then
    resets_at="$(date -u -d "@$resets_sec" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)"
  fi

  emit codex ok "$remaining" "$resets_at" "$SOURCE" ""
}

main() {
  command -v jq >/dev/null 2>&1 || fail_without_jq

  if ! command -v "$CODEX" >/dev/null 2>&1; then
    emit codex error null "" "" "Codex executable '$CODEX' not found on PATH."
    return
  fi

  local result
  result="$(fetch_codex_rpc)"
  normalize_codex_response "$result"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main
fi
