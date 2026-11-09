#!/usr/bin/env python3
"""Verify normal browser restart and hover-only close buttons on isolated Wayland."""
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
        launch('first', [url('Session root')])
        until('document.querySelector(".tab-title").textContent==="Session root"')
        for title in ['Session child','Session other','Discarded tab']:
            command({'type':'tab.create','url':url(title),'private':False})
            until('Array.from(document.querySelectorAll(".tab-title")).some(e=>e.textContent==='+json.dumps(title)+')')
        until('document.querySelectorAll(".tab-favicon").length===4')
        ids = json.loads(evaluate('JSON.stringify(Array.from(document.querySelectorAll("[role=tab]")).map(e=>e.dataset.tabId))'))
        command({'type':'tab.tree-move','tabId':ids[1],'targetId':ids[0],'placement':'inside'})
        until('document.querySelectorAll(".tree-child").length===1')
        # Close through the real hit target, then verify it stays closed across restart.
        rect = json.loads(evaluate('JSON.stringify({rect:document.querySelector("[aria-label=\\"Close Discarded tab\\"]").getBoundingClientRect().toJSON(),dpr:devicePixelRatio})'))
        pointer.move((rect['rect']['left']+rect['rect']['width']/2)*rect['dpr'],(rect['rect']['top']+rect['rect']['height']/2)*rect['dpr'])
        until('getComputedStyle(document.querySelector("[aria-label=\\"Close Discarded tab\\"]")).opacity!=="0"')
        pointer.button(True); pointer.button(False)
        until('document.querySelectorAll(".tab").length===3')
        command({'type':'tab.activate','tabId':ids[1]})
        until('document.querySelector("[role=tab][aria-selected=true]").dataset.tabId==='+json.dumps(ids[1]))
        pointer.move(1200,600)
        until('Array.from(document.querySelectorAll(".close-tab")).every(e=>getComputedStyle(e).opacity==="0")')
        before = json.loads(evaluate(snapshot))
        capture('01-close-buttons-hidden')
        rect = json.loads(evaluate('JSON.stringify({rect:document.querySelector("[role=tab]").getBoundingClientRect().toJSON(),dpr:devicePixelRatio})'))
        pointer.move((rect['rect']['left']+40)*rect['dpr'],(rect['rect']['top']+rect['rect']['height']/2)*rect['dpr'])
        until('getComputedStyle(document.querySelector(".close-tab")).opacity!=="0"')
        assert evaluate('Array.from(document.querySelectorAll(".close-tab")).slice(1).every(e=>getComputedStyle(e).opacity==="0")')
        capture('02-close-button-hover')
        close_window()
        saved = json.loads((profile/'config/Settings.json').read_text())
        assert saved['restorePreviousSession'] and saved['derpbirdSessionRestoreInitialized']
        pointer.move(1200,600)
        requests.clear()
        launch('restored')
        until('document.querySelectorAll(".tab").length===3 && document.querySelectorAll(".tree-child").length===1')
        until('document.querySelectorAll(".tab-favicon").length===3 && !document.querySelector(".tab-loading")')
        expected_paths = ['/'+quote(title) for title in ['Session root','Session child','Session other']]
        assert all(requests[path] >= 1 for path in expected_paths), dict(requests)
        assert requests['/'+quote('Discarded tab')] == 0, dict(requests)
        after = json.loads(evaluate(snapshot))
        assert after==before, {'before':before,'after':after}
        assert evaluate('Array.from(document.querySelectorAll(".tab-title")).every(e=>getComputedStyle(e).textDecorationLine==="none")'), 'Restored background tabs must not underline their titles'
        capture('03-restored-session')
        evaluate('const input=document.getElementById("location");input.focus();input.value="Discarded";input.dispatchEvent(new Event("input",{bubbles:true}));true')
        until('Array.from(document.querySelectorAll(".address-suggestions button")).some(e=>e.querySelector("strong")?.textContent==="Discarded tab" && e.querySelector("img")?.naturalWidth>0)')
        assert requests['/'+quote('Discarded tab')] == 0, 'History lookup reloaded the closed page'
        capture('04-history-favicon-after-restart')
        close_window()
        (args.output/'results.json').write_text(json.dumps({'before':before,'after':after,'all_tabs_loaded_without_activation':True,'history_favicon_survived_restart':True,'normal_exit':True,'hover_only_close':True,'legacy_setting_migrated':True},indent=2)+'\n')
        print('PASS: tabs, order, active tab and group restored; closed tab absent; hover-only close button')
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
