<#
.SYNOPSIS
Normalized weekly usage helper for the OpenCode Go provider used by the Boss
issue loop.

.DESCRIPTION
Queries the official OpenCode Go usage endpoint
(`https://opencode.ai/zen/go/v1/usage`, upstream anomalyco/opencode#16513)
with the logged-in OpenCode Go API key and emits the normalized usage JSON
interface consumed by model selection. The API key is sourced from the OpenCode
auth store (`~/.local/share/opencode/auth.json`), or from `OPENCODE_GO_API_KEY`
/ `-ApiKey`, and is used only in memory for the Bearer header - it is never
printed, logged, or persisted.

The endpoint reports server-side plan usage for the rolling, weekly, and monthly
windows (`usagePercent` + `resetInSec`). This helper normalizes the weekly
window. It intentionally does NOT use `opencode stats` local session history,
and does NOT scrape the web console or browser cookies.

Output JSON interface:
    {
      "provider": "opencode-go",
      "status": "ok | unavailable | error",
      "weeklyRemainingPercent": 72,           // or null
      "resetsAt": "ISO-8601 or null",
      "source": "provider-specific source or null",
      "warning": "message or null"
    }

Behavior:
  - ok          The weekly window was returned and normalized.
  - unavailable No API key was found, or the key/subscription is not valid
                (401 / 403). A useful warning is set.
  - error       The request failed at the transport level or the response was
                malformed.

Trust: the script trusts only the official endpoint and the user's own key. Any
failure degrades to error/unavailable rather than aborting the issue loop.
#>
[CmdletBinding()]
param(
    # Official OpenCode Go usage endpoint.
    [string]$Endpoint = 'https://opencode.ai/zen/go/v1/usage',
    # Seconds to wait for the endpoint before treating the call as failed.
    [int]$TimeoutSeconds = 20,
    # Optional explicit API key. Takes precedence over the environment variable
    # and the auth store. Never echoed.
    [string]$ApiKey,
    # Path to the OpenCode auth store. Defaults to the detected store location.
    [string]$AuthStorePath
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

# Marks how many whole percent points of the weekly allowance remain.
# Clamped to [0, 100]; returns $null when the input is not a number.
function ConvertTo-RemainingPercent {
    param([AllowNull()][object]$UsedPercent)
    if ($null -eq $UsedPercent) { return $null }
    try {
        $used = [int]$UsedPercent
    } catch {
        return $null
    }
    $remaining = 100 - $used
    return [Math]::Min(100, [Math]::Max(0, $remaining))
}

# Converts a Unix seconds timestamp to an ISO-8601 UTC string, or $null.
function ConvertTo-Iso8601 {
    param([AllowNull()][object]$UnixSeconds)
    if ($null -eq $UnixSeconds) { return $null }
    try {
        $epoch = [DateTimeOffset]::FromUnixTimeSeconds([long]$UnixSeconds)
        return $epoch.UtcDateTime.ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
    } catch {
        return $null
    }
}

# Converts a value that is either an ISO-8601 string or a Unix-seconds number to
# an ISO-8601 UTC string. Returns $null when it cannot be parsed.
function ConvertTo-ResetTimestamp {
    param([AllowNull()][object]$Value)
    if ($null -eq $Value) { return $null }
    if ($Value -is [string] -and $Value -match '^\d+$') {
        return ConvertTo-Iso8601 -UnixSeconds ([long]$Value)
    }
    try {
        $parsed = [DateTime]::Parse($Value, [System.Globalization.CultureInfo]::InvariantCulture,
            [System.Globalization.DateTimeStyles]::AssumeUniversal).ToUniversalTime()
        return $parsed.ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
    } catch {
        return $null
    }
}

# Returns the normalized usage object for a given state.
function New-NormalizedUsage {
    param(
        [Parameter(Mandatory = $true)][string]$Provider,
        [Parameter(Mandatory = $true)][string]$Status,
        [AllowNull()][object]$WeeklyRemainingPercent,
        [AllowNull()][object]$ResetsAt,
        [AllowNull()][string]$Source,
        [AllowNull()][string]$Warning
    )
    [pscustomobject]@{
        provider                = $Provider
        status                  = $Status
        weeklyRemainingPercent  = $WeeklyRemainingPercent
        resetsAt                = $ResetsAt
        source                  = $(if ([string]::IsNullOrWhiteSpace($Source)) { $null } else { $Source })
        warning                 = $(if ([string]::IsNullOrWhiteSpace($Warning)) { $null } else { $Warning })
    }
}

# Converts a parsed JSON object into a nested hashtable so window selection can
# use dictionary semantics regardless of ConvertFrom-Json's PSCustomObject shape.
function ConvertTo-DeepHashtable {
    param([AllowNull()][object]$Value)
    if ($null -eq $Value) { return $null }
    if ($Value -is [System.Management.Automation.PSCustomObject]) {
        $table = @{}
        foreach ($prop in $Value.PSObject.Properties) {
            $table[$prop.Name] = ConvertTo-DeepHashtable -Value $prop.Value
        }
        return $table
    }
    if ($Value -is [System.Collections.IDictionary]) {
        $table = @{}
        foreach ($key in $Value.Keys) {
            $table[$key] = ConvertTo-DeepHashtable -Value $Value[$key]
        }
        return $table
    }
    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
        $list = @()
        foreach ($item in $Value) { $list += ConvertTo-DeepHashtable -Value $item }
        return $list
    }
    return $Value
}

# Detects the OpenCode auth store path.
function Get-DefaultAuthStorePath {
    $profileHome = [Environment]::GetFolderPath('UserProfile')
    $candidates = @()
    if ($profileHome) { $candidates += "$profileHome\.local\share\opencode\auth.json" }
    if ($env:APPDATA) { $candidates += "$env:APPDATA\opencode\auth.json" }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    return $candidates[0]
}

# Resolves the OpenCode Go API key: explicit param, then env var, then auth
# store. The key is returned only to be used in memory for the Bearer header; it
# is never printed, logged, or persisted. Returns $null when unavailable.
function Get-OpenCodeGoApiKey {
    param(
        [AllowNull()][string]$ApiKey,
        [AllowNull()][string]$AuthStorePath
    )
    if (-not [string]::IsNullOrWhiteSpace($ApiKey)) { return $ApiKey.Trim() }
    $envKey = [Environment]::GetEnvironmentVariable('OPENCODE_GO_API_KEY')
    if (-not [string]::IsNullOrWhiteSpace($envKey)) { return $envKey.Trim() }
    $path = if ([string]::IsNullOrWhiteSpace($AuthStorePath)) { Get-DefaultAuthStorePath } else { $AuthStorePath }
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    try {
        $json = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -ErrorAction Stop
        $entry = $json.PSObject.Properties['opencode-go']
        if ($null -ne $entry -and $entry.Value -and -not [string]::IsNullOrWhiteSpace([string]$entry.Value.key)) {
            return ([string]$entry.Value.key).Trim()
        }
    } catch {
        return $null
    }
    return $null
}

# Official authenticated OpenCode Go usage fetch. Returns an object with
# `StatusCode` and `Body`. Throws on transport-level failure. The key is used
# only in the Authorization header and never surfaces in output.
function Invoke-GoUsage {
    param(
        [string]$ApiKey,
        [string]$Endpoint,
        [int]$TimeoutSeconds
    )
    $response = Invoke-WebRequest -Uri $Endpoint `
        -Method GET `
        -Headers @{ Authorization = "Bearer $ApiKey" } `
        -TimeoutSec $TimeoutSeconds `
        -SkipHttpErrorCheck `
        -ErrorAction Stop
    return [pscustomobject]@{
        StatusCode = [int]$response.StatusCode
        Body       = [string]$response.Content
    }
}

# Parses a raw 200-level official OpenCode Go response into a normalized usage
# object, selecting the weekly window.
function ConvertTo-NormalizedUsage {
    param(
        [string]$RawJson,
        [string]$Source
    )
    if ([string]::IsNullOrWhiteSpace($RawJson)) {
        return New-NormalizedUsage -Provider 'opencode-go' -Status 'error' -Source $Source `
            -Warning 'Empty response from the OpenCode Go usage endpoint.'
    }
    try {
        $parsed = $RawJson | ConvertFrom-Json -ErrorAction Stop
    } catch {
        return New-NormalizedUsage -Provider 'opencode-go' -Status 'error' -Source $Source `
            -Warning 'OpenCode Go usage response was not valid JSON.'
    }
    $response = @{}
    foreach ($prop in $parsed.PSObject.Properties) {
        $response[$prop.Name] = ConvertTo-DeepHashtable -Value $prop.Value
    }
    # The live endpoint nests windows under `usage`; accept a flat `weeklyUsage`
    # too. Descend into the container if present.
    $container = $response
    if ($response.ContainsKey('usage') -and $response['usage'] -is [System.Collections.IDictionary]) {
        $container = $response['usage']
    }
    $windowKey = if ($container.ContainsKey('weeklyUsage')) { 'weeklyUsage' } elseif ($container.ContainsKey('weekly')) { 'weekly' } else { $null }
    $window = $null
    if ($null -ne $windowKey) { $window = $container[$windowKey] }
    if ($null -eq $window -or -not ($window -is [System.Collections.IDictionary])) {
        return New-NormalizedUsage -Provider 'opencode-go' -Status 'unavailable' -Source $Source `
            -Warning 'No weekly usage window was available from the OpenCode Go endpoint.'
    }
    $percent = $null
    if ($window.Contains('usagePercent')) { $percent = $window['usagePercent'] }
    elseif ($window.Contains('percent')) { $percent = $window['percent'] }
    $remaining = ConvertTo-RemainingPercent -UsedPercent $percent
    if ($null -eq $remaining) {
        return New-NormalizedUsage -Provider 'opencode-go' -Status 'error' -Source $Source `
            -Warning 'OpenCode Go weekly window was present but the usage-percent value was unusable.'
    }
    $resetsAt = $null
    if ($window.Contains('resetInSec')) {
        $resetsAt = ConvertTo-ResetTimestamp -Value ([DateTime]::UtcNow.AddSeconds([double]$window['resetInSec']).ToString('o'))
    } elseif ($window.Contains('resetsAt')) {
        $resetsAt = ConvertTo-ResetTimestamp -Value $window['resetsAt']
    }
    return New-NormalizedUsage -Provider 'opencode-go' -Status 'ok' `
        -WeeklyRemainingPercent $remaining -ResetsAt $resetsAt `
        -Source $Source
}

function Main {
    $source = 'opencode-go:/zen/go/v1/usage'
    $apiKey = Get-OpenCodeGoApiKey -ApiKey $ApiKey -AuthStorePath $AuthStorePath
    if ([string]::IsNullOrWhiteSpace($apiKey)) {
        return New-NormalizedUsage -Provider 'opencode-go' -Status 'unavailable' -Source $null `
            -Warning 'No OpenCode Go API key found; run `opencode auth login` or set OPENCODE_GO_API_KEY.'
    }
    $result = $null
    try {
        $result = Invoke-GoUsage -ApiKey $apiKey -Endpoint $Endpoint -TimeoutSeconds $TimeoutSeconds
    } catch {
        return New-NormalizedUsage -Provider 'opencode-go' -Status 'error' -Source $source `
            -Warning "Failed to read OpenCode Go usage: $($_.Exception.Message)"
    }
    if ($result.StatusCode -eq 401 -or $result.StatusCode -eq 403) {
        return New-NormalizedUsage -Provider 'opencode-go' -Status 'unavailable' -Source $source `
            -Warning "OpenCode Go returned HTTP $($result.StatusCode); the API key is invalid or has no Go subscription."
    }
    if ($result.StatusCode -ne 200) {
        return New-NormalizedUsage -Provider 'opencode-go' -Status 'error' -Source $source `
            -Warning "OpenCode Go usage endpoint returned unexpected HTTP $($result.StatusCode)."
    }
    ConvertTo-NormalizedUsage -RawJson $result.Body -Source $source
}

if ($MyInvocation.InvocationName -ne '.') {
    Main | ConvertTo-Json -Compress
}
