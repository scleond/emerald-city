<#
.SYNOPSIS
Persist and reconcile one Boss issue-loop run.

State contains opaque identity/result facts only. It never stores credentials,
secret-bearing command output, or transcripts.
#>
[CmdletBinding()]
param(
    [Parameter(Position=0)][ValidateSet('init','get','transition','record','consume','permission','reconcile','outcome')][string]$Command='get',
    [int]$Issue,[string]$Base,[string]$Workspace,[string]$Phase,
    [ValidateSet('verification','review','preservation','fixedPoint','remote','resource')][string]$Kind,
    [string]$Value,[string]$PermissionId,[ValidateSet('normal','recursive','superseding')][string]$PermissionMode='normal',
    [ValidateSet('recoveryPrompts','writerLaunches','reviewRounds','reviewerReplacements')][string]$Budget,
    [ValidateSet('complete','blocked','degraded')][string]$Status)

Set-StrictMode -Version 3.0
$ErrorActionPreference='Stop'
$script:Phases=@('selected','implementing','verifying','reviewing','fixing','integrating','pushed','closed','cleaned')
$script:Next=@{selected=@('implementing');implementing=@('verifying');verifying=@('reviewing','fixing');reviewing=@('integrating','fixing');fixing=@('verifying');integrating=@('pushed');pushed=@('closed');closed=@('cleaned');cleaned=@()}
$script:Limits=@{recoveryPrompts=1;writerLaunches=2;reviewRounds=2;reviewerReplacements=1}
$script:OpaquePattern='^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$'
$script:CommitPattern='^commit:[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$'
$script:StateMigrated=$false

