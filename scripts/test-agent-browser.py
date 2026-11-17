#!/usr/bin/env python3
"""Exercise the actual agent adapter in an owned Wayland compositor and profiles."""
import json
import os
from pathlib import Path
from test_compositor import sway_executable
import signal
import subprocess
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import urlparse, parse_qs

root = Path(__file__).resolve().parents[1]
out = Path(tempfile.mkdtemp(prefix='agent-browser-', dir=root / 'artifacts'))
runtime = out / 'runtime'
runtime.mkdir(mode=0o700)
config = out / 'sway.conf'
config.write_text('output HEADLESS-1 resolution 1280x900\noutput * bg #222222 solid_color\ndefault_border none\n')
compositor = sway_executable()
assert compositor.exists(), 'Set DERPBIRD_TEST_SWAY to the test compositor'
env = dict(os.environ, XDG_RUNTIME_DIR=str(runtime), WLR_BACKENDS='headless', WLR_RENDERER='pixman', WLR_LIBINPUT_NO_DEVICES='1', LD_LIBRARY_PATH=str(compositor.parent.parent / 'lib'))
env.pop('WAYLAND_DISPLAY', None)
env.pop('DISPLAY', None)
comp = subprocess.Popen([str(compositor), '-c', str(config)], env=env, stdout=(out / 'compositor.log').open('w'), stderr=subprocess.STDOUT, start_new_session=True)
keyboard = None

class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/data':
            body = b'{"ok":true}'
            mime = 'application/json'
        elif self.path.startswith('/frame?'):
            label = parse_qs(urlparse(self.path).query)['name'][0]
            body = f'''<!doctype html><label>Frame {label} <input></label><button>Apply {label}</button><output>Waiting</output><script>document.querySelector('button').onclick=e=>{{window.clicked=e.isTrusted;document.querySelector('output').textContent=document.querySelector('input').value}}</script>'''.encode()
            mime = 'text/html'
        else:
            body = b'''<!doctype html><title>Agent browser fixture</title>
<style>body{font:20px sans-serif;margin:40px;background:white;color:black}button,input{font:inherit;padding:12px;margin:8px}</style>
<h1>Agent fixture</h1><label>Name <input id="name"></label><button id="probe">Apply</button><output id="result">Ready</output>
<p><label>Color <select id="color"><option value="red">Red</option><option value="blue">Blue</option></select></label></p>
<label>Upload <input id="upload" type="file" multiple></label>
<div id="drag" style="width:100px;padding:20px;background:#ddd">Drag me</div><div id="drop" style="width:100px;padding:20px;background:#eee">Drop here</div>
<iframe title="Same frame" src="/frame?name=Same" style="width:450px;height:100px"></iframe><iframe title="Cross frame" src="http://localhost:PORT/frame?name=Cross" style="width:450px;height:100px"></iframe>
<script>document.querySelector('#probe').onclick=e=>{document.querySelector('#result').textContent=document.querySelector('#name').value;window.trusted=e.isTrusted;console.log('applied');fetch('/data')};</script>'''
            body = body.replace(b':PORT/', f':{self.server.server_port}/'.encode())
            mime = 'text/html'
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *_):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
Thread(target=server.serve_forever, daemon=True).start()
print(out, flush=True)
try:
    deadline = time.monotonic() + 15
    while not list(runtime.glob('wayland-*.lock')):
        assert comp.poll() is None and time.monotonic() < deadline, 'Test compositor failed'
        time.sleep(.1)
    display = next(path.name[:-5] for path in runtime.glob('wayland-*.lock'))
    env.update(WAYLAND_DISPLAY=display, QT_QPA_PLATFORM='wayland', AGENT_FIXTURE=f'http://127.0.0.1:{server.server_port}/', AGENT_OUTPUT=str(out))
    env.pop('LD_LIBRARY_PATH', None)
    keyboard = subprocess.Popen(['wtype', '-s', '240000'], env=env)
    result = subprocess.run(['bun', 'scripts/test-agent-browser.ts'], cwd=root, env=env, stdout=(out / 'test.log').open('w'), stderr=subprocess.STDOUT, timeout=180)
    print((out / 'test.log').read_text())
    (out / 'report.json').write_text(json.dumps({'passed': result.returncode == 0}))
    raise SystemExit(result.returncode)
finally:
    server.shutdown()
    if keyboard is not None:
        keyboard.terminate()
        keyboard.wait(timeout=5)
    os.killpg(comp.pid, signal.SIGTERM)
    try:
        comp.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(comp.pid, signal.SIGKILL)
        comp.wait()
