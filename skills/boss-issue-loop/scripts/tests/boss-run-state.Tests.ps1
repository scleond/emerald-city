$here=Split-Path -Parent $MyInvocation.MyCommand.Path
$script=Join-Path $here '..\boss-run-state.ps1'
function Run-State { & $script @args 2>$null }
function Expect-Failure { & $script @args 2>$null; $LASTEXITCODE | Should Not Be 0 }

Describe 'boss-run-state.ps1' {
 BeforeEach { $env:BOSS_ISSUE_LOOP_STATE_PATH=Join-Path $TestDrive 'run-state.json'; Remove-Item -LiteralPath $env:BOSS_ISSUE_LOOP_STATE_PATH -Force -ErrorAction SilentlyContinue }

 It 'persists the complete lifecycle, fixed point, permission IDs, and replay idempotence' {
  Run-State init -Issue 68 -Base cef0eb4 -Workspace wks_efb12a6555c49024 | Out-Null
  Run-State permission -PermissionId req-1 | Out-Null; Run-State permission -PermissionId req-2 | Out-Null
  Run-State transition -Phase implementing | Out-Null; Run-State transition -Phase verifying | Out-Null
  Run-State record -Kind verification -Value passed | Out-Null; Run-State transition -Phase reviewing | Out-Null
  Run-State record -Kind review -Value approved | Out-Null; Run-State record -Kind fixedPoint -Value commit:abc123 | Out-Null
  Run-State record -Kind preservation -Value commit:def456 | Out-Null; Run-State transition -Phase integrating | Out-Null
  Run-State transition -Phase pushed | Out-Null; $pushed=Run-State reconcile -Value push | ConvertFrom-Json
  $replay=Run-State reconcile -Value push | ConvertFrom-Json; $replay.revision | Should Be $pushed.revision
  Run-State transition -Phase closed | Out-Null; $closed=Run-State reconcile -Value closure | ConvertFrom-Json
  $replay=Run-State reconcile -Value closure | ConvertFrom-Json; $replay.revision | Should Be $closed.revision
  Run-State transition -Phase cleaned | Out-Null; Run-State outcome -Status complete | Out-Null
  $state=Run-State get | ConvertFrom-Json
  $state.handledPermissionIds.Count | Should Be 2; $state.fixedPointCommit | Should Be 'abc123'; $state.preservedCommit | Should Be 'def456'
 }

 It 'rejects permission replay, malformed identifiers, and missing record arguments' {
  Run-State init -Issue 68 -Base base -Workspace ws | Out-Null
  Run-State permission -PermissionId request-1 | Out-Null
  Expect-Failure permission -PermissionId request-1; Expect-Failure permission -PermissionId 'secret value'
  Expect-Failure record -Value passed; Expect-Failure record -Kind verification
 }

 It 'rejects integration before verification and cleanup before preservation' {
  Run-State init -Issue 68 -Base base -Workspace ws | Out-Null; Run-State transition -Phase implementing | Out-Null; Run-State transition -Phase verifying | Out-Null
  Expect-Failure transition -Phase integrating; Expect-Failure transition -Phase cleaned
 }

 It 'enforces commit validation, complete preconditions, ownership, and base conflicts' {
  Run-State init -Issue 68 -Base base -Workspace ws | Out-Null
  Expect-Failure record -Kind preservation -Value 'commit:bad value'; Expect-Failure record -Kind fixedPoint -Value 'commit:'
  Expect-Failure outcome -Status complete
  Expect-Failure init -Issue 68 -Base other -Workspace ws; Expect-Failure init -Issue 69 -Base base -Workspace other
 }

 It 'archives a clean completed ledger before starting the next issue' {
  Run-State init -Issue 68 -Base base -Workspace ws | Out-Null
  Run-State transition -Phase implementing | Out-Null; Run-State transition -Phase verifying | Out-Null; Run-State record -Kind verification -Value passed | Out-Null; Run-State transition -Phase reviewing | Out-Null; Run-State record -Kind review -Value approved | Out-Null; Run-State record -Kind preservation -Value commit:abc123 | Out-Null; Run-State transition -Phase integrating | Out-Null; Run-State transition -Phase pushed | Out-Null; Run-State transition -Phase closed | Out-Null; Run-State transition -Phase cleaned | Out-Null; Run-State outcome -Status complete | Out-Null
  $next=Run-State init -Issue 69 -Base nextbase -Workspace ws | ConvertFrom-Json
  $next.issue | Should Be 69; (Get-ChildItem (Join-Path $TestDrive 'history') -Filter '*.json').Count | Should Be 1
 }
}