function Fail([string]$Message){throw $Message}
function StatePath {
    if($env:BOSS_ISSUE_LOOP_STATE_PATH){return [IO.Path]::GetFullPath($env:BOSS_ISSUE_LOOP_STATE_PATH)}
    $g=(& git rev-parse --git-path boss-issue-loop 2>$null).Trim()
    if(!$g){Fail 'Unable to resolve Git metadata path.'}
    return [IO.Path]::Combine($g,'run-state.json')
}
function HistoryPath([object]$State){
    return [IO.Path]::Combine((Split-Path -Parent (StatePath)),'history',("{0}-{1}.json" -f $State.issue,$State.revision))
}
function Read-JsonFile([string]$Path){
    if(!(Test-Path -LiteralPath $Path)){return $null}
    try{return (Get-Content -Raw -LiteralPath $Path|ConvertFrom-Json -ErrorAction Stop)}catch{Fail 'Run-state file is unreadable or malformed.'}
}
function Read-State{return Read-JsonFile (StatePath)}
function Ensure-Property($State,[string]$Name,$Value){$property=$State.PSObject.Properties[$Name];if($null -eq $property -or $null -eq $property.Value){if($null -eq $property){$State|Add-Member -NotePropertyName $Name -NotePropertyValue $Value}else{$State.$Name=$Value}}}
function Ensure-StateShape($State){
    if($null -eq $State){return $null}
    $schema=$State.PSObject.Properties['schemaVersion'];$script:StateMigrated=$null -eq $schema -or [int]$schema.Value -lt 2
    if($script:StateMigrated){if($null -eq $schema){$State|Add-Member -NotePropertyName schemaVersion -NotePropertyValue 2}else{$State.schemaVersion=2}}
    Ensure-Property $State 'remoteStates' @();Ensure-Property $State 'activeResources' @();Ensure-Property $State 'resourceEvents' @();Ensure-Property $State 'permissionReconciliationIds' @()
    Ensure-Property $State 'degraded' ($State.outcome -eq 'degraded');Ensure-Property $State 'noNewAgents' ($State.outcome -eq 'degraded');return $State
}
function Write-JsonFile([string]$Path,$State){
    $dir=Split-Path -Parent $Path;New-Item -ItemType Directory -Force -Path $dir|Out-Null
    $tmp="$Path.$([guid]::NewGuid().ToString('N')).tmp"
    try{[IO.File]::WriteAllText($tmp,($State|ConvertTo-Json -Depth 8 -Compress),(New-Object Text.UTF8Encoding($false)));Move-Item -LiteralPath $tmp -Destination $Path -Force|Out-Null}
    finally{if(Test-Path -LiteralPath $tmp){Remove-Item -LiteralPath $tmp -Force}}
}
function Write-State($State){Write-JsonFile (StatePath) $State}
function Out-State($State){$State|ConvertTo-Json -Depth 8 -Compress}
function New-State{param([int]$N,[string]$B,[string]$W);[pscustomobject]@{
    schemaVersion=2;issue=$N;workspace=$W;acceptedBase=$B;phase='selected';outcome=$null;revision=0
    budgets=[pscustomobject]@{recoveryPrompts=0;writerLaunches=0;reviewRounds=0;reviewerReplacements=0}
    verified=$false;reviewed=$false;preserved=$false;preservedCommit=$null;fixedPointCommit=$null
    preservationEvidence=$null;observations=@();remoteStates=@();activeResources=@();resourceEvents=@();permissionAttempts=0;handledPermissionIds=@();permissionReconciliationIds=@();degraded=$false;noNewAgents=$false
}}
function Ensure-Identity($State){
    if($null -eq $State){Fail 'No run state exists. Use init first.'}
    if($Issue -and $State.issue -ne $Issue){Fail 'A different issue already owns the persisted run state.'}
    if($Workspace -and $State.workspace -ne $Workspace){Fail 'A different workspace already owns the persisted run state.'}
}
function Save-Changed($State){$State.revision=[int]$State.revision+1;Write-State $State;Out-State $State}
function Add-Unique([object]$State,[string]$Property,[string]$Value){
    $values=@($State.$Property)
    if($values -contains $Value){return $false}
    $State.$Property=@($values+$Value);return $true
}
function Validate-Opaque([string]$Identifier,[string]$Label){if([string]::IsNullOrWhiteSpace($Identifier) -or $Identifier -notmatch $script:OpaquePattern){Fail "$Label must be 1-64 safe opaque characters."}}
function Parse-Commit([string]$Text,[string]$Label){
    if([string]::IsNullOrWhiteSpace($Text) -or $Text -notmatch $script:CommitPattern){Fail "$Label must match commit:<1-64 safe identifier characters>."}
    return $Text.Substring(7)
}
function Transition-State($State,[string]$Target){
    if($script:Phases -notcontains $Target){Fail "Invalid phase '$Target'."}
    if($State.phase -eq $Target){return $false}
    if($State.outcome){Fail 'Terminal outcome prevents further transitions.'}
    if(@($script:Next[$State.phase])-notcontains $Target){Fail "Invalid transition $($State.phase) -> $Target."}
    if($Target -eq 'reviewing' -and !$State.verified){Fail 'Reviewing requires recorded verification.'}
    if($Target -eq 'integrating' -and (!$State.verified -or !$State.reviewed)){Fail 'Integrating requires verification and review.'}
    if($Target -eq 'cleaned' -and !$State.preserved){Fail 'Cleanup requires preservation.'}
    $State.phase=$Target;return $true
}
function Set-Outcome($State,[string]$NewOutcome){
    if($NewOutcome -eq 'complete' -and ($State.phase -ne 'cleaned' -or !$State.verified -or !$State.reviewed -or !$State.preserved)){Fail 'Complete requires cleaned phase, verification, approved review, and preservation.'}
    if($State.outcome -and $State.outcome -ne $NewOutcome){Fail 'Conflicting terminal outcome.'}
    if($State.outcome -eq $NewOutcome){return $false};$State.outcome=$NewOutcome;if($NewOutcome -eq 'degraded'){$State.degraded=$true;$State.noNewAgents=$true};return $true
}
function Parse-Resource([string]$Text){
    if([string]::IsNullOrWhiteSpace($Text) -or $Text -notmatch '^(agent|workspace):([A-Za-z0-9][A-Za-z0-9._:/-]{0,63}):(active|archived)$'){Fail 'Resource must match agent|workspace:<opaque-id>:active|archived.'}
    return [pscustomobject]@{key="$($Matches[1]):$($Matches[2])";state=$Matches[3];value=$Text}
}
function Set-Degraded($State){if($State.outcome -and $State.outcome -ne 'degraded'){Fail 'Terminal outcome prevents degradation.'};$changed=(-not $State.degraded -or -not $State.noNewAgents -or $State.outcome -ne 'degraded');$State.degraded=$true;$State.noNewAgents=$true;$State.outcome='degraded';return $changed}
function Archive-And-Initialize($Previous){
    $history=HistoryPath $Previous
    $n=0;while(Test-Path -LiteralPath $history){$n++;$history=[IO.Path]::Combine((Split-Path -Parent (StatePath)),'history',("{0}-{1}-{2}.json" -f $Previous.issue,$Previous.revision,$n))}
    Write-JsonFile $history $Previous
    $new=New-State $Issue $Base $Workspace;Write-State $new;return $new
}
function Main{
    $State=Ensure-StateShape (Read-State);if($script:StateMigrated){Write-State $State}
    switch($Command){
        'init' {
            if($Issue -le 0 -or [string]::IsNullOrWhiteSpace($Base) -or [string]::IsNullOrWhiteSpace($Workspace)){Fail 'init requires -Issue, -Base, and -Workspace.'}
            if($null -eq $State){$State=New-State $Issue $Base $Workspace;Write-State $State;return Out-State $State}
            if($State.issue -eq $Issue -and $State.workspace -eq $Workspace){if($State.acceptedBase -ne $Base){Fail 'Accepted base conflicts with the existing run state.'};return Out-State $State}
            if($State.phase -ne 'cleaned' -or $State.outcome -ne 'complete'){Fail 'A different issue cannot claim the active run state before clean completion.'}
            return Out-State (Archive-And-Initialize $State)
        }
        'get'{Ensure-Identity $State;return Out-State $State}
        'transition'{Ensure-Identity $State;if(!$Phase){Fail 'transition requires -Phase.'};if(Transition-State $State $Phase){return Save-Changed $State};return Out-State $State}
        'record'{
            Ensure-Identity $State
            if(!$Kind){Fail 'record requires -Kind.'};if(!$Value){Fail 'record requires -Value.'}
            $changed=$false
            switch($Kind){
                'verification'{if($Value -ne 'passed'){Fail 'Verification result must be passed.'};$changed=-not $State.verified;$State.verified=$true}
                'review'{if($Value -ne 'approved'){Fail 'Review result must be approved.'};if($State.degraded -and !$State.reviewed){Fail 'Degraded mode cannot approve an unmet review gate.'};$changed=-not $State.reviewed;$State.reviewed=$true}
                'preservation'{$commit=Parse-Commit $Value 'Preservation';if($State.preservedCommit -and $State.preservedCommit -ne $commit){Fail 'Preservation commit conflicts with the recorded commit.'};$changed=(-not $State.preserved -or $State.preservedCommit -ne $commit);$State.preserved=$true;$State.preservedCommit=$commit;$State.preservationEvidence=$commit}
                'fixedPoint'{$commit=Parse-Commit $Value 'Fixed-point';if($State.fixedPointCommit -and $State.fixedPointCommit -ne $commit){Fail 'Fixed-point commit conflicts with the recorded commit.'};$changed=$State.fixedPointCommit -ne $commit;$State.fixedPointCommit=$commit}
                'remote'{if($Value-notin @('push-attempted','push-observed','comment-attempted','comment-observed','closure-attempted','closure-observed','cleanup-attempted','cleanup-observed')){Fail 'Remote result must be an attempted or observed mutation.'};if($State.degraded -and !$State.reviewed -and $Value -in @('push-attempted','push-observed','comment-attempted','comment-observed','closure-attempted','closure-observed')){Fail 'Degraded mode cannot perform remote work before independent review.'};if($Value -like 'cleanup-*' -and (!$State.preserved -or @($State.activeResources).Count -gt 0)){Fail 'Cleanup requires preservation and zero active issue resources.'};$changed=Add-Unique $State 'remoteStates' $Value;if($Value -like '*-observed'){$changed=(Add-Unique $State 'observations' $Value) -or $changed}}
                'resource'{$resource=Parse-Resource $Value;$active=@($State.activeResources);$eventValues=@($State.resourceEvents);if($resource.state -eq 'active' -and $active -contains $resource.key){return Out-State $State};if($resource.state -eq 'archived' -and $eventValues -contains $resource.value){return Out-State $State};if($resource.state -eq 'active' -and $State.noNewAgents){Fail 'Degraded mode blocks new active resources.'};if($resource.state -eq 'archived' -and $active -notcontains $resource.key){Fail 'Resource must be active before it can be archived.'};if($resource.state -eq 'active'){$State.activeResources=@($active+$resource.key)}else{$State.activeResources=@($active|Where-Object {$_ -ne $resource.key})};$State.resourceEvents=@($eventValues+$resource.value);$changed=$true}
                default{Fail "Unsupported record kind '$Kind'."}
            }
            if($changed){return Save-Changed $State};return Out-State $State
        }
        'consume'{Ensure-Identity $State;if(!$Budget){Fail 'consume requires -Budget.'};if($State.noNewAgents -and $Budget -in @('writerLaunches','reviewRounds','reviewerReplacements')){Fail 'Degraded mode blocks additional agent launches.'};$n=[int]$State.budgets.$Budget;if($n -ge $script:Limits[$Budget]){Fail "Budget exceeded for $Budget."};$State.budgets.$Budget=$n+1;return Save-Changed $State}
        'permission'{Ensure-Identity $State;if($State.outcome){Fail 'Terminal outcome prevents permission handling.'};Validate-Opaque $PermissionId 'Permission identifier';if(@($State.handledPermissionIds)-contains $PermissionId){Fail 'Permission identifier was already handled.'};$State.permissionAttempts=[int]$State.permissionAttempts+1;[void](Add-Unique $State 'handledPermissionIds' $PermissionId);if($PermissionMode -in @('recursive','superseding')){[void](Set-Degraded $State)};return Save-Changed $State}
        'outcome'{Ensure-Identity $State;if(!$Status){Fail 'outcome requires -Status.'};if(Set-Outcome $State $Status){return Save-Changed $State};return Out-State $State}
        'reconcile'{Ensure-Identity $State;if(!$Value){Fail 'reconcile requires -Value.'};if($PermissionId){if($Value -ne 'permission-status'){Fail 'Permission reconciliation value must be permission-status.'};Validate-Opaque $PermissionId 'Permission identifier';if(@($State.handledPermissionIds)-notcontains $PermissionId){Fail 'Permission identifier must be handled before reconciliation.'};if(@($State.permissionReconciliationIds)-contains $PermissionId){return Out-State $State};[void](Add-Unique $State 'permissionReconciliationIds' $PermissionId);return Save-Changed $State};if($Value -in @('complete','blocked','degraded')){if(Set-Outcome $State $Value){return Save-Changed $State};return Out-State $State};$m=@{implementation='implementing';verification='verifying';review='reviewing';fix='fixing';integration='integrating';push='pushed';closure='closed';cleanup='cleaned'};if(!$m.ContainsKey($Value)){Fail "Unknown reconciliation observation '$Value'."};$newObservation=Add-Unique $State 'observations' $Value;$Target=$m[$Value];$flagsChanged=$false;if($Target -eq 'verifying' -and !$State.verified){$State.verified=$true;$flagsChanged=$true};if($Target -eq 'reviewing' -and !$State.reviewed){$State.verified=$true;$State.reviewed=$true;$flagsChanged=$true};$phaseChanged=Transition-State $State $Target;if($phaseChanged -or $newObservation -or $flagsChanged){return Save-Changed $State};return Out-State $State}
    }
}
try{Main}catch{[Console]::Error.WriteLine((ConvertTo-Json -Compress @{status='error';error=$_.Exception.Message}));exit 1}
