import hashlib, uuid
from pathlib import Path
import tempfile,subprocess,os,time,json,urllib.request,urllib.error,shutil
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE=shutil.which('node')
if not NODE: raise SystemExit('Node.js is required')
def call(path='api/workbench',body=None,headers=None):
 h={'Origin':'http://127.0.0.1:18772','Content-Type':'application/json'};h.update(headers or {})
 r=urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:18772/'+path,data=json.dumps(body).encode() if body else None,headers=h));return json.load(r)
def start(d):
 p=subprocess.Popen([NODE,'server.mjs'],cwd=ROOT,env={**os.environ,'MAMBA_PORT':'18772','MAMBA_DATA_DIR':d},stdout=subprocess.DEVNULL)
 for i in range(50):
  try: call('health');return p
  except: time.sleep(.1)
 raise Exception('Server not ready')
with tempfile.TemporaryDirectory() as d:
 p=start(d)
 try:
  args={'project':'广告创作','name':'isolated test','notes':'local only','request_id':'local-isolated-test-0001'}
  a=call(body={'action':'create_workbench_task','args':args});assert a['created']
  assert not call(body={'action':'create_workbench_task','args':args})['created']
  u={'id':args['request_id'],'revision':1,'status':'已完成','result':'PASS','request_id':'local-isolated-update-0001'}
  assert call(body={'action':'update_workbench_task','args':u})['task']['revision']==2
  p.terminate();p.wait();p=start(d)
  assert call()['tasks'][0]['result']=='PASS'
  for path,headers in [('api/workbench',{'Origin':'https://evil.example'}),('api/workbench',{'Host':'evil.example'}),('mcp',{})]:
   try:call(path,headers=headers);raise AssertionError('must reject')
   except urllib.error.HTTPError as e:assert e.code in (403,404)
  chat=call('api/creative/projects/http-test');assert chat['status']=='idle' and chat['revision']==0
  assert call('api/creative/agents')[0]['id']=='codex-local'
  payload={'action':'draft','agentId':'codex-local','revision':0,'requestId':str(uuid.uuid4())}
  for headers,expected in [({},409),({'Origin':'https://evil.example'},403),({'Origin':''},403)]:
   try:call('api/creative/projects/http-test/turn',payload,headers);raise AssertionError('creative gate bypass')
   except urllib.error.HTTPError as e:assert e.code==expected
  assert call('api/creative/projects/http-test')['revision']==0
  print('PASS: creative HTTP routes, same-origin mutation guard and premature draft rejection')
  skills=call('api/skills');assert isinstance(skills['entries'],list) and 'scannedAt' in skills
  assert skills['summary']['allEntries']==len(skills['entries'])
  for path,body,headers in [('api/skills',{'action':'execute'},{}),('api/skills?path=/etc/passwd',None,{}),('api/skills',None,{'Origin':'https://evil.example'}),('api/skills',None,{'Host':'evil.example'})]:
   try:call(path,body=body,headers=headers);raise AssertionError('must reject skill mutation/path/cross-origin access')
   except urllib.error.HTTPError as e:assert e.code in (403,405)
  assert call()['tasks'][0]['result']=='PASS'
  project = "storyboard-test"
  version = str(uuid.uuid4())
  endpoint = f"api/storyboards/{project}/{version}"
  directory = Path(d, "storyboards", hashlib.sha256(project.encode()).hexdigest(), version)
  directory.mkdir(parents=True)
  shot = dict(number=1, file="shot-01.jpg", sha256="fixture", action="纸船", seconds=2, motion="push")
  state = dict(id=version, createdAt=1, status="draft", proposal="纸船", count=2,
               shots=[shot, dict(shot, number=2, file="shot-02.jpg")])
  (directory / "version.json").write_text(json.dumps(state))
  edits = [dict(item, seconds=2.5) for item in state["shots"]]
  for action, payload, status in [
      ("render", {"requested": True}, 409),
      ("confirm", {"shots": [edits[0]]}, 409),
      ("confirm", {"shots": [dict(edits[0], seconds=2.1), edits[1]]}, 400),
  ]:
   try: call(endpoint + "/" + action, payload);raise AssertionError("invalid version change")
   except urllib.error.HTTPError as error: assert error.code == status
  confirmed = call(endpoint + "/confirm", {"shots": edits})
  assert confirmed["confirmedAt"] and confirmed["shots"][0]["seconds"] == 2.5
  assert call(endpoint + "/confirm", {"shots": state["shots"]}) == confirmed
  assert call("api/storyboards/" + project)[0] == confirmed
  print("PASS: rendering requires confirmation, edits validated, confirmed version immutable")
  print('PASS: skills endpoint is read-only, fixed-scope, origin/host guarded, and preserves tasks')
  print('PASS: local HTTP create/update/idempotency, SQLite persistence across restart, origin/host guards, no MCP exposure')
 finally:p.terminate();p.wait()
