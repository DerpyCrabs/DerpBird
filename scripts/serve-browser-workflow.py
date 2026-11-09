#!/usr/bin/env python3
"""Native desktop acceptance pages: navigation, beforeunload and resumable downloads."""
import argparse, html, json, re, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--root',type=Path,required=True)
p.add_argument('--port',type=int,default=18967)
p.add_argument('--reuse',action='store_true')
a=p.parse_args();a.root.mkdir(parents=True,exist_ok=a.reuse)
(a.root/'profile/config').mkdir(parents=True,exist_ok=a.reuse)
if not a.reuse:(a.root/'profile/config/Settings.json').write_text(json.dumps({'firstRunComplete':True,'restorePreviousSession':True,'backgroundNetworking':{'enabled':False}}))
lock=threading.Lock()
def record(data):
 with lock,(a.root/'events.jsonl').open('a') as f:f.write(json.dumps({'time':time.time(),**data})+'\n')
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  size=int(self.headers.get('Content-Length','0'))
  if size>65536:self.send_error(413);return
  record(json.loads(self.rfile.read(size)));self.send_response(204);self.end_headers()
 def do_GET(self):
  path=urlsplit(self.path).path
  record({'request':self.path,'range':self.headers.get('Range')})
  if path in ('/download.bin','/download-small.bin'):
   total=65536 if path=='/download-small.bin' else 32*1024*1024;start=0;end=total-1
   if self.headers.get('Range'):
    match=re.fullmatch(r'bytes=(\d+)-(\d*)',self.headers['Range'])
    if not match or int(match[1])>=total:self.send_error(416);return
    start=int(match[1]);end=min(int(match[2]),total-1) if match[2] else total-1
    if end<start:self.send_error(416);return
   self.send_response(206 if self.headers.get('Range') else 200)
   self.send_header('Content-Type','application/octet-stream');self.send_header('Content-Disposition','attachment; filename="browser-workflow.bin"')
   self.send_header('Accept-Ranges','bytes');self.send_header('ETag','"workflow-v1"');self.send_header('Content-Length',str(end-start+1))
   if self.headers.get('Range'):self.send_header('Content-Range',f'bytes {start}-{end}/{total}')
   self.end_headers();sent=start
   try:
    while sent<=end:
     size=min(65536,end-sent+1);self.wfile.write(b'W'*size);self.wfile.flush();sent+=size;time.sleep(.2)
    record({'download':'complete','start':start,'sent':sent})
   except (BrokenPipeError,ConnectionResetError):record({'download':'disconnected','start':start,'sent':sent})
   return
  if path=='/favicon.ico':self.send_response(204);self.end_headers();return
  label=html.escape(path.strip('/') or 'alpha')
  body=f'''<!doctype html><meta charset=utf-8><title>Workflow {label}</title>
<style>body{{background:#171923;color:#eee;font:22px system-ui;padding:25px}}a{{color:#9cf}}button,input{{font:inherit;padding:10px}}p{{line-height:1.6}}</style>
<h1>Workflow {label}</h1><nav><a href=/alpha>Alpha</a> · <a href=/beta>Beta</a> · <a href=/gamma>Gamma</a> · <a href=/guard>Guard</a> · <a href=/download.bin>Download 32 MiB</a></nav>
<p>Search marker: NeedleOne. Another NeedleOne. Final NeedleOne.</p>
<button id=guard>Enable leave confirmation</button><input id=editor placeholder="Keyboard focus probe"><pre id=status></pre>
<script>
const report=(kind,data={{}})=>fetch('/report',{{method:'POST',body:JSON.stringify({{kind,path:location.pathname,...data}})}});
const dimensions=()=>{{document.getElementById('status').textContent=innerWidth+' × '+innerHeight;report('viewport',{{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}})}};
addEventListener('resize',dimensions);addEventListener('pageshow',()=>{{report('loaded');dimensions()}});
document.getElementById('editor').addEventListener('input',e=>report('input',{{text:e.target.value}}));
document.getElementById('guard').onclick=()=>{{addEventListener('beforeunload',e=>{{e.preventDefault();e.returnValue='Unsaved fixture';}});report('guard-enabled');document.getElementById('guard').textContent='Leave confirmation enabled'}};
</script>'''.encode()
  self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
print(f'http://127.0.0.1:{a.port}/alpha',flush=True)
ThreadingHTTPServer(('127.0.0.1',a.port),Handler).serve_forever()
