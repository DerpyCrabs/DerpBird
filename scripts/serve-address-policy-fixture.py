#!/usr/bin/env python3
"""Owned loopback HTTP fixture for the complete DNS-to-response policy path."""
import argparse, json, threading, time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--root', type=Path, required=True)
p.add_argument('--port', type=int, default=18951)
a=p.parse_args();a.root.mkdir(parents=True, exist_ok=False)
(a.root/'profile/config').mkdir(parents=True)
rules='''/blocked$xhr,ipaddress=loopback
/query$ipaddress=loopback,removeparam=drop
/header$xhr,ipaddress=loopback,header=x-ad:yes
/body$xhr,ipaddress=loopback,replace=/advert/clean/g
'''
(a.root/'profile/config/Settings.json').write_text(json.dumps({'firstRunComplete':True,'restorePreviousSession':False,'backgroundNetworking':{'enabled':False},'contentBlockers':{'enabled':True,'customFilters':rules}}))
lock=threading.Lock()
def record(value):
 with lock,(a.root/'events.jsonl').open('a') as f:f.write(json.dumps({'time':time.time(),**value})+'\n')
page=b'''<!doctype html><meta charset="utf-8"><title>Address policy</title><h1>Transport address policy</h1><pre id="results">Running</pre><script>
(async()=>{const results=[];const report=async(name,ok,detail)=>{results.push({name,ok,detail});document.querySelector('#results').textContent=JSON.stringify(results,null,2);await fetch('/report',{method:'POST',body:JSON.stringify({name,ok,detail})});};
for(const path of ['/blocked','/header']){let blocked=false;try{await fetch(path)}catch{blocked=true}await report(path,blocked);}
const query=await(await fetch('/query?drop=1&keep=2')).text();await report('removeparam',query==='/query?keep=2',query);
const body=await(await fetch('/body')).text();await report('replacement',body==='clean',body);
const control=await(await fetch('/control')).text();await report('control',control==='advert',control);
await report('complete',results.every(x=>x.ok));})().catch(error=>fetch('/report',{method:'POST',body:JSON.stringify({name:'runtime-error',ok:false,detail:String(error)})}));
</script>'''
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  record({'request':self.path})
  body=page if self.path=='/' else (self.path.encode() if self.path.startswith('/query') else b'advert')
  self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8' if self.path=='/' else 'text/plain; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store')
  if self.path=='/header':self.send_header('X-Ad','yes')
  self.end_headers();self.wfile.write(body)
 def do_POST(self):
  length=int(self.headers.get('Content-Length','0'))
  if self.path!='/report' or not 0<length<=65536:self.send_error(400);return
  try:record(json.loads(self.rfile.read(length)))
  except ValueError:self.send_error(400);return
  self.send_response(204);self.end_headers()
print(f'http://127.0.0.1:{a.port}/',flush=True)
ThreadingHTTPServer(('127.0.0.1',a.port),Handler).serve_forever()
