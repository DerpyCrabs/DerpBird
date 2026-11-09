#!/usr/bin/env python3
"""Local synthetic DOM/animation fixture. RAF is callback cadence, not presented FPS."""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import time

HTML = r'''<!doctype html><meta charset="utf-8"><title>DerpBird responsiveness</title>
<style>body{font:16px system-ui;background:#171923;color:#eceff4;margin:24px}button,input{font:inherit;padding:10px;margin:6px}#rows{display:grid;grid-template-columns:repeat(8,1fr);gap:4px}#rows div{padding:5px;background:#262b39}#ball{width:24px;height:24px;border-radius:50%;background:#a78bfa}#status{white-space:pre-wrap;max-height:120px;overflow:auto}#rows{max-height:300px;overflow:auto}a{color:#a5b4fc}</style>
<h1>DerpBird responsiveness fixture</h1><p>Timer / RAF callback cadence; not compositor presentation latency.</p>
<button id="toggle">Pause DOM churn</button><input id="typing" placeholder="Type to measure input → next RAF"><a href="?reload=1">Navigate</a>
<div id="present-probe" style="position:fixed;right:0;top:0;width:48px;height:48px;background:#000;z-index:99999"></div><p id="status">Starting…</p><div id="ball"></div><div id="rows"></div>
<script>
const id=String(Date.now())+'-'+Math.random(), started=performance.now();
const rows=document.querySelector('#rows'), ball=document.querySelector('#ball');
for(let i=0;i<2000;i++){const row=document.createElement('div');row.textContent='Row '+i;rows.append(row);}
let churn=true,framePrevious,previous=performance.now(),frames=[],timers=[],inputs=[],mutations=0,epoch=performance.now();
const stats=values=>{const sorted=values.slice().sort((a,b)=>a-b);return {count:sorted.length,p50:sorted[Math.floor(sorted.length*.5)]??null,p95:sorted[Math.floor(sorted.length*.95)]??null,max:sorted[sorted.length-1]??null};};
function report(reason){
 const now=performance.now(); const value={fixtureRevision:3,id,url:location.href,reason,userscript:document.documentElement.dataset.userscriptProbe??null,visible:!document.hidden,churn,elapsedMs:now-started,windowMs:now-epoch,rafGapMs:stats(frames),timerGapMs:stats(timers),inputToRafMs:stats(inputs),mutations};
 fetch('/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}).catch(()=>{});
 document.querySelector('#status').textContent=JSON.stringify(value,null,1);
 frames=[];timers=[];inputs=[];mutations=0;epoch=now;
}
function frame(now){if(framePrevious!==undefined&&!document.hidden&&frames.length<10000)frames.push(now-framePrevious);framePrevious=now;ball.style.transform='translateX('+Math.round((now/5)%700)+'px)';requestAnimationFrame(frame);}
requestAnimationFrame(frame);
setInterval(()=>{const now=performance.now();if(!document.hidden&&timers.length<10000)timers.push(now-previous);previous=now;},20);
let sequence=0;
setInterval(()=>{if(!churn||document.hidden)return;for(let n=0;n<256;n++){const i=(sequence++)%2000;rows.children[i].textContent='Row '+i+' · '+sequence;}mutations+=256;},250);
setInterval(()=>report('sample'),5000);
document.addEventListener('visibilitychange',()=>{report('visibility');framePrevious=undefined;previous=performance.now();});
document.querySelector('#toggle').onclick=()=>{report('toggle');churn=!churn;document.querySelector('#toggle').textContent=churn?'Pause DOM churn':'Resume DOM churn';};
document.querySelector('#typing').addEventListener('input',event=>{const at=performance.now();document.querySelector('#present-probe').style.background=event.target.value.length%2?'#fff':'#000';requestAnimationFrame(()=>inputs.push(performance.now()-at));});
</script>'''

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port',type=int,default=18943)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
args.output.parent.mkdir(parents=True,exist_ok=True)
lock=threading.Lock()
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self):
        body=HTML.encode();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def do_POST(self):
        length=int(self.headers.get('Content-Length','0'))
        if self.path!='/report' or not 0<length<=65536:self.send_error(400);return
        try:
            data=json.loads(self.rfile.read(length));data['receivedUnix']=time.time()
            with lock:
                with args.output.open('a') as stream:stream.write(json.dumps(data)+'\n')
        except (ValueError,TypeError):self.send_error(400);return
        self.send_response(204);self.end_headers()
server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
print(f'Fixture: http://127.0.0.1:{server.server_port}',flush=True)
try:server.serve_forever()
except KeyboardInterrupt:pass
finally:server.server_close()
