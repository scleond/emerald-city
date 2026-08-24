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
