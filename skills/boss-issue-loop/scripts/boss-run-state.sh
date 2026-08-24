#!/usr/bin/env bash
set -euo pipefail
# Uses Python's standard library so jq is not required.
exec python - "$@" <<'PY'
import argparse,json,os,pathlib,re,subprocess,sys,tempfile
PHASES=['selected','implementing','verifying','reviewing','fixing','integrating','pushed','closed','cleaned']
NEXT={'selected':['implementing'],'implementing':['verifying'],'verifying':['reviewing','fixing'],'reviewing':['integrating','fixing'],'fixing':['verifying'],'integrating':['pushed'],'pushed':['closed'],'closed':['cleaned'],'cleaned':[]}
LIMITS={'recoveryPrompts':1,'writerLaunches':2,'reviewRounds':2,'reviewerReplacements':1}
OPAQUE=re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$')
COMMIT=re.compile(r'^commit:[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$')
def fail(s): raise ValueError(s)
def path():
    if os.environ.get('BOSS_ISSUE_LOOP_STATE_PATH'): return pathlib.Path(os.environ['BOSS_ISSUE_LOOP_STATE_PATH']).resolve()
    return pathlib.Path(subprocess.check_output(['git','rev-parse','--git-path','boss-issue-loop'],text=True).strip())/'run-state.json'
def read_file(p):
    if not p.exists(): return None
    try:return json.loads(p.read_text(encoding='utf-8'))
    except Exception:fail('Run-state file is unreadable or malformed.')
def read():
    s=read_file(path())
    if s is not None:
        migrated=int(s.get('schemaVersion',1))<2
        s.setdefault('remoteStates',[]);s.setdefault('activeResources',[]);s.setdefault('resourceEvents',[]);s.setdefault('permissionReconciliationIds',[])
        s.setdefault('degraded',s.get('outcome')=='degraded');s.setdefault('noNewAgents',s.get('outcome')=='degraded')
        if migrated:s['schemaVersion']=2;write(s)
    return s
def write_file(p,s):
    p.parent.mkdir(parents=True,exist_ok=True);fd,t=tempfile.mkstemp(prefix=p.name+'.',suffix='.tmp',dir=p.parent);os.close(fd)
    try:pathlib.Path(t).write_text(json.dumps(s,separators=(',',':'))+'\n',encoding='utf-8');os.replace(t,p)
    finally:
        try:os.unlink(t)
        except FileNotFoundError:pass
def write(s):write_file(path(),s)
def out(s):print(json.dumps(s,separators=(',',':')))
def identity(s,a):
    if s is None:fail('No run state exists. Use init first.')
    if a.get('issue') and s['issue']!=a['issue']:fail('A different issue already owns the persisted run state.')
    if a.get('workspace') and s['workspace']!=a['workspace']:fail('A different workspace already owns the persisted run state.')
def save(s):s['revision']+=1;write(s);out(s)
def add_unique(s,key,value):
    if value in s[key]:return False
    s[key].append(value);return True
def validate_opaque(v,label):
    if not v or not OPAQUE.fullmatch(v):fail(f'{label} must be 1-64 safe opaque characters.')
def parse_commit(v,label):
    if not v or not COMMIT.fullmatch(v):fail(f'{label} must match commit:<1-64 safe identifier characters>.')
    return v[7:]
def parse_resource(v):
    m=re.fullmatch(r'(agent|workspace):([A-Za-z0-9][A-Za-z0-9._:/-]{0,63}):(active|archived)',v or '')
    if not m:fail('Resource must match agent|workspace:<opaque-id>:active|archived.')
    return f'{m.group(1)}:{m.group(2)}',m.group(3),v
def transition(s,t):
    if t not in PHASES:fail(f"Invalid phase '{t}'.")
    if s['phase']==t:return False
    if s['outcome']:fail('Terminal outcome prevents further transitions.')
    if t not in NEXT[s['phase']]:fail(f"Invalid transition {s['phase']} -> {t}.")
    if t=='reviewing' and not s['verified']:fail('Reviewing requires recorded verification.')
    if t=='integrating' and not(s['verified'] and s['reviewed']):fail('Integrating requires verification and review.')
    if t=='cleaned' and not s['preserved']:fail('Cleanup requires preservation.')
    s['phase']=t;return True
