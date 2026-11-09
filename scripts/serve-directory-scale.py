#!/usr/bin/env python3
"""Bounded large-folder fixture; page reports rendering and input callback timing."""
import argparse,json,threading,time
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--root',required=True,type=Path);p.add_argument('--port',type=int,default=18974)
a=p.parse_args();root=a.root.resolve();root.mkdir(parents=True,exist_ok=False)
profile=root/'profile';styles=root/'styles';scripts=root/'scripts'
for path in (profile/'config',profile/'data',styles,scripts):path.mkdir(parents=True)
(profile/'config/Settings.json').write_text(json.dumps({'firstRunComplete':True,'restorePreviousSession':False,'backgroundNetworking':{'enabled':False}}))
(profile/'data/DerpBirdStyleFolders.json').write_text(json.dumps([str(styles)]))
(profile/'data/DerpBirdScriptFolders.json').write_text(json.dumps([str(scripts)]))
(styles/'palette.less').write_text('@accent: #123456;')
(styles/'palette.styl').write_text('accent = #654321')
(styles/'unused.less').write_text('/*'+'x'*1024*1024+'*/')
for i in range(128):
 kind='less' if i%2==0 else 'stylus'
 body=f'@import "palette.less"; #row{i} {{color:@accent}}' if kind=='less' else f'@import "palette.styl"\n#row{i}\n  color accent'
 (styles/f'{i:03}.user.{"less" if kind=="less" else "styl"}').write_text(f'/* ==UserStyle==\n@name Scale {i}\n@namespace derpbird-scale\n@version 1.0.0\n@preprocessor {kind}\n==/UserStyle== */\n'+body)
for i in range(64):
 (scripts/f'{i:03}.user.js').write_text(f'// ==UserScript==\n// @name Scale script {i}\n// @match http://127.0.0.1:{a.port}/*\n// @run-at document-end\n// ==/UserScript==\ndocument.documentElement.setAttribute("data-script-{i}","ready");')
html='''<!doctype html><meta charset=utf-8><title>Directory scale</title><style>body{font:20px sans-serif;background:#eee;padding:24px}#rows{height:380px;overflow:auto;display:grid;grid-template-columns:repeat(8,1fr)}input{font:inherit}pre{font:16px monospace}</style><h1>128 styles · 64 scripts</h1><input placeholder="Input responsiveness"><pre id=status></pre><div id=rows></div><script>
for(let i=0;i<128;i++){const row=document.createElement('div');row.id='row'+i;row.textContent='Row '+i;rows.append(row)}
let previous, gaps=[],inputs=[];
function frame(now){if(previous!==undefined&&!document.hidden)gaps.push(now-previous);previous=now;requestAnimationFrame(frame)}requestAnimationFrame(frame);
document.querySelector('input').addEventListener('input',()=>{const now=performance.now();requestAnimationFrame(()=>inputs.push(performance.now()-now))});
const stats=values=>{const a=values.slice().sort((a,b)=>a-b);return {count:a.length,p95:a[Math.floor(a.length*.95)]??null,max:a.at(-1)??null}};
setInterval(()=>{const state={url:location.href,scripts:Array.from({length:64},(_,i)=>document.documentElement.getAttribute('data-script-'+i)).filter(x=>x==='ready').length,colors:[...rows.children].map(x=>getComputedStyle(x).color),visible:!document.hidden,raf:stats(gaps),input:stats(inputs)};document.getElementById("status").textContent=JSON.stringify({...state,colors:[...new Set(state.colors)]},null,1);fetch('/report',{method:'POST',body:JSON.stringify(state)});gaps=[];inputs=[]},1000);
</script>'''.encode()
lock=threading.Lock()
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  self.send_response(200);self.send_header('Content-Type','text/html');self.send_header('Content-Length',str(len(html)));self.end_headers();self.wfile.write(html)
 def do_POST(self):
  length=int(self.headers.get('Content-Length','0'))
  if self.path!='/report' or not 0<length<=65536:self.send_error(400);return
  data=json.loads(self.rfile.read(length));data['time']=time.time()
  with lock,(root/'events.jsonl').open('a') as out:out.write(json.dumps(data)+'\n')
  self.send_response(204);self.end_headers()
print(json.dumps({'url':f'http://127.0.0.1:{a.port}/','profile':str(profile)}),flush=True)
ThreadingHTTPServer(('127.0.0.1',a.port),Handler).serve_forever()
