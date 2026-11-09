#!/usr/bin/env python3
"""One isolated desktop fixture for source editing, frame commands and downloads."""
import argparse, html, json, threading, time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--root',type=Path,required=True);p.add_argument('--port',type=int,default=18949)
a=p.parse_args();a.root=a.root.resolve();a.root.mkdir(parents=True,exist_ok=False)
for name in ('scripts','styles','remote','profile/config','profile/data'):(a.root/name).mkdir(parents=True,exist_ok=True)
base=f'http://127.0.0.1:{a.port}'
script=f'''// ==UserScript==
// @name Release source
// @version 1
// @match {base}/*
// @require ./library.js
// @resource note ./note.txt
// @grant GM_getResourceText
// ==/UserScript==
document.documentElement.dataset.releaseSource=releaseLibrary+':'+GM_getResourceText('note');
'''
(a.root/'scripts/source.user.js').write_text(script)
(a.root/'scripts/library.js').write_text("var releaseLibrary='library-one';")
(a.root/'scripts/note.txt').write_text('note-one')
(a.root/'styles/source.user.css').write_text(f'@-moz-document url-prefix("{base}/") {{ h1 {{ color: rgb(120, 200, 160) !important; }} }}')
for path in (a.root/'scripts').iterdir():(a.root/'remote'/path.name).write_text(path.read_text())
(a.root/'remote/source.user.css').write_text('/* ==UserStyle==\n@name Remote style\n@namespace derpbird.release\n@version 1.0.0\n==/UserStyle== */\n'+(a.root/'styles/source.user.css').read_text())
(a.root/'profile/config/Settings.json').write_text(json.dumps({'firstRunComplete':True,'restorePreviousSession':False,'backgroundNetworking':{'enabled':False},'contentBlockers':{'enabled':True,'customFilters':'/api?remove$removeparam=drop\n/policy$csp=script-src \'none\'\n/policy$permissions=camera=()\n127.0.0.1##^responseheader(refresh)'}}))
for kind in ('Script','Style'):(a.root/f'profile/data/DerpBird{kind}Folders.json').write_text(json.dumps([str(a.root/('scripts' if kind=='Script' else 'styles'))]))
source=r'''const report=(name,data)=>fetch('/report',{method:'POST',body:JSON.stringify({name,url:location.href,...data})});
GM.registerMenuCommand('Mark clicked frame',()=>{document.documentElement.dataset.clicked='yes';document.querySelector('h1').textContent='Clicked frame confirmed';report('clicked-frame',{ok:true});},{clickedFrame:true});
if(window.top===window){
(async()=>{
 const checks=[];const check=(name,ok)=>{checks.push({name,ok});document.querySelector('#checks').textContent=JSON.stringify(checks,null,1);report(name,{ok});};
 await GM.cookie.set({name:'release-normal',value:'n',path:'/',httpOnly:false});
 await GM.cookie.set({name:'release-http',value:'h',path:'/',httpOnly:true});
 const plain=await GM.cookie.list({httpOnly:false}),http=await GM.cookie.list({httpOnly:true});
 check('cookie selectors',plain.some(c=>c.name==='release-normal')&&!plain.some(c=>c.name==='release-http')&&http.some(c=>c.name==='release-http')&&!http.some(c=>c.name==='release-normal'));
 await GM.cookie.set({name:'release-partition',value:'p',path:'/',partitionKey:{topLevelSite:'https://sub.example.com'}});
 const partition=await GM.cookie.list({name:'release-partition',partitionKey:{topLevelSite:'https://example.com'},firstPartyDomain:'sub.example.com'});
 check('normalized cookie partition',partition.length===1&&partition[0].value==='p');
 try{await GM.cookie.list({storeId:'firefox-private'});check('cookie store isolation',false)}catch{check('cookie store isolation',true)}
 await GM.setValues({a:1,b:{value:'two'}});const values=await GM.getValues(['a','b']);check('batch values',values.a===1&&values.b.value==='two');
 const result=await (await fetch('/api?remove&drop=1&keep=2')).json();check('removeparam',!result.path.includes('drop='));
})().catch(error=>report('runtime-error',{ok:false,error:String(error)}));
for(const size of [1,32])document.querySelector('#blob'+size).addEventListener('click',()=>{
 const blob=new Blob(Array.from({length:size},()=>new Uint8Array(1024*1024).fill(65)));
 const started=performance.now();
 GM.download({url:blob,name:'derpbird-release-'+size+'.bin',conflictAction:'uniquify',onprogress:event=>{document.querySelector('#download').textContent=String(event.loaded);}}).then(value=>report('blob-'+size,{ok:true,ms:performance.now()-started,...value})).catch(error=>report('blob-'+size,{ok:false,error:String(error)}));
});
setInterval(()=>{const data={script:document.documentElement.dataset.releaseSource??null,color:getComputedStyle(document.querySelector('h1')).color};if(JSON.stringify(data)!==globalThis.lastRelease){globalThis.lastRelease=JSON.stringify(data);report('directory-state',data);}},1000);
}
'''
metadata={'runAt':'document-end','grantNone':False,'noFrames':False,'matches':[base+'/*',f'http://localhost:{a.port}/*'],'includes':[],'excludes':[],'excludeMatches':[],'grants':['GM.registerMenuCommand','GM.cookie','GM.setValues','GM.getValues','GM.download'],'requires':[],'resources':[],'connects':['self']}
(a.root/'profile/data/DerpBirdScripts.json').write_text(json.dumps({'version':1,'items':[{'id':'release-runtime','name':'Release runtime','source':source,'enabled':True,'fileAccessGranted':False,'metadata':metadata}]}))
lock=threading.Lock()
def log(data):
 with lock,(a.root/'events.jsonl').open('a') as out:out.write(json.dumps({'time':time.time(),**data})+'\n')
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  size=int(self.headers.get('Content-Length','0'))
  if self.path!='/report' or size>65536:self.send_error(400);return
  try:log(json.loads(self.rfile.read(size)))
  except (ValueError,TypeError):self.send_error(400);return
  self.send_response(204);self.end_headers()
 def do_GET(self):
  path=urlsplit(self.path).path;log({'request':self.path,'host':self.headers.get('Host')})
  if path.startswith('/remote/'):
   name=path.removeprefix('/remote/');file=a.root/'remote'/name
   if '/' in name or name not in {'source.user.js','source.user.css','library.js','note.txt'} or not file.is_file():self.send_error(404);return
   body=file.read_bytes();mime='text/plain; charset=utf-8'
  elif path=='/api':body=json.dumps({'path':self.path}).encode();mime='application/json'
  elif path=='/favicon.ico':self.send_response(204);self.end_headers();return
  else:
   nested=(f'<iframe src="http://localhost:{a.port}/deep" style="width:95%;height:130px"></iframe>' if path=='/frame' else '')
   controls=(f'<pre id="checks">Running…</pre><button id="blob1">Download 1 MiB</button><button id="blob32">Download 32 MiB</button><span id="download"></span><p><a href="/next">Next history page</a> · <a href="/policy">Policy page</a></p><iframe src="/frame" style="width:95%;height:240px"></iframe><p>Install URL: {base}/remote/source.user.js</p>' if path not in ('/frame','/deep') else nested)
   body=f'<!doctype html><meta charset="utf-8"><title>Release {html.escape(path)}</title><style>body{{background:#171923;color:#eef;font:16px system-ui;padding:12px}}button,input{{font:inherit;padding:8px}}pre{{max-height:120px;overflow:auto}}a{{color:#abc}}h1{{font-size:24px}}</style><h1>Release {html.escape(path)}</h1>{controls}'.encode();mime='text/html; charset=utf-8'
  self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)))
  if path=='/policy':self.send_header('Refresh','3600; url=/next')
  self.end_headers()
  try:self.wfile.write(body)
  except (BrokenPipeError,ConnectionResetError):pass
print(f'Release fixture {base}, profile {a.root / "profile"}',flush=True)
server=ThreadingHTTPServer(('127.0.0.1',a.port),Handler)
try:server.serve_forever()
except KeyboardInterrupt:pass
finally:server.server_close()
