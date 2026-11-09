#!/usr/bin/env python3
"""Local subscription graph, failures and preserved-cache checks for Wayland."""
import argparse
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=18946)
parser.add_argument('--profile', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
args.profile.mkdir(parents=True, exist_ok=False)
(args.profile / 'config').mkdir()
cache = args.profile / 'data/ContentBlocking/Lists'
cache.mkdir(parents=True)
subscriptions = ['main', 'missing', 'escape', 'redirect', 'cycle']
for key in subscriptions:
    path = cache / f'{key}.txt'
    path.write_text(f'/previous-{key}$xhr\n')
    os.utime(path, (1, 1))
(args.profile / 'config/Settings.json').write_text(json.dumps({
    'firstRunComplete': True, 'restorePreviousSession': False,
    'backgroundNetworking': {'enabled': True, 'features': {'contentBlockerSubscriptionUpdates': True}},
    'contentBlockers': {'enabled': True, 'builtInLists': {'easyList': False, 'easyPrivacy': False},
        'customSubscriptions': [{'identifier': key, 'enabled': True, 'url': f'http://127.0.0.1:{args.port}/lists/{key}.txt'} for key in subscriptions]},
}))
args.output.parent.mkdir(parents=True, exist_ok=True)
lock = threading.Lock()
hits = set()
def record(value):
    with lock, args.output.open('a') as stream:
        stream.write(json.dumps({'time': time.time(), **value}) + '\n')

files = {
    '/lists/main.txt': '/root-block$xhr\n!#if false\n/disabled-block$xhr\n!#include forbidden.txt\n!#endif\n!#if (ext_ublock && !env_firefox)\n!#include child.txt\n!#else\n/firefox-only$xhr\n!#endif\n',
    '/lists/child.txt': '/child-block$xhr\n!#include nested/leaf.txt\n',
    '/lists/nested/leaf.txt': '/leaf-block$xhr\n',
    '/lists/missing.txt': '/new-missing$xhr\n!#include absent.txt\n',
    '/lists/escape.txt': '/new-escape$xhr\n!#include ../outside.txt\n',
    '/lists/redirect.txt': '/new-redirect$xhr\n!#include redirect-child.txt\n',
    '/lists/cycle.txt': '/new-cycle$xhr\n!#include cycle.txt\n',
}
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_POST(self): self.do_GET()
    def do_GET(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        hits.add(self.path)
        record({'path': self.path, 'method': self.command, 'body': body.decode(errors='replace')})
        if self.path == '/lists/redirect-child.txt':
            self.send_response(302); self.send_header('Location', '/outside.txt'); self.end_headers(); return
        if self.path.startswith('/lists/') and self.path not in files:
            self.send_error(404); return
        if self.path == '/ready':
            done = '/lists/cycle.txt' in hits and '/lists/absent.txt' in hits and '/lists/redirect-child.txt' in hits
            main = (cache / 'main.txt').read_text()
            state = {'ready': done and '/leaf-block' in main,
                     'preserved': all((cache / f'{key}.txt').read_text() == f'/previous-{key}$xhr\n' for key in subscriptions[1:]),
                     'no_escape': '/outside.txt' not in hits and '/lists/forbidden.txt' not in hits}
            payload = json.dumps(state).encode(); mime = 'application/json'
        elif self.path == '/': payload = PAGE.encode(); mime = 'text/html; charset=utf-8'
        else: payload = files.get(self.path, 'ok').encode(); mime = 'text/plain'
        self.send_response(200); self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload)
PAGE = r'''<!doctype html><meta charset=utf-8><title>Filter lists</title>
<style>body{background:#171923;color:#eef;font:18px system-ui;margin:36px}pre{line-height:1.6;color:#bce8d0}</style>
<h1>Подписки: условия и включения</h1><pre id=result>Обновление списков…</pre><script>
(async()=>{
 let state;for(let i=0;i<100;i++){state=await(await fetch('/ready')).json();if(state.ready)break;await new Promise(r=>setTimeout(r,100))}
 if(!state.ready)throw Error('Subscription update did not complete');
 await new Promise(r=>setTimeout(r,300));
 const lines=[];const record=(name,ok)=>{lines.push(name+': '+(ok?'PASS':'FAIL'));result.textContent=lines.join('\n')};
 async function blocked(path){try{await fetch(path);return false}catch{return true}}
 for(const path of ['/root-block','/child-block','/leaf-block'])record(path,await blocked(path));
 for(const path of ['/disabled-block','/firefox-only'])record(path,!(await blocked(path)));
 for(const key of ['missing','escape','redirect','cycle'])record('Preserved '+key,await blocked('/previous-'+key));
 record('Atomic cache files',state.preserved);record('No inactive/escaping requests',state.no_escape);
 record('Successful root replaced',!(await blocked('/previous-main')));
 await fetch('/metrics',{method:'POST',body:JSON.stringify(lines)});
})().catch(e=>result.textContent='ERROR '+e);
</script>'''
print(f'http://127.0.0.1:{args.port}/', flush=True)
ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
