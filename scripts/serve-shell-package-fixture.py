#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

parser = argparse.ArgumentParser()
parser.add_argument('--root', type=Path, required=True)
parser.add_argument('--port', type=int, default=8766)
parser.add_argument('--local-dependencies', action='store_true')
args = parser.parse_args()
args.root.mkdir(parents=True, exist_ok=True)
for kind in ('scripts', 'styles', 'profile'):
    (args.root / kind).mkdir(exist_ok=True)
script = '// ==UserScript==\n// @name Directory smoke\n// @match http://127.0.0.1:8766/*\n// @grant none\n// ==/UserScript==\ndocument.documentElement.dataset.folderScript = "version-one";\n'
if args.local_dependencies:
    script = script.replace('// @grant none', '// @require ./library.js\n// @resource local ./resource.txt\n// @grant GM_getResourceText').replace('"version-one"', 'folderLibrary + ":" + GM_getResourceText("local")')
    (args.root / 'scripts/library.js').write_text('var folderLibrary = "library-one";')
    (args.root / 'scripts/resource.txt').write_text('resource-one')
script = script.replace('127.0.0.1:8766', f'127.0.0.1:{args.port}')
(args.root / 'scripts/smoke.user.js').write_text(script)
(args.root / 'styles/smoke.user.css').write_text('@-moz-document url-prefix("http://127.0.0.1:8766/") { body { background-color: rgb(24, 48, 72) !important; color: white; } }')
# Profile data directory is supplied explicitly via test environment after profile creation.
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/report?'):
            with (args.root / 'reports.jsonl').open('a') as output:
                output.write(json.dumps({'path': self.path}) + '\n')
            self.send_response(204); self.end_headers(); return
        self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.end_headers()
        self.wfile.write(b'''<!doctype html><title>Directory fixture</title><style>body{font:24px sans-serif;padding:40px}p{font-size:18px}</style><h1>Directory sources</h1><p id="result">Waiting for script and style</p><p>Find this phrase: shell package</p><script>
let last='';let n=0;const timer=setInterval(()=>{const value=JSON.stringify({script:document.documentElement.dataset.folderScript||null,background:getComputedStyle(document.body).backgroundColor});document.querySelector('#result').textContent=value;if(value!==last){last=value;fetch('/report?value='+encodeURIComponent(value));}if(++n>120)clearInterval(timer)},250);
</script>''')
    def log_message(self, *args): pass
print(f'Fixture port {args.port}', flush=True)
ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