def set_outcome(s,v):
    if v=='complete' and (s['phase']!='cleaned' or not s['verified'] or not s['reviewed'] or not s['preserved']):fail('Complete requires cleaned phase, verification, approved review, and preservation.')
    if s['outcome'] and s['outcome']!=v:fail('Conflicting terminal outcome.')
    if s['outcome']==v:return False
    s['outcome']=v
    if v=='degraded': s['degraded']=True;s['noNewAgents']=True
    return True
def set_degraded(s):
    if s['outcome'] and s['outcome']!='degraded':fail('Terminal outcome prevents degradation.')
    changed=not s['degraded'] or not s['noNewAgents'] or s['outcome']!='degraded'
    s['degraded']=True;s['noNewAgents']=True;s['outcome']='degraded';return changed
def archive_and_init(previous,a):
    base=path().parent/'history';history=base/f"{previous['issue']}-{previous['revision']}.json";n=0
    while history.exists():n+=1;history=base/f"{previous['issue']}-{previous['revision']}-{n}.json"
    write_file(history,previous)
    s=new_state(a.issue,a.base,a.workspace);write(s);return s
def new_state(issue,base,workspace):
    return {'schemaVersion':2,'issue':issue,'workspace':workspace,'acceptedBase':base,'phase':'selected','outcome':None,'revision':0,'budgets':{k:0 for k in LIMITS},'verified':False,'reviewed':False,'preserved':False,'preservedCommit':None,'fixedPointCommit':None,'preservationEvidence':None,'observations':[],'remoteStates':[],'activeResources':[],'resourceEvents':[],'permissionAttempts':0,'handledPermissionIds':[],'permissionReconciliationIds':[],'degraded':False,'noNewAgents':False}
