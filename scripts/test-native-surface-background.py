#!/usr/bin/env python3
"""Check GPU page edges after background and layout changes on fractional Wayland.
Run in an isolated compositor with a 700x380 floating window at logical (7,7), scale 1.6.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import time
from urllib.parse import quote, unquote
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from collections import Counter
from io import BytesIO
from PIL import Image, ImageDraw


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', type=Path, required=True)
    parser.add_argument('--environment', type=Path, required=True)
    parser.add_argument('--settings', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    environment = dict(os.environ, **json.loads(args.environment.read_text()))
    assert 'artifacts' in environment['XDG_RUNTIME_DIR'], 'Use the isolated compositor'
    capture_environment = dict(os.environ, XDG_RUNTIME_DIR=environment['XDG_RUNTIME_DIR'], WAYLAND_DISPLAY=environment['WAYLAND_DISPLAY'])
    args.output.mkdir(parents=True, exist_ok=True)
    profile = args.output/'profile'
    assert not profile.exists(), 'Use a fresh test output directory'
    (profile/'config').mkdir(parents=True)
    settings = json.loads(args.settings.read_text())
    settings.setdefault('tabs', {})['verticalTabsEnabled'] = False
    settings['restorePreviousSession'] = False
    settings.pop('derpbirdSessionRestoreInitialized', None)
    (profile/'config/Settings.json').write_text(json.dumps(settings))
    helper = Path(__file__).with_name('ladybird-devtools-eval.py')
    spec = importlib.util.spec_from_file_location('transitions', Path(__file__).with_name('test-shell-surface-transitions.py'))
    transitions = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(transitions)
    pointer = transitions.Pointer(capture_environment, [1280,720])
    browser = None
    requests = Counter()
    icon = Image.new("RGBA", (24,24), "#2678d4")
    ImageDraw.Draw(icon).rectangle((6,6,17,17), fill="white")
    icon_bytes = BytesIO(); icon.save(icon_bytes, format="PNG")
    class Fixture(BaseHTTPRequestHandler):
        def do_GET(self):
            requests[self.path] += 1
            if self.path == '/favicon.png':
                self.send_response(200); self.send_header('Content-Type','image/png'); self.end_headers(); self.wfile.write(icon_bytes.getvalue()); return
            title = unquote(self.path.lstrip('/'))
            body = ('<!doctype html><link rel="icon" href="/favicon.png"><title>'+title+'</title><h1>'+title+'</h1>').encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        def log_message(self, *_):
            pass
    fixture = ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
    Thread(target=fixture.serve_forever, daemon=True).start()

    def evaluate(code):
        path = args.output/'evaluate.js'
        path.write_text(code)
        result = subprocess.run(['python3',str(helper),'--port','18993','--url','about:derpbird','--script',str(path)],capture_output=True,text=True,check=True,timeout=15)
        value = json.loads(result.stdout)
        assert not value.get('hasException'), value
        return value.get('result')

    def until(code):
        deadline = time.monotonic()+15
        while True:
            try:
                result = evaluate(code)
                if result:
                    return result
            except subprocess.CalledProcessError:
                pass
            assert browser.poll() is None and time.monotonic()<deadline, code
            time.sleep(.1)

    def command(value):
        evaluate('window.sessionTestResponse=null;document.addEventListener("WebUIMessage",e=>{if(e.detail.name==="derpbird.response"&&e.detail.data.requestId>=1000000)window.sessionTestResponse=e.detail.data},{once:false});window.ladybird.sendMessage("derpbird.request",{requestId:window.sessionTestRequestId=(window.sessionTestRequestId??1000000)+1,payload:'+json.dumps({'type':'command','command':value})+'});true')
        if value['type'] != 'window.close':
            response = json.loads(until('window.sessionTestResponse&&JSON.stringify(window.sessionTestResponse)'))
            assert response['ok'], response

    def capture(name):
        time.sleep(.2)
        subprocess.run(['grim','-o','WAYLAND-1',str(args.output/(name+'.png'))],env=capture_environment,check=True,timeout=10)

    def launch(name, urls=()):
        nonlocal browser
        with (args.output/(name+'.log')).open('w') as log:
            browser = subprocess.Popen([str(args.browser),'--profile-path',str(profile.resolve()),'--devtools=18993',*urls],env=environment,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        until('document.querySelectorAll("[role=tab]").length>0')

    def close_window():
        try:
            command({'type':'window.close'})
        except subprocess.CalledProcessError:
            pass  # The DevTools socket may close before its reply arrives.
        assert browser.wait(timeout=15)==0, 'Browser did not exit cleanly'

    def url(title):
        return 'http://127.0.0.1:'+str(fixture.server_port)+'/'+quote(title)

    snapshot = '''JSON.stringify(Array.from(document.querySelectorAll('.tab')).map((e,i,rows)=>({
      title:e.querySelector('.tab-title').textContent,
      url:e.querySelector('[role=tab]').title.split('\\n').at(-1),
      parent:e.classList.contains('tree-child')?rows.findIndex(r=>r.querySelector('[role=tab]').dataset.tabId===e.dataset.group):-1,
      active:e.querySelector('[role=tab]').getAttribute('aria-selected')==='true'
    })))'''
    try:
        page_url='http://127.0.0.1:'+str(fixture.server_port)+'/Surface'
        launch('page', [page_url])
        until('!document.querySelector(".tab-loading")')
        for index,layout in enumerate(['horizontal','vertical','horizontal']):
            command({'type':'shell.set-layout','layout':layout})
            until('!!document.querySelector(".shell.'+layout+'")')
            for color in ['#ffffff','#303637']:
                script=args.output/'background.js'
                script.write_text('document.documentElement.style.background='+json.dumps(color)+';document.body.style.background='+json.dumps(color)+';true')
                subprocess.run(['python3',str(helper),'--port','18993','--url',page_url,'--script',str(script)],check=True,capture_output=True,text=True)
                time.sleep(.2)
            name=str(index+1)+'-'+layout+'-dark'
            capture(name)
            geometry=json.loads(evaluate('JSON.stringify({r:document.getElementById("content-surface").getBoundingClientRect().toJSON(),dpr:devicePixelRatio})'))
            assert geometry['dpr']==1.6, geometry
            rect=geometry['r'];scale=geometry['dpr']
            im=Image.open(args.output/(name+'.png')).convert('RGB')
            top=round((7+rect['top'])*scale)
            left=round((7+rect['left']+8)*scale);right=round((7+rect['right']-8)*scale)
            bright=[(x,y) for y in range(top-1,top+2) for x in range(left,right) if max(im.getpixel((x,y)))>120]
            assert not bright, {'case':name,'bright_edge_pixels':len(bright),'first':bright[:5],'geometry':geometry}
        close_window()
        print('PASS: no stale light pixels at the GPU page boundary after background/layout changes')
    except Exception:
        if browser and browser.poll() is None:
            try:
                capture('failure')
            except Exception:
                pass
        raise
    finally:
        fixture.shutdown()
        fixture.server_close()
        pointer.close()
        if browser and browser.poll() is None:
            os.killpg(browser.pid,signal.SIGTERM)
            try:
                browser.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(browser.pid,signal.SIGKILL); browser.wait()


if __name__=='__main__':
    main()
