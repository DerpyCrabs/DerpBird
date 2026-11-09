#!/usr/bin/env python3
"""Owned fixture for native Blob download controls and GM stream revocation."""
import argparse,json,threading,time
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,required=True);p.add_argument('--port',type=int,default=18964);a=p.parse_args()
a.root.mkdir(parents=True,exist_ok=False)
for path in ['profile/config','profile/data']:(a.root/path).mkdir(parents=True)
base=f'http://127.0.0.1:{a.port}'
source=r'''
const report=data=>fetch(fixtureBase+'/report',{method:'POST',mode:'no-cors',body:JSON.stringify({url:location.href,...data})});
try {
let sequence=0;
document.querySelector('#blob').addEventListener('click',()=>{
 const name='derpbird-lifecycle-'+Date.now()+'.bin';
 const block=new Uint8Array(1024*1024).fill(65);
 const size=Math.max(1,Math.min(128,Number(new URL(location.href).searchParams.get('mib'))||128));
 const blob=new Blob(Array.from({length:size},()=>block));
 // Deliberately pace only this fixture's producer so UI controls can be exercised.
 // This mode must never be used as a download-throughput measurement.
 if(new URL(location.href).searchParams.has('slow')){
  const slice=blob.slice.bind(blob);
  blob.slice=(...args)=>{
   const chunk=slice(...args),read=chunk.arrayBuffer.bind(chunk);
   chunk.arrayBuffer=async()=>{await new Promise(resolve=>setTimeout(resolve,20));return read()};
   return chunk;
  };
 }

 let last=0;
 GM.download({url:blob,name,saveAs:false,onprogress:e=>{document.querySelector('#blob-state').textContent=name+' '+e.loaded;if(performance.now()-last>250){last=performance.now();void report({kind:'blob-progress',name,loaded:e.loaded})}}})
 .then(()=>report({kind:'blob-complete',name})).catch(e=>report({kind:'blob-error',name,error:String(e)}));
});
document.querySelector('#stream').addEventListener('click',async()=>{
 const id=++sequence;let bytes=0;
 try{
  const response=await GM.xmlHttpRequest({url:fixtureBase+'/slow-stream?id='+id,responseType:'stream',anonymous:true});
  const reader=response.response.getReader();
  for(;;){const value=await reader.read();if(value.done)break;bytes+=value.value.length;document.documentElement.dataset.streamBytes=String(bytes);void report({kind:'stream-progress',id,bytes})}
  await report({kind:'stream-complete',id,bytes});
 }catch(e){await report({kind:'stream-error',id,bytes,error:String(e)})}
});
void report({kind:'handlers-ready',readyState:document.readyState});
} catch(error) {
 document.documentElement.dataset.transferError=String(error);
 void report({kind:'initialization-error',error:String(error),stack:error.stack,readyState:document.readyState});
 throw error;
}
'''
source=f'// ==UserScript==\n// @name Transfer lifecycle\n// @match {base}/*\n// @match file:///*\n// @run-at document-end\n// @grant GM.download\n// @grant GM.xmlHttpRequest\n// @connect 127.0.0.1\n// ==/UserScript==\nconst fixtureBase={json.dumps(base)};\n'+source
metadata=dict(runAt='document-end',grantNone=False,noFrames=True,matches=[base+'/*','file:///*'],includes=[],excludes=[],excludeMatches=[],grants=['GM.download','GM.xmlHttpRequest'],requires=[],resources=[],connects=['self','127.0.0.1'])
(a.root/'profile/config/Settings.json').write_text(json.dumps(dict(firstRunComplete=True,restorePreviousSession=False,backgroundNetworking={'enabled':False})))
(a.root/'profile/data/DerpBirdScripts.json').write_text(json.dumps({'version':1,'items':[dict(id='transfer-lifecycle',name='Transfer lifecycle',source=source,metadata=metadata,enabled=True,fileAccessGranted=True)]}))
lock=threading.Lock()
def record(value):
 with lock,(a.root/'events.jsonl').open('a') as f:f.write(json.dumps({'time':time.time(),**value})+'\n')
PAGE='''<!doctype html><meta charset=utf-8><title>Transfer lifecycle</title><style>body{background:#171923;color:#eef;font:20px system-ui;padding:24px}button{font:inherit;margin:10px;padding:12px}</style><h1>Transfer lifecycle</h1><button id=blob>Blob 128 MiB</button><button id=stream>Start GM stream</button><p id=blob-state></p><pre id=stream-state>Stream idle</pre><a href=/gone>Replace source document</a><script>setInterval(()=>{document.querySelector('#stream-state').textContent='Stream bytes: '+(document.documentElement.dataset.streamBytes||0)},200)</script>'''
(a.root/'local.html').write_text(PAGE)
class HTTP(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  raw=self.rfile.read(int(self.headers.get('Content-Length','0')))
  record(json.loads(raw));self.send_response(204);self.end_headers()
 def do_GET(self):
  if self.path=='/layers.user.css':
   body=(f'@layer first {{ @-moz-document url-prefix("{base}/") {{ h1 {{ color:rgb(255,0,0) }} }} }}\n'
         '@layer second { h1 { color:rgb(0,128,255) } }\n'
         '@layer first { h1 { color:rgb(0,255,0) } }').encode()
   self.send_response(200);self.send_header('Content-Type','text/css');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);return
  if self.path.startswith('/slow-stream'):
   total=16*1024*1024;sent=0;record({'kind':'stream-http-start','path':self.path})
   self.send_response(200);self.send_header('Content-Type','application/octet-stream');self.send_header('Content-Length',str(total));self.end_headers()
   try:
    while sent<total:
     self.wfile.write(b'B'*32768);self.wfile.flush();sent+=32768;time.sleep(.05)
    record({'kind':'stream-http-complete','sent':sent})
   except (BrokenPipeError,ConnectionResetError):record({'kind':'stream-http-disconnected','sent':sent})
   return
  body=PAGE.encode();self.send_response(200);self.send_header('Content-Type','text/html');self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)
ThreadingHTTPServer(('127.0.0.1',a.port),HTTP).serve_forever()
