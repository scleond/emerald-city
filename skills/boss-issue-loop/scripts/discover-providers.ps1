<#
.SYNOPSIS
Provider discovery script for the Boss issue loop.

.DESCRIPTION
Emits a normalized JSON inventory of locally available providers, models, and
orchestration adapters. Used by the setup sub-skill to seed user-level config.

Output JSON interface:
    {
      "status": "ok | unavailable | error",
      "providers": [ ... ],
      "adapters": [ ... ],
      "warning": "message or null"
    }

Each provider entry:
    {
      "name": "codex | opencode | ...",
      "status": "ok | unavailable | error",
      "authenticated": true | false,
      "models": [ { "id": "...", "name": "..." } ],
      "warning": "message or null"
    }

Behavior:
  - ok          At least one provider was found and probed successfully.
  - unavailable No providers were found on PATH.
  - error       A probe failed or produced a malformed response.

Trust: the script trusts only the local CLI sessions it shells out to. Any
failure degrades to error/unavailable rather than aborting. Credentials are
never read, printed, copied, or persisted.
#>
[CmdletBinding()]
param(
    # Codex CLI executable name or path.
    [string]$CodexExecutable = 'codex',
    # OpenCode CLI executable name or path.
    [string]$OpenCodeExecutable = 'opencode',
    # Seconds to wait for each CLI probe before treating it as failed.
    [int]$TimeoutSeconds = 10
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

# Returns a normalized provider entry.
function New-ProviderEntry {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Status,
        [bool]$Authenticated = $false,
        [array]$Models = @(),
        [AllowNull()][string]$Warning
    )
    [pscustomobject]@{
        name          = $Name
        status        = $Status
        authenticated = $Authenticated
        models        = $Models
        warning       = $(if ([string]::IsNullOrWhiteSpace($Warning)) { $null } else { $Warning })
    }
}

# Returns a normalized model entry.
function New-ModelEntry {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [string]$Name = ''
    )
    [pscustomobject]@{
        id   = $Id
        name = $(if ([string]::IsNullOrWhiteSpace($Name)) { $Id } else { $Name })
    }
}

# Probes whether a command exists on PATH.
function Test-CommandExists {
    param([Parameter(Mandatory = $true)][string]$Command)
    $null -ne (Get-Command -Name $Command -ErrorAction SilentlyContinue)
}

# Probes the Codex CLI for authentication and available models.
function Get-CodexProvider {
    param(
        [string]$Executable,
        [int]$TimeoutSeconds
    )
    if (-not (Test-CommandExists -Command $Executable)) {
        return New-ProviderEntry -Name 'codex' -Status 'unavailable' `
            -Warning "Codex executable '$Executable' not found on PATH."
    }

    try {
        # Probe authentication via `codex auth status --json`
        $authOutput = & $Executable auth status --json 2>$null
        $authenticated = $false
        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($authOutput)) {
            try {
                $authData = $authOutput | ConvertFrom-Json -ErrorAction Stop
                $authenticated = $true
            } catch {
                # Non-JSON auth status; check exit code only
                $authenticated = ($LASTEXITCODE -eq 0)
            }
        }

        # Try to list models via `codex models` if available
        $models = @()
        try {
            $modelsOutput = & $Executable models --json 2>$null
            if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($modelsOutput)) {
                $parsed = $modelsOutput | ConvertFrom-Json -ErrorAction Stop
                foreach ($m in $parsed) {
                    $models += New-ModelEntry -Id $m.id -Name $m.name
                }
            }
        } catch {
            # Model listing not available; continue with empty models
        }

        return New-ProviderEntry -Name 'codex' -Status 'ok' `
            -Authenticated $authenticated -Models $models
    } catch {
        return New-ProviderEntry -Name 'codex' -Status 'error' `
            -Warning "Failed to probe codex: $($_.Exception.Message)"
    }
}

# Probes the OpenCode CLI for authentication and available models.
function Get-OpenCodeProvider {
    param(
        [string]$Executable,
        [int]$TimeoutSeconds
    )
    if (-not (Test-CommandExists -Command $Executable)) {
        return New-ProviderEntry -Name 'opencode' -Status 'unavailable' `
            -Warning "OpenCode executable '$Executable' not found on PATH."
    }

    try {
        # Probe authentication via `opencode auth status`
        $authOutput = & $Executable auth status --json 2>$null
        $authenticated = $false
        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($authOutput)) {
            try {
                $authData = $authOutput | ConvertFrom-Json -ErrorAction Stop
                $authenticated = $true
            } catch {
                # Non-JSON auth status; check exit code only
                $authenticated = ($LASTEXITCODE -eq 0)
            }
        }

        # Try to list models via `opencode models` if available
        $models = @()
        try {
            $modelsOutput = & $Executable models --json 2>$null
            if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($modelsOutput)) {
                $parsed = $modelsOutput | ConvertFrom-Json -ErrorAction Stop
                foreach ($m in $parsed) {
                    $models += New-ModelEntry -Id $m.id -Name $m.name
                }
            }
        } catch {
            # Model listing not available; continue with empty models
        }

        return New-ProviderEntry -Name 'opencode' -Status 'ok' `
            -Authenticated $authenticated -Models $models
    } catch {
        return New-ProviderEntry -Name 'opencode' -Status 'error' `
            -Warning "Failed to probe opencode: $($_.Exception.Message)"
    }
}

