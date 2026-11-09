#!/usr/bin/env python3
"""Owned loopback fixture and optional fresh profile for native click-to-load QA."""
import argparse
import html
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=18945)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--profile', type=Path)
args = parser.parse_args()
args.output.parent.mkdir(parents=True, exist_ok=True)
if args.profile:
    args.profile.mkdir(parents=True, exist_ok=False)
    config = args.profile / 'config'
    config.mkdir()
    (config / 'Settings.json').write_text(json.dumps({
        'firstRunComplete': True,
        'restorePreviousSession': False,
        'backgroundNetworking': {'enabled': False},
        'contentBlockers': {'enabled': True, 'customFilters': '/clickframe$frame,redirect=click2load.html\n'},
    }))
lock = threading.Lock()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        with lock:
            with args.output.open('a') as output:
                output.write(json.dumps({'time': time.time(), 'host': self.headers.get('Host'), 'path': self.path}) + '\n')
        if self.path.startswith('/clickframe'):
            body = f'''<!doctype html><meta charset="utf-8"><title>Loaded once</title>
<style>body{{font:16px system-ui;background:#163c2e;color:#d8ffe9;padding:24px}}button{{font:inherit;padding:10px}}</style>
<h2>Фрейм загружен</h2><p>{html.escape(self.path)}</p><button onclick="location.reload()">Перезагрузить фрейм</button>'''
        else:
            body = f'''<!doctype html><meta charset="utf-8"><title>Click-to-load · DerpBird</title>
<style>body{{margin:32px;font:17px system-ui;background:#181b25;color:#edf0fa}}main{{display:flex;gap:24px;flex-wrap:wrap}}section{{width:460px}}iframe{{width:100%;height:260px;border:1px solid #596178;border-radius:12px}}p{{color:#bac4d9}}</style>
<h1>Загрузка заблокированных фреймов</h1><p>Каждая кнопка разрешает одну загрузку. Повторная загрузка снова должна показать блокировку.</p>
<main><section><h2>Тот же origin</h2><iframe src="/clickframe?first"></iframe></section>
<section><h2>Другой origin</h2><iframe src="http://localhost:{args.port}/clickframe?second"></iframe></section></main>'''
        payload = body.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
print(f'Click-to-load fixture: http://127.0.0.1:{server.server_port}', flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
