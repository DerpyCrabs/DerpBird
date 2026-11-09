#!/usr/bin/env python3
"""Source update redirects/cancellation fixture with independently controlled response delays."""
import argparse,json,subprocess,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--root',required=True,type=Path);p.add_argument('--port',type=int,default=18969)
a=p.parse_args();a.root.mkdir(parents=True,exist_ok=False)
base=f'http://127.0.0.1:{a.port}'
def script(v):return f'// ==UserScript==\n// @name Lifecycle script\n// @version {v}\n// @match {base}/*\n// ==/UserScript==\ndocument.documentElement.dataset.scriptVersion="{v}";'
def style(v):return f'/* ==UserStyle==\n@name Lifecycle style\n@namespace derpbird-test\n@version {v}.0.0\n==/UserStyle== */\nbody {{ color: {"#abcdef" if v==2 else "#eeeeee"}; }}'
metadata=json.loads(subprocess.check_output(['bun','-e',"import {parseUserScript} from './src/browser/user-scripts';console.log(JSON.stringify(parseUserScript(await Bun.stdin.text())));"],input=script(1).encode(),cwd=Path(__file__).resolve().parents[1]))
for name in ('editor','reload','crash'):
 profile=a.root/name
 (profile/'config').mkdir(parents=True);(profile/'data').mkdir()
 (profile/'config/Settings.json').write_text(json.dumps({'firstRunComplete':True,'restorePreviousSession':False,'backgroundNetworking':{'enabled':False}}))
 (profile/'data/DerpBirdScripts.json').write_text(json.dumps({'version':1,'items':[{'id':'lifecycle-script','name':'Lifecycle script','source':script(1),'sourceURL':base+'/redirect/script.user.js','checkUpdates':True,'checkedAt':0,'enabled':True,'fileAccessGranted':False,'metadata':metadata}]}))
 (profile/'data/DerpBirdStyles.json').write_text(json.dumps({'version':1,'items':[{'id':'lifecycle-style','name':'Lifecycle style','source':style(1),'sourceURL':base+'/redirect/style.user.css','checkUpdates':True,'checkedAt':0,'enabled':True,'sections':[{'conditions':[],'css':'body { color: #eeeeee; }'}]}]}))
(a.root/'mode.json').write_text(json.dumps({'slow':['script'],'case':'editor'}))
lock=threading.Lock();sequence=0
def record(data):
 with lock,(a.root/'events.jsonl').open('a') as f:f.write(json.dumps({'time':time.time(),**data})+'\n')
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  global sequence
  with lock:sequence+=1;request=sequence
  path=self.path.split('?',1)[0];mode=json.loads((a.root/'mode.json').read_text())
  record({'id':request,'path':path,'event':'request','case':mode['case']})
  if path.startswith('/redirect/') or path.startswith('/second/'):
   target=path.replace('/redirect/','/second/').replace('/second/','/final/') if path.startswith('/second/') else path.replace('/redirect/','/second/')
   self.send_response(307 if path.startswith('/second/') else 302);self.send_header('Location',target);self.send_header('Content-Length','0');self.end_headers();return
  source=path.startswith('/final/');kind='script' if path.endswith('.js') else 'style'
  body=(script(2) if kind=='script' else style(2)) if source else '<!doctype html><meta charset=utf-8><title>Source lifecycle</title><style>body{background:#171923;font:24px monospace;padding:25px}</style><h1>Source lifecycle</h1><pre id=state></pre><script>setInterval(()=>{state.textContent=JSON.stringify({script:document.documentElement.dataset.scriptVersion,color:getComputedStyle(document.body).color},null,2)},500)</script>'
  data=body.encode();slow=source and kind in mode['slow'];padding=400 if slow else 0
  self.send_response(200);self.send_header('Content-Type','text/plain; charset=utf-8' if source else 'text/html; charset=utf-8');self.send_header('Content-Length',str(len(data)+padding));self.send_header('Cache-Control','no-store');self.end_headers()
  try:
   for _ in range(padding):self.wfile.write(b' ');self.wfile.flush();time.sleep(.05)
   self.wfile.write(data);self.wfile.flush();record({'id':request,'event':'completed','path':path,'case':mode['case']})
  except (BrokenPipeError,ConnectionResetError):record({'id':request,'event':'disconnected','path':path,'case':mode['case']})
print(base+'/index',flush=True)
ThreadingHTTPServer(('127.0.0.1',a.port),Handler).serve_forever()
