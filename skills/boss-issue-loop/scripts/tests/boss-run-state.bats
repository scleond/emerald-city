#!/usr/bin/env bats
setup(){ export BOSS_ISSUE_LOOP_STATE_PATH="$BATS_TEST_TMPDIR/state.json"; S="$BATS_TEST_DIRNAME/../boss-run-state.sh"; }
state(){ python -c "import json;print(json.load(open('$BOSS_ISSUE_LOOP_STATE_PATH'))$1)"; }
@test "permission IDs, fixed point, preservation, and replay are normalized" {
 "$S" init --issue 68 --base cef0eb4 --workspace wks_efb12a6555c49024 >/dev/null
 "$S" permission --permission-id req-1 >/dev/null; "$S" permission --permission-id req-2 >/dev/null
 run "$S" permission --permission-id req-1; [ "$status" -ne 0 ]
 "$S" record --kind fixedPoint --value commit:abc123 >/dev/null; "$S" record --kind preservation --value commit:def456 >/dev/null
 "$S" transition --phase implementing >/dev/null; "$S" transition --phase verifying >/dev/null; "$S" record --kind verification --value passed >/dev/null; "$S" transition --phase reviewing >/dev/null; "$S" record --kind review --value approved >/dev/null; "$S" transition --phase integrating >/dev/null; "$S" transition --phase pushed >/dev/null
 "$S" reconcile --value push >/dev/null; rev="$(state "['revision']")"; "$S" reconcile --value push >/dev/null; [ "$(state "['revision']")" = "$rev" ]
 "$S" transition --phase closed >/dev/null; "$S" reconcile --value closure >/dev/null; rev="$(state "['revision']")"; "$S" reconcile --value closure >/dev/null; [ "$(state "['revision']")" = "$rev" ]
 [ "$(state "['fixedPointCommit']")" = abc123 ]; [ "$(state "['preservedCommit']")" = def456 ]; [ "$(state "['permissionAttempts']")" = 2 ]
}
@test "missing kind/value and lifecycle/commit rejection paths" {
 "$S" init --issue 68 --base base --workspace ws >/dev/null
 run "$S" record --value passed; [ "$status" -ne 0 ]; run "$S" record --kind verification; [ "$status" -ne 0 ]
 run "$S" transition --phase reviewing; [ "$status" -ne 0 ]; run "$S" transition --phase cleaned; [ "$status" -ne 0 ]
 run "$S" record --kind preservation --value 'commit:bad value'; [ "$status" -ne 0 ]; run "$S" record --kind fixedPoint --value commit:; [ "$status" -ne 0 ]
 run "$S" outcome --status complete; [ "$status" -ne 0 ]
}
@test "completed ledger is retired before next issue" {
 "$S" init --issue 68 --base base --workspace ws >/dev/null; "$S" transition --phase implementing >/dev/null; "$S" transition --phase verifying >/dev/null; "$S" record --kind verification --value passed >/dev/null; "$S" transition --phase reviewing >/dev/null; "$S" record --kind review --value approved >/dev/null; "$S" record --kind preservation --value commit:abc123 >/dev/null; "$S" transition --phase integrating >/dev/null; "$S" transition --phase pushed >/dev/null; "$S" transition --phase closed >/dev/null; "$S" transition --phase cleaned >/dev/null; "$S" outcome --status complete >/dev/null
 "$S" init --issue 69 --base nextbase --workspace ws >/dev/null; [ "$(state "['issue']")" = 69 ]; test "$(find "$(dirname "$BOSS_ISSUE_LOOP_STATE_PATH")/history" -name '*.json' | wc -l)" -eq 1
}
@test "recursive permission degrades once and prevents subsequent launches" {
 "$S" init --issue 69 --base base --workspace ws >/dev/null
 "$S" permission --permission-id req-recursive --permission-mode recursive >/dev/null
 [ "$(state "['outcome']")" = degraded ]; [ "$(state "['noNewAgents']")" = True ]; [ "$(state "['permissionAttempts']")" = 1 ]
 run "$S" consume --budget writerLaunches; [ "$status" -ne 0 ]; run "$S" consume --budget reviewRounds; [ "$status" -ne 0 ]
 run "$S" permission --permission-id req-recursive --permission-mode recursive; [ "$status" -ne 0 ]
 "$S" reconcile --permission-id req-recursive --value permission-status >/dev/null; rev="$(state "['revision']")"; "$S" reconcile --permission-id req-recursive --value permission-status >/dev/null; [ "$(state "['revision']")" = "$rev" ]
}
@test "remote attempts and observations are distinct and replay-safe" {
 "$S" init --issue 69 --base base --workspace ws >/dev/null
 "$S" record --kind remote --value push-attempted >/dev/null; rev="$(state "['revision']")"; "$S" record --kind remote --value push-attempted >/dev/null; [ "$(state "['revision']")" = "$rev" ]
 "$S" record --kind remote --value push-observed >/dev/null; "$S" record --kind remote --value comment-attempted >/dev/null; "$S" record --kind remote --value comment-observed >/dev/null; "$S" record --kind remote --value cleanup-attempted >/dev/null; "$S" record --kind remote --value cleanup-observed >/dev/null; [ "$(state "['remoteStates']" | wc -l)" -ge 1 ]
}
@test "fresh low-risk path permits bounded writer and reviewer launches" {
 "$S" init --issue 69 --base base --workspace ws >/dev/null; "$S" consume --budget writerLaunches >/dev/null; "$S" consume --budget reviewRounds >/dev/null
 [ "$(state "['budgets']['writerLaunches']")" = 1 ]; [ "$(state "['budgets']['reviewRounds']")" = 1 ]; [ "$(state "['noNewAgents']")" = False ]
}
@test "terminal outcomes reject permission mutation without revision changes" {
 "$S" init --issue 69 --base base --workspace ws >/dev/null; "$S" outcome --status blocked >/dev/null; rev="$(state "['revision']")"
 run "$S" permission --permission-id after-blocked; [ "$status" -ne 0 ]; run "$S" permission --permission-id recursive-after-blocked --permission-mode recursive; [ "$status" -ne 0 ]; [ "$(state "['revision']")" = "$rev" ]; [ "$(state "['outcome']")" = blocked ]
}
@test "degraded mode preserves recovery prompt but blocks review approval, launches, remote work, and new resources" {
 "$S" init --issue 69 --base base --workspace ws >/dev/null; "$S" permission --permission-id superseding-one --permission-mode superseding >/dev/null
 run "$S" record --kind review --value approved; [ "$status" -ne 0 ]; "$S" consume --budget recoveryPrompts >/dev/null
 run "$S" consume --budget writerLaunches; [ "$status" -ne 0 ]; run "$S" consume --budget reviewRounds; [ "$status" -ne 0 ]; run "$S" consume --budget reviewerReplacements; [ "$status" -ne 0 ]
 run "$S" record --kind resource --value agent:writer-1:active; [ "$status" -ne 0 ]; run "$S" record --kind remote --value push-attempted; [ "$status" -ne 0 ]; run "$S" record --kind remote --value comment-attempted; [ "$status" -ne 0 ]; run "$S" record --kind remote --value closure-attempted; [ "$status" -ne 0 ]
 "$S" record --kind verification --value passed >/dev/null; "$S" record --kind preservation --value commit:keep-me >/dev/null; run "$S" record --kind remote --value cleanup-observed; [ "$status" -ne 0 ]
}
@test "resource ledger archives reviewers and cleanup requires zero active resources" {
 "$S" init --issue 69 --base base --workspace ws >/dev/null; "$S" consume --budget reviewRounds >/dev/null; "$S" consume --budget reviewRounds >/dev/null; "$S" consume --budget reviewerReplacements >/dev/null
 run "$S" consume --budget reviewRounds; [ "$status" -ne 0 ]; run "$S" consume --budget reviewerReplacements; [ "$status" -ne 0 ]
 "$S" record --kind resource --value agent:reviewer-1:active >/dev/null; "$S" record --kind resource --value workspace:review-ws:active >/dev/null; run "$S" record --kind remote --value cleanup-observed; [ "$status" -ne 0 ]
 "$S" record --kind resource --value agent:reviewer-1:archived >/dev/null; "$S" record --kind resource --value workspace:review-ws:archived >/dev/null; "$S" record --kind preservation --value commit:review-evidence >/dev/null; "$S" record --kind remote --value cleanup-attempted >/dev/null; "$S" record --kind remote --value cleanup-observed >/dev/null
 [ "$(state "['activeResources']" | wc -l)" -eq 0 ]
}
