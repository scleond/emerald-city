$here=Split-Path -Parent $MyInvocation.MyCommand.Path
$script=Join-Path $here '..\boss-run-state.ps1'
function Run-State { & $script @args 2>$null }
function Expect-Failure { $global:LASTEXITCODE=0; $null=& $script @args 2>$null; $exitCode=$global:LASTEXITCODE; $exitCode | Should Not Be 0 }

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

 It 'does not treat a deliberately successful helper call as a failure' {
  Run-State init -Issue 69 -Base base -Workspace ws | Out-Null
  Expect-Failure record -Kind verification -Value failed
  $caught=$false
  try { Expect-Failure get } catch { $caught=$true }
  $caught | Should Be $true
 }

 It 'migrates v1 state to persisted normalized schema version 2' {
  $v1=[ordered]@{
   schemaVersion=1; issue=69; workspace='ws'; acceptedBase='base'; phase='selected'; outcome=$null; revision=0
   budgets=[ordered]@{recoveryPrompts=0;writerLaunches=0;reviewRounds=0;reviewerReplacements=0}
   verified=$false; reviewed=$false; preserved=$false; preservedCommit=$null; fixedPointCommit=$null
   preservationEvidence=$null; observations=@(); permissionAttempts=0; handledPermissionIds=@()
  } | ConvertTo-Json -Depth 5 -Compress
  Set-Content -LiteralPath $env:BOSS_ISSUE_LOOP_STATE_PATH -Value $v1 -Encoding UTF8
  $migrated=Run-State get | ConvertFrom-Json
  $migrated.schemaVersion | Should Be 2
  $migrated.remoteStates.Count | Should Be 0; $migrated.activeResources.Count | Should Be 0; $migrated.resourceEvents.Count | Should Be 0
  $migrated.permissionReconciliationIds.Count | Should Be 0; $migrated.degraded | Should Be $false; $migrated.noNewAgents | Should Be $false
  $persisted=Get-Content -Raw -LiteralPath $env:BOSS_ISSUE_LOOP_STATE_PATH | ConvertFrom-Json
  $persisted.schemaVersion | Should Be 2
 }

 It 'degrades once on recursive permission and blocks every later launch' {
  $env:BOSS_ISSUE_LOOP_STATE_PATH=Join-Path $TestDrive 'degraded.json'; Run-State init -Issue 69 -Base base -Workspace ws | Out-Null
  Run-State permission -PermissionId req-recursive -PermissionMode recursive | Out-Null
  $state=Run-State get | ConvertFrom-Json
  $state.outcome | Should Be 'degraded'; $state.degraded | Should Be $true; $state.noNewAgents | Should Be $true
  $state.permissionAttempts | Should Be 1; $state.handledPermissionIds.Count | Should Be 1
  Expect-Failure consume -Budget writerLaunches; Expect-Failure consume -Budget reviewRounds
  Expect-Failure permission -PermissionId req-recursive -PermissionMode recursive
  $state=Run-State reconcile -PermissionId req-recursive -Value permission-status | ConvertFrom-Json
  $again=Run-State reconcile -PermissionId req-recursive -Value permission-status | ConvertFrom-Json
  $again.revision | Should Be $state.revision
 }

 It 'separates interrupted remote mutations and preserves churn evidence' {
  Run-State init -Issue 69 -Base base -Workspace ws | Out-Null
  Run-State consume -Budget writerLaunches | Out-Null; Run-State consume -Budget writerLaunches | Out-Null
  Expect-Failure consume -Budget writerLaunches
  Run-State record -Kind remote -Value push-attempted | Out-Null
  $attempted=Run-State get | ConvertFrom-Json; $attempted.remoteStates.Count | Should Be 1; (@($attempted.remoteStates) -contains 'push-observed') | Should Be $false
  $first=Run-State record -Kind remote -Value push-attempted | ConvertFrom-Json
  Run-State record -Kind remote -Value push-observed | Out-Null
  Run-State record -Kind remote -Value comment-attempted | Out-Null
  Run-State record -Kind remote -Value comment-observed | Out-Null
  Run-State record -Kind preservation -Value commit:remote-evidence | Out-Null
  Run-State record -Kind remote -Value cleanup-attempted | Out-Null
  Run-State record -Kind remote -Value cleanup-observed | Out-Null
  $state=Run-State get | ConvertFrom-Json
  $state.remoteStates.Count | Should Be 6; (@($state.remoteStates) -contains 'push-attempted') | Should Be $true; (@($state.remoteStates) -contains 'push-observed') | Should Be $true; (@($state.remoteStates) -contains 'cleanup-observed') | Should Be $true
  $first.revision | Should Be 3
 }

 It 'keeps a fresh low-risk agent path bounded before integration' {
  Run-State init -Issue 69 -Base base -Workspace ws | Out-Null
  Run-State consume -Budget writerLaunches | Out-Null; Run-State consume -Budget reviewRounds | Out-Null
  $state=Run-State get | ConvertFrom-Json
  $state.budgets.writerLaunches | Should Be 1; $state.budgets.reviewRounds | Should Be 1; $state.noNewAgents | Should Be $false
 }

 It 'keeps terminal outcomes immutable and permits only the reconciliation replay' {
  Run-State init -Issue 69 -Base base -Workspace ws | Out-Null; Run-State outcome -Status blocked | Out-Null
  $before=Run-State get | ConvertFrom-Json
  Expect-Failure permission -PermissionId after-blocked
  Expect-Failure permission -PermissionId recursive-after-blocked -PermissionMode recursive
  $after=Run-State get | ConvertFrom-Json
  $after.revision | Should Be $before.revision; $after.outcome | Should Be 'blocked'; $after.permissionAttempts | Should Be 0
  $env:BOSS_ISSUE_LOOP_STATE_PATH=Join-Path $TestDrive 'degraded-terminal.json'; Run-State init -Issue 69 -Base base -Workspace ws | Out-Null
  Run-State permission -PermissionId recursive-once -PermissionMode recursive | Out-Null
  Expect-Failure permission -PermissionId second-after-degraded
  $one=Run-State reconcile -PermissionId recursive-once -Value permission-status | ConvertFrom-Json
  $two=Run-State reconcile -PermissionId recursive-once -Value permission-status | ConvertFrom-Json
  $two.revision | Should Be $one.revision
  $env:BOSS_ISSUE_LOOP_STATE_PATH=Join-Path $TestDrive 'complete-terminal.json'; Run-State init -Issue 69 -Base base -Workspace ws | Out-Null
  Run-State transition -Phase implementing | Out-Null; Run-State transition -Phase verifying | Out-Null; Run-State record -Kind verification -Value passed | Out-Null; Run-State transition -Phase reviewing | Out-Null; Run-State record -Kind review -Value approved | Out-Null; Run-State record -Kind preservation -Value commit:complete | Out-Null; Run-State transition -Phase integrating | Out-Null; Run-State transition -Phase pushed | Out-Null; Run-State transition -Phase closed | Out-Null; Run-State transition -Phase cleaned | Out-Null; Run-State outcome -Status complete | Out-Null
  $before=Run-State get | ConvertFrom-Json; Expect-Failure permission -PermissionId after-complete; $after=Run-State get | ConvertFrom-Json; $after.revision | Should Be $before.revision
}

 It 'blocks false review approval and all launches while retaining prompt, verification, preservation, and cleanup paths' {
  Run-State init -Issue 69 -Base base -Workspace ws | Out-Null
  Run-State permission -PermissionId superseding-one -PermissionMode superseding | Out-Null
  Expect-Failure record -Kind review -Value approved
  Run-State consume -Budget recoveryPrompts | Out-Null
  Expect-Failure consume -Budget writerLaunches; Expect-Failure consume -Budget reviewRounds; Expect-Failure consume -Budget reviewerReplacements
  Expect-Failure record -Kind resource -Value agent:writer-1:active
  Expect-Failure record -Kind remote -Value push-attempted; Expect-Failure record -Kind remote -Value comment-attempted; Expect-Failure record -Kind remote -Value closure-attempted
  Run-State record -Kind verification -Value passed | Out-Null; Run-State record -Kind preservation -Value commit:keep-me | Out-Null
  Run-State record -Kind remote -Value cleanup-attempted | Out-Null; Run-State record -Kind remote -Value cleanup-observed | Out-Null
  $state=Run-State get | ConvertFrom-Json; $state.reviewed | Should Be $false; $state.budgets.recoveryPrompts | Should Be 1
  (@($state.remoteStates) -contains 'cleanup-attempted') | Should Be $true; (@($state.remoteStates) -contains 'cleanup-observed') | Should Be $true
 }

 It 'requires resource archival before cleanup and exercises reviewer churn bounds' {
  Run-State init -Issue 69 -Base base -Workspace ws | Out-Null
  Run-State consume -Budget reviewRounds | Out-Null; Run-State consume -Budget reviewRounds | Out-Null; Run-State consume -Budget reviewerReplacements | Out-Null
  Expect-Failure consume -Budget reviewRounds; Expect-Failure consume -Budget reviewerReplacements
  Run-State record -Kind resource -Value agent:reviewer-1:active | Out-Null; Run-State record -Kind resource -Value workspace:review-ws:active | Out-Null
  Run-State record -Kind resource -Value agent:reviewer-1:archived | Out-Null; Run-State record -Kind resource -Value workspace:review-ws:archived | Out-Null
  Run-State record -Kind preservation -Value commit:review-evidence | Out-Null
  $state=Run-State get | ConvertFrom-Json; $state.activeResources.Count | Should Be 0; $state.resourceEvents.Count | Should Be 4
  Run-State record -Kind remote -Value cleanup-attempted | Out-Null; Run-State record -Kind remote -Value cleanup-observed | Out-Null
  $state=Run-State get | ConvertFrom-Json; (@($state.remoteStates) -contains 'cleanup-observed') | Should Be $true
 }
}
