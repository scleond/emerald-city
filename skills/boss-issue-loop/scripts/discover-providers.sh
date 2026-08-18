#!/usr/bin/env bash
#
# discover-providers.sh - Provider discovery script for the Boss issue loop.
#
# Emits a normalized JSON inventory of locally available providers, models, and
# orchestration adapters. Used by the setup sub-skill to seed user-level config.
#
# Output JSON interface:
#   {"status":"ok|unavailable|error",
#    "providers":[{"name":"codex","status":"ok","authenticated":true,
#                  "models":[{"id":"gpt-5.6-luna","name":"gpt-5.6-luna"}],
#                  "warning":null}, ...],
#    "adapters":[{"name":"paseo","source":"packaged","path":"..."}],
#    "warning":"..."}
#
# Trust: the script trusts only the local CLI sessions it shells out to. Any
# failure degrades to error/unavailable rather than aborting. Credentials are
# never read, printed, copied, or persisted.
#
# Env overrides: CODEX_EXECUTABLE, OPENCODE_EXECUTABLE,
#                DISCOVERY_TIMEOUT_SECONDS

set -euo pipefail

CODEX="${CODEX_EXECUTABLE:-codex}"
OPENCODE="${OPENCODE_EXECUTABLE:-opencode}"
TIMEOUT="${DISCOVERY_TIMEOUT_SECONDS:-10}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Emit a normalized provider entry.
emit_provider() {
  local name="$1" status="$2" authenticated="$3" models="$4" warning="${5:-}"
  jq -n \
    --arg name "$name" \
    --arg status "$status" \
    --argjson authenticated "$authenticated" \
    --argjson models "$models" \
    --arg warning "$warning" \
    '{ name: $name,
       status: $status,
       authenticated: $authenticated,
       models: $models,
       warning: (if $warning == "" then null else $warning end) }'
}

# Emit a model entry.
emit_model() {
  local id="$1" name="${2:-}"
  if [[ -z "$name" ]]; then name="$id"; fi
  jq -n --arg id "$id" --arg name "$name" '{ id: $id, name: $name }'
}

# Emit the final inventory.
emit_inventory() {
  local status="$1" providers="$2" adapters="$3" warning="${4:-}"
  jq -n \
    --arg status "$status" \
    --argjson providers "$providers" \
    --argjson adapters "$adapters" \
    --arg warning "$warning" \
    '{ status: $status,
       providers: $providers,
       adapters: $adapters,
       warning: (if $warning == "" then null else $warning end) }'
}

# Probe codex for authentication and available models.
probe_codex() {
  local cmd="$1" timeout="$2"

  if ! command -v "$cmd" >/dev/null 2>&1; then
    emit_provider "codex" "unavailable" "false" "[]" \
      "Codex executable '$cmd' not found on PATH."
    return
  fi

  # Probe authentication via app-server --stdio initialize handshake
  local authenticated="false"
  local models_json="[]"

  # Try to list models via `codex models --json`
  local models_output
  if models_output=$("$cmd" models --json 2>/dev/null); then
    if [[ -n "$models_output" ]] && jq -e '.' <<<"$models_output" >/dev/null 2>&1; then
      models_json="$(jq -c '[.[] | { id: .id, name: (.name // .id) }]' <<<"$models_output" 2>/dev/null || echo "[]")"
    fi
  fi

  # Probe authentication: try a simple command that requires auth
  local auth_output
  if auth_output=$("$cmd" auth status --json 2>/dev/null); then
    if [[ -n "$auth_output" ]]; then
      authenticated="true"
    fi
  elif "$cmd" auth status >/dev/null 2>&1; then
    authenticated="true"
  fi

  emit_provider "codex" "ok" "$authenticated" "$models_json" ""
}

# Probe opencode for authentication and available models.
probe_opencode() {
  local cmd="$1" timeout="$2"

  if ! command -v "$cmd" >/dev/null 2>&1; then
    emit_provider "opencode" "unavailable" "false" "[]" \
      "OpenCode executable '$cmd' not found on PATH."
    return
  fi

  local authenticated="false"
  local models_json="[]"

  # Try to list models via `opencode models --json`
  local models_output
  if models_output=$("$cmd" models --json 2>/dev/null); then
    if [[ -n "$models_output" ]] && jq -e '.' <<<"$models_output" >/dev/null 2>&1; then
      models_json="$(jq -c '[.[] | { id: .id, name: (.name // .id) }]' <<<"$models_output" 2>/dev/null || echo "[]")"
    fi
  fi

  # Probe authentication
  local auth_output
  if auth_output=$("$cmd" auth status --json 2>/dev/null); then
    if [[ -n "$auth_output" ]]; then
      authenticated="true"
    fi
  elif "$cmd" auth status >/dev/null 2>&1; then
    authenticated="true"
  fi

  emit_provider "opencode" "ok" "$authenticated" "$models_json" ""
}

