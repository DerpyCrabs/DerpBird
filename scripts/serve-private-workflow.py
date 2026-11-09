#!/usr/bin/env python3
"""Loopback fixture for browser-session isolation; records synthetic markers only."""
import argparse,json,threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=18960);p.add_argument('--report',type=Path,required=True);a=p.parse_args()
lock=threading.Lock()
page='''<!doctype html><meta charset="utf-8"><title>Session isolation</title><style>body{background:#181b25;color:white;font:20px monospace;padding:32px}pre{white-space:pre-wrap}</style><h1>Session isolation</h1><pre id="result">Loading</pre><script>
(async()=>{
 const q=new URL(location.href).searchParams,key='derpbird-isolation';
 const snapshot=()=>({cookie:document.cookie.split('; ').find(v=>v.startsWith(key+'='))||null,local:localStorage.getItem(key),session:sessionStorage.getItem(key)});
 const before=snapshot();if(q.has('write')){const value=q.get('write');document.cookie=key+'='+encodeURIComponent(value)+'; Path=/; SameSite=Lax';localStorage.setItem(key,value);sessionStorage.setItem(key,value);}
 const data={phase:q.get('phase'),before,after:snapshot()};document.getElementById('result').textContent=JSON.stringify(data,null,2);
 await fetch('/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
})().catch(e=>document.getElementById('result').textContent='ERROR: '+e);
</script>'''.encode()
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  self.send_response(200);self.send_header('Content-Type','text/html;charset=utf-8');self.send_header('Content-Length',str(len(page)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(page)
 def do_POST(self):
  size=int(self.headers.get('Content-Length','0'))
  if self.path!='/report' or not 0<size<=4096:self.send_error(400);return
  data=json.loads(self.rfile.read(size));data['requestCookie']=next((v for v in self.headers.get('Cookie','').split('; ') if v.startswith('derpbird-isolation=')),None)
  with lock:
   with a.report.open('a') as f:f.write(json.dumps(data)+'\n')
  self.send_response(204);self.end_headers()
ThreadingHTTPServer(('127.0.0.1',a.port),Handler).serve_forever()
