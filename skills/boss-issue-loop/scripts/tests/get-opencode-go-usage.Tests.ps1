$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $here '..\get-opencode-go-usage.ps1'
. $script

Describe 'get-opencode-go-usage.ps1' {
    Context 'key resolution' {
        It 'prefers the explicit ApiKey parameter' {
            (Get-OpenCodeGoApiKey -ApiKey '   sk-live-123  ' -AuthStorePath 'C:\nope.json') | Should Be 'sk-live-123'
        }

        It 'returns null when no key source has a value' {
            $env:OPENCODE_GO_API_KEY = $null
            (Get-OpenCodeGoApiKey -ApiKey '' -AuthStorePath 'C:\nope.json') | Should Be $null
        }
    }

    Context 'usage window normalization' {
        It 'returns ok for the live usage.weekly.percent shape' {
            $body = '{"usage":{"rolling":{"status":"ok","percent":2,"resetsAt":"2026-08-16T18:00:14Z"},"weekly":{"status":"ok","percent":30,"resetsAt":"2026-08-17T00:00:00Z"},"monthly":{"status":"ok","percent":30,"resetsAt":"2026-09-12T11:42:58Z"}}}'
            $result = ConvertTo-NormalizedUsage -RawJson $body -Source 'opencode-go:/zen/go/v1/usage'
            $result.status | Should Be 'ok'
            $result.weeklyRemainingPercent | Should Be 70
            $result.resetsAt | Should Be ([DateTime]::Parse('2026-08-17T00:00:00Z').ToUniversalTime().ToString('o'))
            $result.warning | Should Be $null
        }

        It 'returns ok for a flat weeklyUsage with resetInSec' {
            $body = '{"weeklyUsage":{"status":"ok","usagePercent":15,"resetInSec":7200}}'
            $result = ConvertTo-NormalizedUsage -RawJson $body -Source 'opencode-go:/zen/go/v1/usage'
            $result.status | Should Be 'ok'
            $result.weeklyRemainingPercent | Should Be 85
            $result.resetsAt | Should Match 'T'
        }

        It 'returns unavailable when no weekly window is present' {
            $body = '{"usage":{"rolling":{"percent":1,"resetsAt":"2026-08-16T00:00:00Z"}}}'
            $result = ConvertTo-NormalizedUsage -RawJson $body -Source 'opencode-go:/zen/go/v1/usage'
            $result.status | Should Be 'unavailable'
            $result.weeklyRemainingPercent | Should Be $null
        }

        It 'returns error on malformed JSON' {
            $result = ConvertTo-NormalizedUsage -RawJson 'nope' -Source 'opencode-go:/zen/go/v1/usage'
            $result.status | Should Be 'error'
        }

        It 'returns error on an empty body' {
            $result = ConvertTo-NormalizedUsage -RawJson '   ' -Source 'opencode-go:/zen/go/v1/usage'
            $result.status | Should Be 'error'
        }

        It 'returns error when usage-percent is unusable' {
            $body = '{"usage":{"weekly":{"status":"ok","percent":"abc","resetsAt":"2026-08-17T00:00:00Z"}}}'
            $result = ConvertTo-NormalizedUsage -RawJson $body -Source 'opencode-go:/zen/go/v1/usage'
            $result.status | Should Be 'error'
        }

        It 'clamps remaining percent to bounds' {
            (ConvertTo-RemainingPercent -UsedPercent 150) | Should Be 0
            (ConvertTo-RemainingPercent -UsedPercent -5) | Should Be 100
        }
    }

    Context 'Main command flow' {
        It 'returns unavailable when no API key is available' {
            Mock Get-OpenCodeGoApiKey { return $null }
            $result = Main
            $result.status | Should Be 'unavailable'
            $result.warning | Should Match 'API key'
        }

        It 'returns ok end to end' {
            Mock Get-OpenCodeGoApiKey { return 'sk-live-123' }
            Mock Invoke-GoUsage { return [pscustomobject]@{ StatusCode = 200; Body = '{"usage":{"weekly":{"status":"ok","percent":61,"resetsAt":"2026-08-17T00:00:00Z"}}}' } }
            $result = Main
            $result.status | Should Be 'ok'
            $result.weeklyRemainingPercent | Should Be 39
            $result.source | Should Be 'opencode-go:/zen/go/v1/usage'
        }

        It 'returns unavailable on 401 (no active Go plan)' {
            Mock Get-OpenCodeGoApiKey { return 'sk-live-123' }
            Mock Invoke-GoUsage { return [pscustomobject]@{ StatusCode = 401; Body = '{}' } }
            $result = Main
            $result.status | Should Be 'unavailable'
            $result.warning | Should Match '401'
        }

        It 'returns error on an unexpected status code' {
            Mock Get-OpenCodeGoApiKey { return 'sk-live-123' }
            Mock Invoke-GoUsage { return [pscustomobject]@{ StatusCode = 500; Body = 'oops' } }
            $result = Main
            $result.status | Should Be 'error'
        }

        It 'returns error on a transport failure' {
            Mock Get-OpenCodeGoApiKey { return 'sk-live-123' }
            Mock Invoke-GoUsage { throw 'connection refused' }
            $result = Main
            $result.status | Should Be 'error'
            $result.warning | Should Match 'connection refused'
        }
    }
}
