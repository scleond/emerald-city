<#
.SYNOPSIS
Normalized weekly usage helper for the Codex provider used by the Boss issue loop.

.DESCRIPTION
Queries the authenticated Codex app-server account surface with
`account/rateLimits/read` and emits the normalized usage JSON interface consumed
by model selection. Uses the currently logged-in Codex session; it never
requests a login and never reads, prints, copies, or persists access tokens.

Output JSON interface:
    {
      "provider": "codex",
      "status": "ok | unavailable | error",
      "weeklyRemainingPercent": 72,           // or null
      "resetsAt": "ISO-8601 or null",
      "source": "provider-specific source or null",
      "warning": "message or null"
    }

Behavior:
  - ok          A weekly rate-limit window was found and normalized.
  - unavailable A valid response had no weekly window, or the session is not
                usable for rate-limit reads. A useful warning is set.
  - error       The fetch command failed or the response was malformed.

Trust: the script trusts only the codex CLI session it shells out to. Any
failure degrades to error/unavailable rather than aborting the issue loop.
#>
[CmdletBinding()]
param(
    # Codex CLI executable name or path.
    [string]$CodexExecutable = 'codex',
    # App-server account surface method to read rate limits from.
    [string]$RateLimitsMethod = 'account/rateLimits/read',
    # Seconds to wait for the CLI before treating the call as failed.
    [int]$TimeoutSeconds = 20,
    # Minimum weekly window duration in minutes to accept (7 days).
    [int]$WeeklyWindowMinutes = 10080
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

# Drives the authenticated Codex app-server over stdio and returns the raw
# `account/rateLimits/read` result as a JSON string. Credentials live in the
# Codex session handled by the app-server; they are never read, copied, or
# persisted here, and no interactive `/usage` screen is automated.
function Invoke-RateLimitsRead {
    param(
        [string]$Executable,
        [string]$Method,
        [int]$TimeoutSeconds
    )
    $found = Get-Command -Name $Executable -ErrorAction SilentlyContinue
    if (-not $found) {
        throw "Codex executable '$Executable' not found on PATH."
    }

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $found.Source
    $psi.Arguments = 'app-server --stdio'
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    # Let the app-server inherit stderr so we never block on an unread pipe.
    $psi.RedirectStandardError = $false
    $proc = [System.Diagnostics.Process]::new()
    $proc.StartInfo = $psi
    if (-not $proc.Start()) {
        throw "Failed to start codex app-server."
    }

    # Drain stdout on its own runspace into a queue so the main thread can poll
    # with a bounded timeout without blocking on ReadLine().
    $outLines = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()
    $reader = [powershell]::Create()
    [void]$reader.AddScript({
        param($target, $queue)
        while ($true) {
            $line = $target.StandardOutput.ReadLine()
            if ($null -eq $line) { break }
            $queue.Enqueue($line)
        }
    }).AddArgument($proc).AddArgument($outLines)
    $readerHandle = $reader.BeginInvoke()

    $requestId = 2
    try {
        $writer = $proc.StandardInput
        $writer.NewLine = "`n"
        $writer.WriteLine((@{ method = 'initialize'; id = 1; params = @{
            clientInfo = @{ name = 'boss-implement-loop'; title = 'Boss Implement Loop'; version = '1.0' }
        } } | ConvertTo-Json -Compress -Depth 6))
        $writer.WriteLine((@{ method = 'initialized' } | ConvertTo-Json -Compress))
        $writer.WriteLine((@{ method = $Method; id = $requestId } | ConvertTo-Json -Compress))
        $writer.Flush()

        $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
        $line = $null
        while ([DateTime]::UtcNow -lt $deadline) {
            if ($outLines.TryDequeue([ref]$line)) {
                $msg = $null
                try { $msg = $line | ConvertFrom-Json -ErrorAction Stop } catch { $msg = $null }
                if ($null -ne $msg -and $msg.PSObject.Properties['id'] -and $msg.id -eq $requestId) {
                    if ($msg.PSObject.Properties['error'] -and $null -ne $msg.error) {
                        throw "Codex '$Method' RPC error: $($msg.error.message)"
                    }
                    if ($null -eq $msg.result) {
                        throw "Codex '$Method' returned an empty result."
                    }
                    return ($msg.result | ConvertTo-Json -Compress -Depth 12)
                }
            } else {
                if ($proc.HasExited) { Start-Sleep -Milliseconds 120 }
                else { Start-Sleep -Milliseconds 40 }
            }
        }
        throw "Timed out waiting for the codex app-server '$Method' response."
    } finally {
        try { $proc.StandardInput.Close() } catch { }
        try { if (-not $proc.HasExited) { $proc.Kill($true) } } catch { }
        try { if (-not $readerHandle.IsCompleted) { $reader.Stop() } } catch { }
        try { $reader.Dispose() } catch { }
        $proc.Dispose()
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

# Collects candidate rate-limit windows from a parsed codex response and picks
# the weekly one. Returns the chosen window or $null when none is weekly.
function Select-WeeklyWindow {
    param([Parameter(Mandatory = $true)][hashtable]$Response, [int]$WeeklyWindowMinutes)
    $candidates = @()
    if ($Response.ContainsKey('rateLimits') -and $null -ne $Response['rateLimits']) {
        $snap = $Response['rateLimits']
        if ($snap -is [System.Collections.IDictionary]) {
            foreach ($key in @('primary', 'secondary')) {
                if ($snap.Contains($key) -and $null -ne $snap[$key]) {
                    $candidates += $snap[$key]
                }
            }
        }
    }
    if ($Response.ContainsKey('rateLimitsByLimitId') -and $null -ne $Response['rateLimitsByLimitId']) {
        $buckets = $Response['rateLimitsByLimitId']
        if ($buckets -is [System.Collections.IDictionary]) {
            foreach ($snap in $buckets.Values) {
                if ($snap -is [System.Collections.IDictionary]) {
                    foreach ($key in @('primary', 'secondary')) {
                        if ($snap.Contains($key) -and $null -ne $snap[$key]) {
                            $candidates += $snap[$key]
                        }
                    }
                }
            }
        }
    }
    foreach ($window in $candidates) {
        if (-not ($window -is [System.Collections.IDictionary])) { continue }
        if (-not $window.Contains('usedPercent')) { continue }
        $duration = $null
        if ($window.Contains('windowDurationMins') -and $null -ne $window['windowDurationMins']) {
            try { $duration = [int]$window['windowDurationMins'] } catch { $duration = $null }
        }
        if ($null -eq $duration -or $duration -eq $WeeklyWindowMinutes) {
            # A missing duration is ambiguous; only trust it as weekly when a
            # positive duration explicitly matches the weekly window.
            if ($duration -eq $WeeklyWindowMinutes) {
                return $window
            }
        }
    }
    return $null
}

# Parses a raw codex response string into a normalized usage object.
function ConvertTo-NormalizedUsage {
    param(
        [string]$RawJson,
        [string]$Source,
        [int]$WeeklyWindowMinutes
    )
    if ([string]::IsNullOrWhiteSpace($RawJson)) {
        return New-NormalizedUsage -Provider 'codex' -Status 'error' -Source $Source `
            -Warning 'Empty response from the codex rate-limits read.'
    }
    try {
        $parsed = $RawJson | ConvertFrom-Json -ErrorAction Stop
    } catch {
        return New-NormalizedUsage -Provider 'codex' -Status 'error' -Source $Source `
            -Warning 'Codex rate-limits response was not valid JSON.'
    }
    $response = @{}
    foreach ($prop in $parsed.PSObject.Properties) {
        $response[$prop.Name] = ConvertTo-DeepHashtable -Value $prop.Value
    }
    $window = Select-WeeklyWindow -Response $response -WeeklyWindowMinutes $WeeklyWindowMinutes
    if ($null -eq $window) {
        return New-NormalizedUsage -Provider 'codex' -Status 'unavailable' -Source $Source `
            -Warning 'No weekly rate-limit window was available in the codex response.'
    }
    $usedPercent = $null
    if ($window.Contains('usedPercent')) { $usedPercent = $window['usedPercent'] }
    $remaining = ConvertTo-RemainingPercent -UsedPercent $usedPercent
    if ($null -eq $remaining) {
        return New-NormalizedUsage -Provider 'codex' -Status 'error' -Source $Source `
            -Warning 'Weekly rate-limit window was present but the used-percent value was unusable.'
    }
    $resetsAt = $null
    if ($window.Contains('resetsAt')) { $resetsAt = $window['resetsAt'] }
    return New-NormalizedUsage -Provider 'codex' -Status 'ok' `
        -WeeklyRemainingPercent $remaining -ResetsAt (ConvertTo-Iso8601 -UnixSeconds $resetsAt) `
        -Source $Source
}

function Main {
    $source = 'codex:account/rateLimits/read'
    $raw = $null
    try {
        $raw = Invoke-RateLimitsRead -Executable $CodexExecutable -Method $RateLimitsMethod `
            -TimeoutSeconds $TimeoutSeconds
    } catch {
        $msg = $_.Exception.Message
        $isAuth = $msg -match 'auth|login|sign|unauthorized|401'
        if ($isAuth) {
            return New-NormalizedUsage -Provider 'codex' -Status 'unavailable' -Source $source `
                -Warning "Codex session is not available for rate-limit reads: $msg"
        }
        return New-NormalizedUsage -Provider 'codex' -Status 'error' -Source $source `
            -Warning "Failed to read codex rate limits: $msg"
    }
    ConvertTo-NormalizedUsage -RawJson $raw -Source $source -WeeklyWindowMinutes $WeeklyWindowMinutes
}

if ($MyInvocation.InvocationName -ne '.') {
    Main | ConvertTo-Json -Compress
}
