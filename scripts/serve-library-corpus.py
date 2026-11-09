#!/usr/bin/env python3
"""Run immutable third-party libraries through native userscript dependencies."""
import argparse
import hashlib
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import time

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--root', type=Path, required=True)
p.add_argument('--port', type=int, default=18955)
a = p.parse_args()
corpus = Path(__file__).resolve().parents[1] / 'artifacts/compatibility-corpus'
manifest = {x['file']: x for x in json.loads((corpus / 'manifest.json').read_text())}
root = a.root.resolve()
root.mkdir(parents=True, exist_ok=False)
scripts = root / 'scripts'
(scripts / 'lib').mkdir(parents=True)
for name in ('gm_config.js', 'GMCommonAPI.js'):
    data = (corpus / name).read_bytes()
    if hashlib.sha256(data).hexdigest() != manifest[name]['sha256']:
        raise SystemExit(f'Corpus hash mismatch: {name}')
    (scripts / 'lib' / name).write_bytes(data)
profile = root / 'profile'
(profile / 'config').mkdir(parents=True)
(profile / 'data').mkdir()
(profile / 'config/Settings.json').write_text(json.dumps({'firstRunComplete': True, 'restorePreviousSession': False, 'backgroundNetworking': {'enabled': False}}))
(profile / 'data/DerpBirdScriptFolders.json').write_text(json.dumps([str(scripts)]))

def wrapper(name, library, grants, body):
    header = '\n'.join(f'// @grant {g}' for g in grants)
    return f'''// ==UserScript==
// @name {name}
// @namespace derpbird.corpus
// @version 1.0.0
// @match http://127.0.0.1:{a.port}/*
// @run-at document-end
// @require ./lib/{library}
// @connect 127.0.0.1
{header}
// ==/UserScript==
const report=(event,value)=>fetch('/report',{{method:'POST',body:JSON.stringify({{library:{json.dumps(library)},event,value}})}});
{body}
'''

(scripts / 'config.user.js').write_text(wrapper('GM_config corpus', 'gm_config.js', ['GM.getValue', 'GM.setValue', 'GM.log'], '''
GM_config.init({id:'DerpCorpusConfig',title:'Real GM_config library',fields:{message:{label:'Message',type:'text',default:'initial'}},events:{
  init:function(){
    report('init',this.get('message'));
    const button=document.createElement('button');button.textContent='Open GM_config';button.id='open-config';
    button.addEventListener('click',()=>this.open());document.body.appendChild(button);
  },
  open:function(){report('open',this.get('message'));},
  save:function(){report('save',this.get('message'));},
  close:function(){report('close',this.get('message'));}
}});
'''))
(scripts / 'common.user.js').write_text(wrapper('GMCommonAPI corpus', 'GMCommonAPI.js',
    ['GM_info','GM_getValue','GM_setValue','GM_deleteValue','GM_listValues','GM_registerMenuCommand','GM_addStyle','GM_xmlhttpRequest'], '''
try {
  const previous=GMC.getValue('visits',0);GMC.setValue('visits',previous+1);
  if(GMC.getValue('visits',0)!==previous+1||!GMC.listValues().includes('visits'))throw Error('storage roundtrip');
  GMC.setValue('temporary','x');GMC.deleteValue('temporary');
  if(GMC.getValue('temporary','missing')!=='missing')throw Error('storage delete');
  GMC.addStyle('#common-status{color:rgb(20,140,70)}');
  const node=document.createElement('p');node.id='common-status';node.textContent='GMCommonAPI: native storage passed, visit '+(previous+1);document.body.appendChild(node);
  GMC.registerMenuCommand('GMC corpus action',()=>report('menu','clicked'));
  GMC.xmlHttpRequest({url:location.origin+'/payload',onload:r=>report('network',r.responseText),onerror:e=>report('error','network')});
  report('storage',{previous,current:previous+1});
} catch(error) { report('error',String(error.stack||error)); }
'''))
lock = threading.Lock()
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        body = b'corpus-network-ok' if self.path == '/payload' else b'<!doctype html><meta charset=utf-8><title>Third-party userscript libraries</title><style>body{font:22px sans-serif;background:#eee;padding:32px}button{font:inherit;padding:12px}</style><h1>Third-party userscript libraries</h1><p>Immutable GM_config and GMCommonAPI loaded through local @require.</p>'
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain' if self.path == '/payload' else 'text/html')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_POST(self):
        length = int(self.headers.get('Content-Length', '0'))
        if self.path != '/report' or not 0 < length < 16384:
            self.send_error(400); return
        data = json.loads(self.rfile.read(length))
        with lock:
            with (root / 'events.jsonl').open('a') as f:
                f.write(json.dumps({'time':time.time(),**data})+'\n')
        self.send_response(204); self.end_headers()
server = ThreadingHTTPServer(('127.0.0.1', a.port), Handler)
print(f'Profile: {profile}\nURL: http://127.0.0.1:{a.port}/', flush=True)
try: server.serve_forever()
except KeyboardInterrupt: pass
finally: server.server_close()
