---
name: boss-setup
description: "Set up the Boss issue loop's user-level config by reading the provider discovery inventory, interviewing the user about tier placement, and writing MODEL-SELECTION.md and ORCHESTRATION.md. Use when running boss setup for the first time, reconfiguring providers, or adding new models."
---

# Boss Setup

You are the setup coordinator. Read the provider discovery inventory, interview
the user about tier placement for discovered models, and write a valid
user-level config.

## Prerequisites

The user must have at least one provider CLI installed (codex, opencode). The
discovery script (`scripts/discover-providers.ps1` or
`scripts/discover-providers.sh`) must have been run and its output available.

## Flow

### 1. Load the discovery inventory

Run the platform-appropriate discovery script and capture its JSON output. If
the script is unavailable or returns `status: unavailable`, report the problem
and stop — do not guess provider availability.

```
PowerShell:  .\skills\boss-issue-loop\scripts\discover-providers.ps1
Bash:        bash skills/boss-issue-loop/scripts/discover-providers.sh
```

Parse the inventory. For each provider in `providers`:
- If `status` is `unavailable`, note it and skip — do not offer it for tier
  assignment.
- If `status` is `error`, note the `warning` and skip — do not offer it.
- If `status` is `ok` but `authenticated` is `false`, note that the provider
  is present but not authenticated. Offer it for tier assignment but warn the
  user that it will not work until authenticated.

For each adapter in `adapters`, note its name and source.

### 2. Check for existing config

Before interviewing, check if a user-level config already exists:

- **Linux:** `~/.config/opencode/boss-issue-loop/`
- **macOS:** `~/Library/Application Support/opencode/boss-issue-loop/`
- **Windows:** `%APPDATA%\opencode\boss-issue-loop\`

If `MODEL-SELECTION.md` exists in the user config directory:
1. Read it and present its current tier assignments to the user.
2. Ask whether to overwrite or keep the existing config.
3. If the user chooses to keep it, stop — no changes are made.

### 3. Interview: tier placement

For each authenticated, available provider, present its discovered models and
ask the user to assign each to a tier:

- **Tier 1** — Single-file, well-specified tasks (lowest cost)
- **Tier 2** — Multi-file or multi-concept changes
- **Tier 3** — Focused multi-file work requiring deeper reasoning
- **Tier 4** — Cross-cutting, architecture-affecting work (highest cost)

Questions to ask per model:
1. Show the model ID and provider name.
2. Explain what each tier means (use the tier definitions from
   `MODEL-SELECTION.md`).
3. Ask: "Which tier should this model be placed in?"
4. If the user is unsure, suggest a tier based on the model's known capabilities
   and ask for confirmation.

For unauthenticated providers, ask: "This provider is present but not
authenticated. Should I include it in the config (it will show as unavailable
until authenticated)?"

### 4. Interview: adapter selection

Present the discovered adapters and ask the user to select one:

1. List each adapter with its name and source (packaged or user).
2. Explain: "The adapter determines how agents are launched and managed."
3. Default to `paseo` if the user has no preference.
4. Ask: "Which adapter should the Boss issue loop use?"

### 5. Write the user-level config

Create the config directory if it does not exist, then write two files:

#### `MODEL-SELECTION.md`

Write a valid `MODEL-SELECTION.md` following the section structure from the
packaged default. Include only the sections the user configured:

```markdown
# Model Selection

## Capability tiers

### Implementation tiers

- **Tier 1** — `{ provider: "<provider>", model: "<model-id>", effort: "low" }`
- **Tier 2** — `{ provider: "<provider>", model: "<model-id>", effort: "low" }`
...

### Review tiers

- **Tier 1** — `{ provider: "<provider>", model: "<model-id>", effort: "low" }`
...
```

Each model entry must use the exact provider name and model ID from the
discovery inventory. Never guess or substitute values.

#### `ORCHESTRATION.md`

Write a simple adapter directive:

```markdown
# Orchestration

adapter: <selected-adapter-name>
```

### 6. Confirm

After writing, present the full config to the user and ask for confirmation.
If the user wants changes, iterate on step 3-5.

## Degradation rules

- When the inventory reports `status: unavailable` for a provider, say so
  explicitly and do not offer it for tier assignment.
- When a provider is `status: ok` but `authenticated: false`, warn the user
  that the provider will not work until they authenticate.
- When no adapters are discovered, fall back to the packaged default (`paseo`)
  and note this to the user.
- Never guess a tier for a model the user did not explicitly assign.
- Never write a config value that was not provided by the user or the discovery
  inventory.

## Re-running setup

Re-running is safe:
1. Detect existing config and show it.
2. Confirm before overwriting.
3. If the user declines, stop without changes.
4. If the user confirms, proceed with the full interview flow.
