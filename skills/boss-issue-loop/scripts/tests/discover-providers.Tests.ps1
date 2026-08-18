$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $here '..\discover-providers.ps1'
. $script

Describe 'discover-providers.ps1' {
    Context 'New-ProviderEntry' {
        It 'creates a provider entry with ok status' {
            $result = New-ProviderEntry -Name 'codex' -Status 'ok' -Authenticated $true
            $result.name | Should Be 'codex'
            $result.status | Should Be 'ok'
            $result.authenticated | Should Be $true
            $result.models | Should BeOfType [System.Array]
            $result.warning | Should Be $null
        }

        It 'creates a provider entry with warning' {
            $result = New-ProviderEntry -Name 'codex' -Status 'unavailable' -Warning 'not found'
            $result.status | Should Be 'unavailable'
            $result.warning | Should Be 'not found'
        }

        It 'creates a provider entry with models' {
            $models = @((New-ModelEntry -Id 'gpt-5.6-luna' -Name 'GPT-5.6 Luna'))
            $result = New-ProviderEntry -Name 'codex' -Status 'ok' -Models $models
            $result.models.Count | Should Be 1
            $result.models[0].id | Should Be 'gpt-5.6-luna'
        }
    }

    Context 'New-ModelEntry' {
        It 'creates a model entry with explicit name' {
            $result = New-ModelEntry -Id 'gpt-5.6-luna' -Name 'GPT-5.6 Luna'
            $result.id | Should Be 'gpt-5.6-luna'
            $result.name | Should Be 'GPT-5.6 Luna'
        }

        It 'creates a model entry using id as name when name is empty' {
            $result = New-ModelEntry -Id 'gpt-5.6-luna'
            $result.id | Should Be 'gpt-5.6-luna'
            $result.name | Should Be 'gpt-5.6-luna'
        }
    }

    Context 'Test-CommandExists' {
        It 'returns true for existing command' {
            Test-CommandExists -Command 'powershell' | Should Be $true
        }

        It 'returns false for non-existing command' {
            Test-CommandExists -Command 'nonexistent-command-xyz' | Should Be $false
        }
    }

    Context 'Main command flow' {
        It 'returns ok when at least one provider is found' {
            Mock Test-CommandExists { return $true }
            Mock Get-CodexProvider {
                return New-ProviderEntry -Name 'codex' -Status 'ok' -Authenticated $true
            }
            Mock Get-OpenCodeProvider {
                return New-ProviderEntry -Name 'opencode' -Status 'unavailable' -Warning 'not found'
            }
            Mock Get-AvailableAdapters {
                return @([pscustomobject]@{ name = 'paseo'; source = 'packaged'; path = 'orchestration/paseo.md' })
            }
            $result = Main
            $result.status | Should Be 'ok'
            $result.providers.Count | Should Be 2
            $result.adapters.Count | Should Be 1
        }

        It 'returns unavailable when no providers are found' {
            Mock Test-CommandExists { return $false }
            Mock Get-CodexProvider {
                return New-ProviderEntry -Name 'codex' -Status 'unavailable' -Warning 'not found'
            }
            Mock Get-OpenCodeProvider {
                return New-ProviderEntry -Name 'opencode' -Status 'unavailable' -Warning 'not found'
            }
            Mock Get-AvailableAdapters {
                return @()
            }
            $result = Main
            $result.status | Should Be 'unavailable'
        }

        It 'returns error when all providers error' {
            Mock Test-CommandExists { return $true }
            Mock Get-CodexProvider {
                return New-ProviderEntry -Name 'codex' -Status 'error' -Warning 'probe failed'
            }
            Mock Get-OpenCodeProvider {
                return New-ProviderEntry -Name 'opencode' -Status 'error' -Warning 'probe failed'
            }
            Mock Get-AvailableAdapters {
                return @()
            }
            $result = Main
            $result.status | Should Be 'error'
            $result.warning | Should Not Be $null
        }

        It 'aggregates warnings from providers' {
            Mock Test-CommandExists { return $true }
            Mock Get-CodexProvider {
                return New-ProviderEntry -Name 'codex' -Status 'unavailable' -Warning 'codex missing'
            }
            Mock Get-OpenCodeProvider {
                return New-ProviderEntry -Name 'opencode' -Status 'unavailable' -Warning 'opencode missing'
            }
            Mock Get-AvailableAdapters {
                return @()
            }
            $result = Main
            $result.warning | Should Match 'codex missing'
            $result.warning | Should Match 'opencode missing'
        }
    }

    Context 'JSON output shape' {
        It 'produces valid JSON with all required fields' {
            Mock Test-CommandExists { return $true }
            Mock Get-CodexProvider {
                return New-ProviderEntry -Name 'codex' -Status 'ok' -Authenticated $true
            }
            Mock Get-OpenCodeProvider {
                return New-ProviderEntry -Name 'opencode' -Status 'ok' -Authenticated $true
            }
            Mock Get-AvailableAdapters {
                return @([pscustomobject]@{ name = 'paseo'; source = 'packaged'; path = 'orchestration/paseo.md' })
            }
            $result = Main
            $json = $result | ConvertTo-Json -Compress -Depth 10
            $parsed = $json | ConvertFrom-Json
            $parsed.status | Should Not Be $null
            $parsed.providers | Should Not Be $null
            $parsed.adapters | Should Not Be $null
            $parsed.PSObject.Properties['warning'] | Should Not Be $null
        }

        It 'each provider has required fields' {
            Mock Test-CommandExists { return $true }
            Mock Get-CodexProvider {
                return New-ProviderEntry -Name 'codex' -Status 'ok' -Authenticated $true
            }
            Mock Get-OpenCodeProvider {
                return New-ProviderEntry -Name 'opencode' -Status 'ok' -Authenticated $false
            }
            Mock Get-AvailableAdapters { return @() }
            $result = Main
            foreach ($p in $result.providers) {
                $p.name | Should Not Be $null
                $p.status | Should BeIn @('ok', 'unavailable', 'error')
                $p.PSObject.Properties['authenticated'] | Should Not Be $null
                $p.models | Should Not Be $null
                $p.PSObject.Properties['warning'] | Should Not Be $null
            }
        }
    }
}
