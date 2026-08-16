$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $here '..\get-codex-usage.ps1'
. $script

Describe 'get-codex-usage.ps1 normalization' {
    Context 'ConvertTo-NormalizedUsage' {
        It 'returns ok with a weekly window, clamped percent, and ISO resetsAt' {
            $raw = '{"rateLimits":{"primary":{"usedPercent":28,"resetsAt":1768435200,"windowDurationMins":10080}}}'
            $result = ConvertTo-NormalizedUsage -RawJson $raw -Source 'codex:account/rateLimits/read' -WeeklyWindowMinutes 10080
            $result.status | Should Be 'ok'
            $result.weeklyRemainingPercent | Should Be 72
            $result.resetsAt | Should Be ([DateTimeOffset]::FromUnixTimeSeconds(1768435200).UtcDateTime.ToString('o'))
            $result.source | Should Be 'codex:account/rateLimits/read'
            $result.warning | Should Be $null
        }

        It 'returns ok from a rateLimitsByLimitId bucket when present' {
            $raw = '{"rateLimitsByLimitId":{"codex":{"primary":{"usedPercent":10,"resetsAt":null,"windowDurationMins":10080}}}}'
            $result = ConvertTo-NormalizedUsage -RawJson $raw -Source 'codex' -WeeklyWindowMinutes 10080
            $result.status | Should Be 'ok'
            $result.weeklyRemainingPercent | Should Be 90
            $result.resetsAt | Should Be $null
        }

        It 'returns unavailable when no weekly window exists' {
            $raw = '{"rateLimits":{"primary":{"usedPercent":10,"windowDurationMins":60}}}'
            $result = ConvertTo-NormalizedUsage -RawJson $raw -Source 'codex' -WeeklyWindowMinutes 10080
            $result.status | Should Be 'unavailable'
            $result.weeklyRemainingPercent | Should Be $null
            $result.warning | Should Not Be $null
        }

        It 'returns error on malformed JSON' {
            $result = ConvertTo-NormalizedUsage -RawJson '{not json' -Source 'codex' -WeeklyWindowMinutes 10080
            $result.status | Should Be 'error'
            $result.weeklyRemainingPercent | Should Be $null
            $result.warning | Should Not Be $null
        }

        It 'returns error on an empty response' {
            $result = ConvertTo-NormalizedUsage -RawJson '   ' -Source 'codex' -WeeklyWindowMinutes 10080
            $result.status | Should Be 'error'
        }

        It 'returns error when usedPercent is unusable' {
            $raw = '{"rateLimits":{"primary":{"usedPercent":"abc","windowDurationMins":10080}}}'
            $result = ConvertTo-NormalizedUsage -RawJson $raw -Source 'codex' -WeeklyWindowMinutes 10080
            $result.status | Should Be 'error'
        }

        It 'clamps remaining percent to bounds' {
            $high = ConvertTo-RemainingPercent -UsedPercent 130
            $low = ConvertTo-RemainingPercent -UsedPercent -20
            $high | Should Be 0
            $low | Should Be 100
        }
    }

    Context 'Main command flow' {
        It 'returns error on command failure' {
            Mock Invoke-RateLimitsRead { throw 'boom' }
            $result = Main
            $result.status | Should Be 'error'
            $result.warning | Should Match 'boom'
        }

        It 'returns unavailable on an auth-style command failure' {
            Mock Invoke-RateLimitsRead { throw 'codex login required to read usage' }
            $result = Main
            $result.status | Should Be 'unavailable'
        }

        It 'returns ok end to end' {
            Mock Invoke-RateLimitsRead { '{"rateLimits":{"primary":{"usedPercent":28,"resetsAt":1768435200,"windowDurationMins":10080}}}' }
            $result = Main
            $result.status | Should Be 'ok'
            $result.weeklyRemainingPercent | Should Be 72
        }
    }
}
