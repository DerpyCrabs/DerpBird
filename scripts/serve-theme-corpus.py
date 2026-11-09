#!/usr/bin/env python3
"""Native UI import/configuration fixture for saved UserCSS and AdGuard corpus."""
import argparse
import hashlib
import json
import ssl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import time

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--root', type=Path, required=True)
p.add_argument('--port', type=int, default=18956)
p.add_argument('--tls-cert', type=Path)
p.add_argument('--tls-key', type=Path)
a = p.parse_args()
if bool(a.tls_cert) != bool(a.tls_key):
    p.error('--tls-cert and --tls-key must be used together')
corpus = Path(__file__).resolve().parents[1] / 'artifacts/compatibility-corpus'
manifest = {x['file']: x for x in json.loads((corpus / 'manifest.json').read_text())}
for name in ('github.user.less', 'adguard-extra.user.js'):
    if hashlib.sha256((corpus / name).read_bytes()).hexdigest() != manifest[name]['sha256']:
        raise SystemExit('Corpus hash mismatch: ' + name)
root = a.root.resolve(); root.mkdir(parents=True, exist_ok=False)
profile = root / 'profile'
(profile / 'config').mkdir(parents=True); (profile / 'data').mkdir()
scripts = root / 'scripts'; scripts.mkdir()
(scripts / 'adguard.inc').write_bytes((corpus / 'adguard-extra.user.js').read_bytes())
(scripts / 'observe.user.js').write_text('''// ==UserScript==
// @name AdGuard Extra corpus observation
// @namespace derpbird.corpus
// @version 1.0.0
// @match *://*/*
// @grant unsafeWindow
// @grant GM_xmlhttpRequest
// @run-at document-start
// @require ./adguard.inc
// ==/UserScript==
fetch('/report',{method:'POST',body:JSON.stringify({event:'adguard-executed',host:location.hostname,
  supported:isBrowserSupported(),propertyTargets:Array.from(allHosts.getHosts()).filter(([host,fn])=>fn===pageCallback$u).map(([host])=>host)})});
''')
(profile / 'config/Settings.json').write_text(json.dumps({'firstRunComplete': True, 'restorePreviousSession': False, 'backgroundNetworking': {'enabled': False}}))
(profile / 'data/DerpBirdScriptFolders.json').write_text(json.dumps([str(scripts)]))
html = b'''<!doctype html><html data-color-mode="dark" data-dark-theme="dark"><meta charset=utf-8><title>Catppuccin native corpus</title>
<style>body{font:22px sans-serif;padding:32px;background:var(--bgColor-default,#eee);color:var(--fgColor-default,#111)}a{color:var(--fgColor-accent,#00f)}button{font:inherit;margin-right:12px;padding:10px}</style>
<h1>Unmodified GitHub Catppuccin UserCSS</h1><p>This is a controlled local DOM, not the GitHub website.</p><a href="/next">Example link</a>
<p><button onclick="document.documentElement.dataset.colorMode='light';document.documentElement.dataset.lightTheme='light'">Light mode</button><button onclick="document.documentElement.dataset.colorMode='dark';document.documentElement.dataset.darkTheme='dark'">Dark mode</button></p>
<pre id=status></pre><p id=property></p><script>
try{window.ya={probe:true};const descriptor=Object.getOwnPropertyDescriptor(window,'ya');const blocked=window.ya?.probe!==true;document.getElementById('property').textContent=blocked?'ya assignment blocked':'ya assignment allowed';fetch('/report',{method:'POST',body:JSON.stringify({event:'property',blocked,host:location.hostname,configurable:descriptor?.configurable,writable:descriptor?.writable})})}
catch(e){document.getElementById('property').textContent='ya assignment blocked';fetch('/report',{method:'POST',body:JSON.stringify({event:'property',blocked:true,host:location.hostname,error:String(e)})})}
let previous='';setInterval(()=>{let s=getComputedStyle(document.body),r={event:'style',background:s.backgroundColor,color:s.color,accent:getComputedStyle(document.querySelector('a')).color};let t=JSON.stringify(r);document.getElementById('status').textContent=t;if(t!==previous){previous=t;fetch('/report',{method:'POST',body:t})}},500);
</script></html>'''
lock = threading.Lock()
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self):
        style = self.path == '/github.user.less'
        body = (corpus / 'github.user.less').read_bytes() if style else html
        self.send_response(200); self.send_header('Content-Type','text/plain' if style else 'text/html')
        self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_POST(self):
        length=int(self.headers.get('Content-Length','0'))
        if self.path!='/report' or not 0<length<65536: self.send_error(400); return
        data=json.loads(self.rfile.read(length))
        with lock:
            with (root/'events.jsonl').open('a') as f:f.write(json.dumps({'time':time.time(),**data})+'\n')
        self.send_response(204); self.end_headers()
server=ThreadingHTTPServer(('127.0.0.1',a.port),Handler)
if a.tls_cert:
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(a.tls_cert, a.tls_key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
scheme = 'https' if a.tls_cert else 'http'
print(f'Profile: {profile}\nURL: {scheme}://gist.github.com:{a.port}/\nImport: {scheme}://127.0.0.1:{a.port}/github.user.less',flush=True)
try:server.serve_forever()
except KeyboardInterrupt:pass
finally:server.server_close()