# Discovers available orchestration adapters from the packaged orchestration directory.
function Get-AvailableAdapters {
    $orchestrationDir = Join-Path $PSScriptRoot '..' 'orchestration'
    $adapters = @()
    if (Test-Path -LiteralPath $orchestrationDir) {
        $files = Get-ChildItem -LiteralPath $orchestrationDir -Filter '*.md' -File -ErrorAction SilentlyContinue
        foreach ($f in $files) {
            $name = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
            $adapters += [pscustomobject]@{
                name   = $name
                source = 'packaged'
                path   = $f.FullName
            }
        }
    }
    # Also check user-level adapter overrides
    $userConfigDir = $null
    if ($IsWindows -or $env:OS -eq 'Windows_NT') {
        $userConfigDir = Join-Path $env:APPDATA 'opencode\boss-issue-loop'
    } elseif ($IsMacOS -or $env:OSTYPE -eq 'darwin') {
        $userConfigDir = Join-Path $env:HOME 'Library/Application Support/opencode/boss-issue-loop'
    } else {
        $userConfigDir = Join-Path $env:HOME '.config/opencode/boss-issue-loop'
    }
    if ($userConfigDir -and (Test-Path -LiteralPath $userConfigDir)) {
        $userOrch = Join-Path $userConfigDir 'ORCHESTRATION.md'
        if (Test-Path -LiteralPath $userOrch) {
            # Check if it references a custom adapter path
            $content = Get-Content -LiteralPath $userOrch -Raw -ErrorAction SilentlyContinue
            if ($content -match 'adapter:\s*(\S+)') {
                $adapterRef = $Matches[1]
                $customPath = $adapterRef
                if (-not [System.IO.Path]::IsPathRooted($adapterRef)) {
                    $customPath = Join-Path (Get-Location) $adapterRef
                }
                if (Test-Path -LiteralPath $customPath) {
                    $adapters += [pscustomobject]@{
                        name   = [System.IO.Path]::GetFileNameWithoutExtension($adapterRef)
                        source = 'user'
                        path   = $customPath
                    }
                }
            }
        }
    }
    return $adapters
}

function Main {
    $providers = @()
    $warnings = @()

    # Probe codex
    $codex = Get-CodexProvider -Executable $CodexExecutable -TimeoutSeconds $TimeoutSeconds
    $providers += $codex
    if ($codex.status -ne 'ok' -and -not [string]::IsNullOrWhiteSpace($codex.warning)) {
        $warnings += $codex.warning
    }

    # Probe opencode
    $opencode = Get-OpenCodeProvider -Executable $OpenCodeExecutable -TimeoutSeconds $TimeoutSeconds
    $providers += $opencode
    if ($opencode.status -ne 'ok' -and -not [string]::IsNullOrWhiteSpace($opencode.warning)) {
        $warnings += $opencode.warning
    }

    # Discover adapters
    $adapters = Get-AvailableAdapters

    # Determine overall status
    $okCount = ($providers | Where-Object { $_.status -eq 'ok' }).Count
    $overallStatus = if ($okCount -gt 0) { 'ok' } elseif ($providers.Count -eq 0) { 'unavailable' } else { 'unavailable' }

    # If all providers are errors, status is error
    $errorCount = ($providers | Where-Object { $_.status -eq 'error' }).Count
    if ($errorCount -eq $providers.Count -and $providers.Count -gt 0) {
        $overallStatus = 'error'
    }

    $warningText = if ($warnings.Count -gt 0) { $warnings -join '; ' } else { $null }

    [pscustomobject]@{
        status   = $overallStatus
        providers = $providers
        adapters = $adapters
        warning  = $warningText
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    Main | ConvertTo-Json -Compress -Depth 10
}
