#!/usr/bin/env python3
"""Owned loopback fixture for the consolidated native/Wayland qualification."""
import argparse
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=18945)
parser.add_argument('--profile', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
args.profile.mkdir(parents=True, exist_ok=False)
(args.profile / 'config').mkdir()
(args.profile / 'data').mkdir()
args.output.parent.mkdir(parents=True, exist_ok=True)
filters = '''127.0.0.1##^script:has-text(window.advertisementRan)
127.0.0.1##^div.advert
127.0.0.1##+js(trusted-set-attr, #trust-probe, data-trusted, yes)
/journal-ad$image
'''
(args.profile / 'config/Settings.json').write_text(json.dumps({
    'firstRunComplete': True, 'restorePreviousSession': False,
    'backgroundNetworking': {'enabled': False},
    'contentBlockers': {'enabled': True, 'customFilters': filters},
}))
source = '''(async()=>{
    const checks=[];
    const check=(name,ok)=>{checks.push(name+': '+(ok?'PASS':'FAIL'));document.getElementById('status').textContent=checks.join('\\n');void fetch('/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,ok:!!ok})});};
    check('HTML removal before execution',!unsafeWindow.advertisementRan&&!document.querySelector('.advert'));
    check('Page execution and doctype',unsafeWindow.ordinaryRan===true&&document.compatMode==='CSS1Compat');
    await GM.cookie.set({name:'package-fixture',value:'saved',path:'/'});
    check('Cookie read/write',(await GM.cookie.list({name:'package-fixture'}))[0]?.value==='saved');
    await GM.cookie.delete({name:'package-fixture'});
    check('Cookie delete',(await GM.cookie.list({name:'package-fixture'})).length===0);
    const sync=GM_xmlhttpRequest({url:'/text',synchronous:true,anonymous:true});
    check('Synchronous XHR',sync.responseText==='fixture');
    const response=await GM.xmlHttpRequest({url:'/chunks',responseType:'stream',anonymous:true});
    let total=0,chunks=0;const reader=response.response.getReader();
    for(;;){const part=await reader.read();if(part.done)break;total+=part.value.length;chunks++;await new Promise(r=>setTimeout(r,30));}
    check('Demand-driven stream',total===262144&&chunks>1);
    check('Raw realm',GM.info.sandboxMode==='raw' && window.document===globalThis.document && new Blob(['test']) instanceof Blob);
    check('No privileged page globals',typeof globalThis.GM==='undefined' && typeof globalThis.GM_webRequest==='undefined');
    const originalAudio=await GM.audio.getState();
    const audioEvents=[];
    const onAudio=event=>audioEvents.push(event);
    await GM.audio.addStateChangeListener(onAudio);
    try {
        await GM.audio.setMute({isMuted:!originalAudio.isMuted});
        const changed=await GM.audio.getState();
        check('Audio mute state',changed.isMuted===!originalAudio.isMuted);
        const until=performance.now()+3000;
        while(!audioEvents.length && performance.now()<until)await new Promise(r=>setTimeout(r,20));
        check('Audio change callback',audioEvents.some(event=>'muted' in event));
    } finally {
        await GM.audio.removeStateChangeListener(onAudio);
        await GM.audio.setMute({isMuted:originalAudio.isMuted});
    }
    const requestEvents=[];
    GM_webRequest([
        {selector:location.origin+'/policy-blocked*',action:'cancel'},
        {selector:location.origin+'/policy-redirect*',action:{redirect:location.origin+'/text'}}
    ],(info,message,details)=>requestEvents.push({info,message,details}));
    let rejected=false;
    try {await fetch('/policy-blocked')}catch{rejected=true}
    check('webRequest cancellation',rejected);
    check('webRequest redirect',await (await fetch('/policy-redirect')).text()==='fixture');
    const eventDeadline=performance.now()+3000;
    while(requestEvents.length<2 && performance.now()<eventDeadline)await new Promise(r=>setTimeout(r,20));
    check('webRequest callbacks',requestEvents.some(event=>event.info==='cancel')&&requestEvents.some(event=>event.info==='redirect'));
    GM_webRequest([]);
    check('webRequest removal',await (await fetch('/policy-blocked')).text()==='UNBLOCKED');
    let urlChanged=false;
    addEventListener('urlchange',()=>{urlChanged=true},{once:true});
    history.pushState({},'',location.pathname+'?urlchange');
    const urlDeadline=performance.now()+3000;
    while(!urlChanged && performance.now()<urlDeadline)await new Promise(r=>setTimeout(r,20));
    check('Native URL change event',urlChanged);
    window.focus();

    setTimeout(()=>check('Trusted personal filter',document.getElementById('trust-probe').getAttribute('data-trusted')==='yes'),100);
})().catch(error=>{document.getElementById('status').textContent+='\\nERROR: '+error;});'''
menu = "const node=document.getElementById('menu-count');node.textContent=String(Number(node.textContent)+1);"
def record(identity, name, source, run_at, grants):
    return {'id': identity, 'name': name, 'source': source, 'enabled': True, 'fileAccessGranted': False,
            'metadata': {'runAt': run_at, 'grantNone': False, 'noFrames': True,
                         'matches': [f'http://127.0.0.1:{args.port}/*'], 'includes': [], 'excludeMatches': [], 'excludes': [],
                         'grants': grants, 'requires': [], 'connects': ['self'], 'resources': []}}
(args.profile / 'data/DerpBirdScripts.json').write_text(json.dumps({'version': 1, 'items': [
    record('consolidated-runtime', 'Проверка API', source, 'document-end', ['unsafeWindow','GM.cookie','GM.xmlHttpRequest','GM_xmlhttpRequest','GM.audio','GM_webRequest','window.onurlchange','window.focus']),
    record('consolidated-menu', 'Увеличить счётчик', menu, 'context-menu', ['GM.info']),
]}))
lock = threading.Lock()
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_POST(self):
        length = int(self.headers.get('Content-Length', '0'))
        if self.path != '/report' or not 0 < length <= 65536:
            self.send_error(400)
            return
        try:
            report = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError):
            self.send_error(400)
            return
        with lock:
            with args.output.open('a') as output:
                output.write(json.dumps({'time': time.time(), 'report': report})+'\n')
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        with lock:
            with args.output.open('a') as output:
                output.write(json.dumps({'time': time.time(), 'path': self.path})+'\n')
        if self.path == '/chunks':
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', '262144')
            self.end_headers()
            try:
                for _ in range(16):
                    self.wfile.write(b'x'*16384);self.wfile.flush();time.sleep(.015)
            except (BrokenPipeError, ConnectionResetError): pass
            return
        if self.path == '/text': body=b'fixture'; mime='text/plain'
        elif self.path.startswith('/policy-'): body=b'UNBLOCKED'; mime='text/plain'
        elif self.path == '/journal-ad': body=b''; mime='image/png'
        else:
            mime='text/html; charset=utf-8'
            body='''<!doctype html><meta charset="utf-8"><title>DerpBird · общий пакет</title>
<style>body{background:#171923;color:#e9edf6;font:16px system-ui;margin:28px}pre{line-height:1.8;color:#bce8d0}button,input{font:inherit;padding:10px;background:#30364a;color:white;border:1px solid #67718b;border-radius:8px}.advert{background:red}small{color:#afb7cc}</style>
<script>window.advertisementRan=true</script><script>window.ordinaryRan=true</script>
<h1>Общий пакет браузера</h1><div class="advert">Этот рекламный узел должен быть удалён</div>
<pre id="status">Ожидание userscript…</pre><span id="trust-probe"></span>
<p>Запуски из меню: <strong id="menu-count">0</strong></p>
<button onclick="fetch('/text?journal').then(()=>{const image=new Image();image.src='/journal-ad?'+Date.now();document.body.append(image)})">Создать события журнала</button>
<p><input placeholder="Проверка ввода" oninput="const start=performance.now();requestAnimationFrame(()=>document.getElementById('latency').textContent=(performance.now()-start).toFixed(1)+' мс')"> <small id="latency"></small></p>
<p><small id="frames">RAF…</small></p><script>
let last=performance.now(),frames=[];function frame(now){frames.push(now-last);last=now;if(frames.length>600)frames.shift();if(frames.length%60===0){const sorted=[...frames].sort((a,b)=>a-b);document.getElementById('frames').textContent='RAF p95: '+sorted[Math.floor(sorted.length*.95)].toFixed(1)+' мс; max: '+Math.max(...frames).toFixed(1)+' мс';}requestAnimationFrame(frame)}requestAnimationFrame(frame);
</script>'''.encode()
        self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
print(f'Consolidated fixture: http://127.0.0.1:{args.port}',flush=True)
try: server.serve_forever()
except KeyboardInterrupt: pass
finally: server.server_close()
