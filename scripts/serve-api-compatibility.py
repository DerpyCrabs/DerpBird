#!/usr/bin/env python3
"""Isolated native Wayland userscript API acceptance fixture (real desktop backend)."""
import argparse
import json
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', required=True, type=Path)
parser.add_argument('--port', default=18968, type=int)
a = parser.parse_args()
a.root.mkdir(parents=True, exist_ok=False)
base = f'http://127.0.0.1:{a.port}'
source = f'''// ==UserScript==
// @name API compatibility
// @version 1
// @match {base}/index
// @sandbox DOM
// @grant GM.notification
// @grant GM_info
// ==/UserScript==
(async()=>{{
 const report=async(name,value)=>{{document.getElementById('status').textContent+=name+': '+JSON.stringify(value)+'\\n';await fetch('/report',{{method:'POST',body:JSON.stringify({{name,value}})}})}};
 try{{
 await report('info',{{updates:GM_info.scriptWillUpdate,private:GM_info.isIncognito,mode:GM_info.sandboxMode,url:GM_info.scriptUpdateURL}});
 await report('highlight',await GM.notification({{highlight:true}}));
 await report('timeout',await GM.notification({{text:'Timeout result',timeout:500}}));
 const first=GM.notification({{text:'First replacement',tag:'batch'}});
 const second=GM.notification({{text:'Second replacement',tag:'batch',timeout:800}});
 await report('replacement',[await first,await second]);
 await report('click-ready',true);
 await report('click',await GM.notification({{title:'DerpBird click test',text:'Click this notification',silent:true}}));
 void GM.notification({{title:'DerpBird retained URL',text:'Click after navigation',url:'{base}/target',silent:true}}).catch(console.error);
 setTimeout(()=>location.href='/after',1000);
 }}catch(error){{await report('failure',String(error))}}
}})();
'''
repo = Path(__file__).resolve().parents[1]
metadata = json.loads(subprocess.check_output(['bun', '-e', "import {parseUserScript} from './src/browser/user-scripts'; console.log(JSON.stringify(parseUserScript(await Bun.stdin.text())));"], input=source.encode(), cwd=repo))
profile = a.root / 'profile'
(profile/'config').mkdir(parents=True)
(profile/'data').mkdir()
(profile/'config/Settings.json').write_text(json.dumps({'firstRunComplete':True,'restorePreviousSession':False,'backgroundNetworking':{'enabled':False}}))
(profile/'data/DerpBirdScripts.json').write_text(json.dumps({'version':1,'items':[{'id':'api-compatibility','name':'API compatibility','source':source,'sourceURL':base+'/source.user.js','checkUpdates':True,'checkedAt':int(time.time()*1000),'enabled':True,'fileAccessGranted':False,'metadata':metadata}]}))
lock=threading.Lock()
def record(event):
    with lock,(a.root/'events.jsonl').open('a') as f:
        f.write(json.dumps({'time':time.time(),**event})+'\n')
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_POST(self):
        size=int(self.headers.get('Content-Length','0'))
        if size>65536: self.send_error(413); return
        record(json.loads(self.rfile.read(size)))
        self.send_response(204); self.end_headers()
    def do_GET(self):
        record({'path':self.path})
        body=(source if self.path=='/source.user.js' else '<!doctype html><meta charset=utf-8><title>API compatibility</title><style>body{background:#171923;color:#eee;font:22px monospace;padding:25px}</style><h1>API compatibility '+self.path+'</h1><pre id=status></pre>').encode()
        self.send_response(200)
        self.send_header('Content-Type','text/plain; charset=utf-8' if self.path=='/source.user.js' else 'text/html; charset=utf-8')
        self.send_header('Content-Length',str(len(body))); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(body)
print(base+'/index',flush=True)
ThreadingHTTPServer(('127.0.0.1',a.port),Handler).serve_forever()