def main(a):
    s=read()
    if a.command=='init':
        if a.issue<=0 or not a.base or not a.workspace:fail('init requires --issue, --base, and --workspace.')
        if s is None:s=new_state(a.issue,a.base,a.workspace);write(s);return out(s)
        if s['issue']==a.issue and s['workspace']==a.workspace:
            if s['acceptedBase']!=a.base:fail('Accepted base conflicts with the existing run state.')
            return out(s)
        if s['phase']!='cleaned' or s['outcome']!='complete':fail('A different issue cannot claim the active run state before clean completion.')
        return out(archive_and_init(s,a))
    identity(s,vars(a))
    if a.command=='get':return out(s)
    if a.command=='transition':
        if not a.phase:fail('transition requires --phase.')
        return save(s) if transition(s,a.phase) else out(s)
    if a.command=='record':
        if not a.kind:fail('record requires --kind.')
        if not a.value:fail('record requires --value.')
        changed=False
        if a.kind=='verification':
            if a.value!='passed':fail('Verification result must be passed.')
            changed=not s['verified'];s['verified']=True
        elif a.kind=='review':
            if a.value!='approved':fail('Review result must be approved.')
            if s['degraded'] and not s['reviewed']:fail('Degraded mode cannot approve an unmet review gate.')
            changed=not s['reviewed'];s['reviewed']=True
        elif a.kind=='preservation':
            c=parse_commit(a.value,'Preservation')
            if s['preservedCommit'] and s['preservedCommit']!=c:fail('Preservation commit conflicts with the recorded commit.')
            changed=not s['preserved'] or s['preservedCommit']!=c;s['preserved']=True;s['preservedCommit']=c;s['preservationEvidence']=c
        elif a.kind=='fixedPoint':
            c=parse_commit(a.value,'Fixed-point')
            if s['fixedPointCommit'] and s['fixedPointCommit']!=c:fail('Fixed-point commit conflicts with the recorded commit.')
            changed=s['fixedPointCommit']!=c;s['fixedPointCommit']=c
        elif a.kind=='remote':
            if a.value not in ('push-attempted','push-observed','comment-attempted','comment-observed','closure-attempted','closure-observed','cleanup-attempted','cleanup-observed'):fail('Remote result must be an attempted or observed mutation.')
            if s['degraded'] and not s['reviewed'] and a.value in ('push-attempted','push-observed','comment-attempted','comment-observed','closure-attempted','closure-observed'):fail('Degraded mode cannot perform remote work before independent review.')
            if a.value.startswith('cleanup-') and (not s['preserved'] or s['activeResources']):fail('Cleanup requires preservation and zero active issue resources.')
            changed=add_unique(s,'remoteStates',a.value)
            if a.value.endswith('-observed'): changed=add_unique(s,'observations',a.value) or changed
        elif a.kind=='resource':
            key,state,value=parse_resource(a.value)
            if state=='active' and key in s['activeResources']:return out(s)
            if state=='archived' and value in s['resourceEvents']:return out(s)
            if state=='active' and s['noNewAgents']:fail('Degraded mode blocks new active resources.')
            if state=='archived' and key not in s['activeResources']:fail('Resource must be active before it can be archived.')
            if state=='active':s['activeResources'].append(key)
            else:s['activeResources'].remove(key)
            s['resourceEvents'].append(value);changed=True
        else:fail(f"Unsupported record kind '{a.kind}'.")
        return save(s) if changed else out(s)
    if a.command=='consume':
        if a.budget not in LIMITS:fail('consume requires --budget.')
        if s['noNewAgents'] and a.budget in ('writerLaunches','reviewRounds','reviewerReplacements'):fail('Degraded mode blocks additional agent launches.')
        if s['budgets'][a.budget]>=LIMITS[a.budget]:fail(f'Budget exceeded for {a.budget}.')
        s['budgets'][a.budget]+=1;return save(s)
    if a.command=='permission':
        if s['outcome']:fail('Terminal outcome prevents permission handling.')
        validate_opaque(a.permission_id,'Permission identifier')
        if a.permission_id in s['handledPermissionIds']:fail('Permission identifier was already handled.')
        s['permissionAttempts']+=1;s['handledPermissionIds'].append(a.permission_id)
        if a.permission_mode in ('recursive','superseding'): set_degraded(s)
        return save(s)
    if a.command=='outcome':
        if not a.status:fail('outcome requires --status.')
        return save(s) if set_outcome(s,a.status) else out(s)
    if a.command=='reconcile':
        if not a.value:fail('reconcile requires --value.')
        if a.permission_id:
            if a.value!='permission-status':fail('Permission reconciliation value must be permission-status.')
            validate_opaque(a.permission_id,'Permission identifier')
            if a.permission_id not in s['handledPermissionIds']:fail('Permission identifier must be handled before reconciliation.')
            if a.permission_id in s['permissionReconciliationIds']:return out(s)
            s['permissionReconciliationIds'].append(a.permission_id);return save(s)
        if a.value in ('complete','blocked','degraded'):return save(s) if set_outcome(s,a.value) else out(s)
        m={'implementation':'implementing','verification':'verifying','review':'reviewing','fix':'fixing','integration':'integrating','push':'pushed','closure':'closed','cleanup':'cleaned'}
        if a.value not in m:fail(f"Unknown reconciliation observation '{a.value}'.")
        newobs=add_unique(s,'observations',a.value);t=m[a.value];flags=False
        if t=='verifying' and not s['verified']:s['verified']=True;flags=True
        if t=='reviewing' and not s['reviewed']:s['verified']=True;s['reviewed']=True;flags=True
        phase=transition(s,t);return save(s) if phase or newobs or flags else out(s)
    fail('Unknown command.')
p=argparse.ArgumentParser();p.add_argument('command',choices=['init','get','transition','record','consume','permission','reconcile','outcome']);p.add_argument('--issue',type=int,default=0);p.add_argument('--base');p.add_argument('--workspace');p.add_argument('--phase');p.add_argument('--kind',choices=['verification','review','preservation','fixedPoint','remote','resource']);p.add_argument('--value');p.add_argument('--permission-id');p.add_argument('--permission-mode',choices=['normal','recursive','superseding'],default='normal');p.add_argument('--budget',choices=list(LIMITS));p.add_argument('--status',choices=['complete','blocked','degraded']);a=p.parse_args()
try:main(a)
except Exception as e:print(json.dumps({'status':'error','error':str(e)},separators=(',',':')),file=sys.stderr);sys.exit(1)
PY
