#!/usr/bin/env python3
"""Known physical filter lines and cacheable responses for native log attribution."""
import argparse,json,threading,time
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,required=True);p.add_argument('--port',type=int,default=18972);a=p.parse_args();a.root.mkdir(parents=True,exist_ok=False)
profile=a.root/'profile';(profile/'config').mkdir(parents=True);lists=profile/'data/ContentBlocking/Lists';lists.mkdir(parents=True)
filters='! Title: Attribution fixture\n! Physical line padding\n/request-block$xhr\n/response-block$xhr,header=x-attribution:deny\n/cache-transform$xhr,replace=/alpha/beta/g\n/rewrite$removeparam=drop\n'
(lists/'attribution-fixture.txt').write_text(filters);(a.root/'filters.txt').write_text(filters)
(profile/'config/Settings.json').write_text(json.dumps({'firstRunComplete':True,'restorePreviousSession':False,'backgroundNetworking':{'enabled':False},'contentBlockers':{'enabled':True,'builtInLists':{'easyList':False,'easyPrivacy':False},'customSubscriptions':[{'identifier':'attribution-fixture','enabled':True,'url':'https://attribution.invalid/filters.txt','name':'Attribution fixture'}]}}))
lock=threading.Lock()
def record(value):
 with lock,(a.root/'events.jsonl').open('a') as f:f.write(json.dumps({'time':time.time(),**value})+'\n')
page='''<!doctype html><meta charset=utf-8><title>Blocker attribution</title><style>body{background:#171923;color:#eee;font:22px monospace;padding:25px}button{font:inherit;padding:12px}pre{white-space:pre-wrap}</style><h1>Blocker attribution</h1><button id=run>Run request/response/cache batch</button><pre id=result></pre><script>
run.onclick=async()=>{run.disabled=true;const rows=[];const report=async(name,value)=>{rows.push({name,value});result.textContent=JSON.stringify(rows,null,2);await fetch('/report',{method:'POST',body:JSON.stringify({name,value})})};
for(const path of ['/request-block','/response-block']){try{await fetch(path);await report(path,'unexpected success')}catch(e){await report(path,'blocked')}}
for(let i=0;i<2;i++)await report('cache-transform-'+i,await(await fetch('/cache-transform')).text());
await report('rewrite',await(await fetch('/rewrite?drop=secret&keep=yes')).text());await report('done',true)};
</script>'''.encode()
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  size=int(self.headers.get('Content-Length','0'))
  if size>65536:self.send_error(413);return
  record({'report':json.loads(self.rfile.read(size))});self.send_response(204);self.end_headers()
 def do_GET(self):
  record({'request':self.path});path=self.path.split('?',1)[0]
  body=page if path=='/' else b'alpha' if path=='/cache-transform' else self.path.encode()
  self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8' if path=='/' else 'text/plain');self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','public, max-age=3600' if path=='/cache-transform' else 'no-store')
  if path=='/response-block':self.send_header('X-Attribution','deny')
  self.end_headers();self.wfile.write(body)
print(f'http://127.0.0.1:{a.port}/',flush=True)
ThreadingHTTPServer(('127.0.0.1',a.port),Handler).serve_forever()
