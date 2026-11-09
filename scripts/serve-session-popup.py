#!/usr/bin/env python3
"""Native session-channel and popup redirect fixture with network evidence."""
import argparse,json,threading,time
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,required=True);p.add_argument('--port',type=int,default=18976);p.add_argument('--reuse',action='store_true');a=p.parse_args()
r=a.root.resolve();r.mkdir(parents=True,exist_ok=a.reuse);profile=r/'profile';(profile/'config').mkdir(parents=True,exist_ok=a.reuse)
if not a.reuse:(profile/'config/Settings.json').write_text(json.dumps({'firstRunComplete':True,'restorePreviousSession':False,'backgroundNetworking':{'enabled':False},'contentBlockers':{'enabled':True,'builtInLists':{'easyList':False,'easyPrivacy':False},'customFilters':'/popup-denied$popup\n'}}))
lock=threading.Lock()
def record(value):
 with lock,(r/'events.jsonl').open('a') as f:f.write(json.dumps({'time':time.time(),**value})+'\n')
page='''<!doctype html><meta charset=utf-8><title>Session and popup acceptance</title><style>body{font:22px monospace;background:#171923;color:#eee;padding:24px}button{font:inherit;padding:14px;margin:8px}pre{white-space:pre-wrap}</style><h1>Session / popup acceptance</h1><button id=allowed>Allowed redirect popup</button><button id=denied>Blocked redirect popup</button><pre id=state></pre><script>
const context=location.pathname.slice(1)||'opener',seen=new Set();
const report=(name,value)=>fetch('/report',{method:'POST',body:JSON.stringify({context,host:location.hostname,name,value})});
console.log('POPUP-PROCESS:'+location.hostname+':'+context);
report('loaded',location.href);
for(const mode of ['allowed','denied'])document.getElementById(mode).onclick=()=>{const popup=window.open('/jump/'+mode,'_blank');report('opened',{mode,returned:!!popup})};
if(context.startsWith('regular')||context.startsWith('private')){
 const channel=new BroadcastChannel('derpbird-session-acceptance');
 channel.onmessage=event=>{seen.add(event.data);document.getElementById('state').textContent=JSON.stringify({context,received:[...seen]},null,2);report('broadcast-received',event.data)};
 setInterval(()=>channel.postMessage(context),1000);
}
</script>'''.encode()
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  record({'request':self.path,'host':self.headers.get('Host')})
  if self.path.startswith('/worker-'):
   marker=self.path.split('?')[0]
   body=("self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));self.addEventListener('fetch',event=>{if(new URL(event.request.url).pathname==='/sw-probe')event.respondWith(Promise.resolve(new Response("+json.dumps(marker)+")))})").encode()
   self.send_response(200);self.send_header('Content-Type','application/javascript');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);return
  if self.path.startswith('/jump/') or self.path.startswith('/second/'):
   mode=self.path.rsplit('/',1)[-1];first=self.path.startswith('/jump/')
   location=f'http://localhost:{a.port}/second/{mode}' if first else '/popup-'+mode
   self.send_response(302 if first else 307);self.send_header('Location',location);self.send_header('Content-Length','0');self.end_headers();return
  self.send_response(200);self.send_header('Content-Type','text/html');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(page)));self.end_headers();self.wfile.write(page)
 def do_POST(self):
  size=int(self.headers.get('Content-Length','0'))
  if not 0<size<=65536:self.send_error(400);return
  record({'report':json.loads(self.rfile.read(size))});self.send_response(204);self.end_headers()
print(json.dumps({'url':f'http://127.0.0.1:{a.port}/opener','profile':str(profile)}),flush=True)
ThreadingHTTPServer(('127.0.0.1',a.port),Handler).serve_forever()