# Discover available orchestration adapters.
discover_adapters() {
  local adapters="[]"
  local orch_dir="$SCRIPT_DIR/../orchestration"

  if [[ -d "$orch_dir" ]]; then
    for f in "$orch_dir"/*.md; do
      [[ -f "$f" ]] || continue
      local name
      name="$(basename "$f" .md)"
      adapters="$(jq -c --arg n "$name" --arg p "$f" \
        '. + [{ name: $n, source: "packaged", path: $p }]' <<<"$adapters")"
    done
  fi

  # Check user-level adapter overrides
  local user_config_dir=""
  case "$(uname -s)" in
    Darwin) user_config_dir="$HOME/Library/Application Support/opencode/boss-issue-loop" ;;
    MINGW*|MSYS*|CYGWIN*) user_config_dir="${APPDATA:-}/opencode/boss-issue-loop" ;;
    *) user_config_dir="$HOME/.config/opencode/boss-issue-loop" ;;
  esac

  if [[ -n "$user_config_dir" && -d "$user_config_dir" ]]; then
    local user_orch="$user_config_dir/ORCHESTRATION.md"
    if [[ -f "$user_orch" ]]; then
      local adapter_ref
      adapter_ref="$(grep -oP 'adapter:\s*\K\S+' "$user_orch" 2>/dev/null || true)"
      if [[ -n "$adapter_ref" ]]; then
        local custom_path="$adapter_ref"
        if [[ ! "$custom_path" = /* ]]; then
          custom_path="$(pwd)/$adapter_ref"
        fi
        if [[ -f "$custom_path" ]]; then
          local adapter_name
          adapter_name="$(basename "$adapter_ref" .md)"
          adapters="$(jq -c --arg n "$adapter_name" --arg p "$custom_path" \
            '. + [{ name: $n, source: "user", path: $p }]' <<<"$adapters")"
        fi
      fi
    fi
  fi

  echo "$adapters"
}

main() {
  command -v jq >/dev/null 2>&1 || {
    emit_inventory "error" "[]" "[]" "jq is required but not installed."
    return 0
  }

  local providers="[]"
  local warnings=()

  # Probe codex
  local codex_result
  codex_result="$(probe_codex "$CODEX" "$TIMEOUT")"
  providers="$(jq -c --argjson p "$codex_result" '. + [$p]' <<<"$providers")"
  local codex_warning
  codex_warning="$(jq -r '.warning // empty' <<<"$codex_result")"
  if [[ -n "$codex_warning" ]]; then
    warnings+=("$codex_warning")
  fi

  # Probe opencode
  local opencode_result
  opencode_result="$(probe_opencode "$OPENCODE" "$TIMEOUT")"
  providers="$(jq -c --argjson p "$opencode_result" '. + [$p]' <<<"$providers")"
  local opencode_warning
  opencode_warning="$(jq -r '.warning // empty' <<<"$opencode_result")"
  if [[ -n "$opencode_warning" ]]; then
    warnings+=("$opencode_warning")
  fi

  # Discover adapters
  local adapters
  adapters="$(discover_adapters)"

  # Determine overall status
  local ok_count error_count
  ok_count="$(jq '[.[] | select(.status == "ok")] | length' <<<"$providers")"
  error_count="$(jq '[.[] | select(.status == "error")] | length' <<<"$providers")"
  local provider_count
  provider_count="$(jq 'length' <<<"$providers")"

  local overall_status="unavailable"
  if [[ "$ok_count" -gt 0 ]]; then
    overall_status="ok"
  elif [[ "$provider_count" -gt 0 && "$error_count" -eq "$provider_count" ]]; then
    overall_status="error"
  fi

  local warning_text=""
  if [[ ${#warnings[@]} -gt 0 ]]; then
    warning_text="$(IFS='; '; echo "${warnings[*]}")"
  fi

  emit_inventory "$overall_status" "$providers" "$adapters" "$warning_text"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main
fi
