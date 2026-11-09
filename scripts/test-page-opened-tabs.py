#!/usr/bin/env python3
"""Exercise page-opened tab groups and icon alignment in an isolated Wayland session."""
import argparse
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from PIL import Image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', type=Path, required=True)
    parser.add_argument('--environment', type=Path, required=True)
    parser.add_argument('--settings', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--wayland-output', default='WAYLAND-1')
    parser.add_argument('--extent', type=int, nargs=2, default=[1280, 720])
    args = parser.parse_args()
    environment = dict(os.environ, **json.loads(args.environment.read_text()))
    assert 'artifacts' in environment['XDG_RUNTIME_DIR'], 'Use the isolated compositor'
    args.output.mkdir(parents=True, exist_ok=True)
    profile = args.output / 'profile'
    (profile / 'config').mkdir(parents=True, exist_ok=True)
    shutil.copyfile(args.settings, profile / 'config/Settings.json')
    icon = io.BytesIO()
    Image.new('RGBA', (16, 16), '#56ae85').save(icon, format='PNG')

    child_icon = io.BytesIO()
    Image.new('RGBA', (16, 16), '#d6b985').save(child_icon, format='PNG')

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            if self.path in ['/icon.png', '/child-icon.png']:
                body, mime = (icon if self.path == '/icon.png' else child_icon).getvalue(), 'image/png'
            elif self.path in ['/root', '/child', '/grandchild', '/middle']:
                title = {'/root': 'Root with icon', '/child': 'Child without icon', '/grandchild': 'Second child', '/middle': 'Middle-click child'}[self.path]
                favicon = '<link rel="icon" href="/icon.png">' if self.path == '/root' else '<link rel="icon" href="/child-icon.png">' if self.path == '/grandchild' else ''
                target = '/child' if self.path == '/root' else '/grandchild'
                body = (f'<!doctype html><title>{title}</title>{favicon}<body style="padding:24px;font:20px sans-serif"><h1>{title}</h1>'
                        f'<p><a id="open" target="_blank" href="{target}">Open child</a></p>'
                        '<p><a id="middle" href="/middle">Open with middle click</a></p>').encode()
                mime = 'text/html'
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    helper = Path(__file__).with_name('ladybird-devtools-eval.py')
    spec = importlib.util.spec_from_file_location('transitions', Path(__file__).with_name('test-shell-surface-transitions.py'))
    transitions = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(transitions)
    pointer = transitions.Pointer(environment, args.extent)
    with (args.output / 'browser.log').open('w') as log:
        browser = subprocess.Popen([str(args.browser), '--profile-path', str(profile.resolve()), '--devtools=18993', base+'/root'], env=environment, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        def evaluate(code, url='about:derpbird'):
            path = args.output / 'evaluate.js'
            path.write_text(code)
            result = subprocess.run(['python3', str(helper), '--port', '18993', '--url', url, '--script', str(path)], capture_output=True, text=True, timeout=15, check=True)
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
                assert browser.poll() is None and time.monotonic() < deadline, code
                time.sleep(.1)

        def capture(name):
            time.sleep(.2)
            subprocess.run(['grim', '-o', args.wayland_output, str(args.output/(name+'.png'))], env=dict(os.environ, XDG_RUNTIME_DIR=environment['XDG_RUNTIME_DIR'], WAYLAND_DISPLAY=environment['WAYLAND_DISPLAY']), check=True, timeout=10)

        def click_link(path, selector, button=272):
            shell = json.loads(evaluate('JSON.stringify({dpr:devicePixelRatio,rect:document.getElementById("content-surface").getBoundingClientRect().toJSON()})'))
            link = json.loads(evaluate('JSON.stringify(document.querySelector('+json.dumps(selector)+').getBoundingClientRect().toJSON())', base+path))
            x = (shell['rect']['left']+link['left']+link['width']/2)*shell['dpr']
            y = (shell['rect']['top']+link['top']+link['height']/2)*shell['dpr']
            pointer.move(x,y)
            for down in [1,0]:
                pointer.send(5,2,int(time.monotonic()*1000)&0xffffffff,button,down)
                pointer.send(5,4)

        until('document.querySelector(".tab-favicon")?.complete')
        if evaluate('document.querySelector("[role=tablist]").getAttribute("aria-orientation")') != 'vertical':
            evaluate('document.querySelector("[aria-label=Menu]").click();Array.from(document.querySelectorAll(".browser-menu button")).find(b=>b.textContent==="Vertical tabs").click();document.querySelector(".browser-menu")&&document.querySelector("[aria-label=Menu]").click();true')
        click_link('/root', '#open')
        until('document.querySelectorAll(".tree-child").length===1 && document.querySelector(".tree-child .tab-title")?.textContent==="Child without icon"')
        capture('01-page-opened-child')
        click_link('/child', '#open')
        until('document.querySelectorAll(".tree-child").length===2')
        until('Array.from(document.querySelectorAll(".tree-child .tab-title")).some(e=>e.textContent==="Second child")')
        rows = json.loads(evaluate('JSON.stringify(Array.from(document.querySelectorAll(".tab")).map(e=>({id:e.querySelector("[role=tab]").dataset.tabId,group:e.dataset.group,left:e.querySelector(".tab-title").getBoundingClientRect().left,border:getComputedStyle(e).borderLeftWidth,line:getComputedStyle(e,"::before").content})))'))
        assert rows[1]['group'] == rows[2]['group'] == rows[0]['id'], rows
        assert rows[1]['left'] == rows[2]['left'] > rows[0]['left'], rows
        assert all(row['border']=='0px' and row['line'] in ['none','normal'] for row in rows), rows
        assert evaluate('document.querySelectorAll(".group-count").length') == 0
        capture('02-two-level-group-aligned')
        evaluate('document.querySelector("[role=tab]").click();true')
        click_link('/root', '#middle',274)
        until('document.querySelectorAll(".tree-child").length===3')
        assert evaluate('document.querySelector("[role=tab][aria-selected=true]").dataset.tabId') == rows[0]['id']
        capture('03-middle-click-group')
        evaluate('document.querySelector(".new-tab").click();true')
        until('document.querySelectorAll(".tab").length===5')
        top_level = json.loads(evaluate('JSON.stringify(Array.from(document.querySelectorAll(".tab:not(.tree-child) .tab-title")).map(e=>e.getBoundingClientRect().left))'))
        assert len(top_level)==2 and top_level[0]==top_level[1], top_level
        assert evaluate('document.querySelectorAll(".tab:not(.tree-child) .tab-favicon").length') == 1
        assert evaluate('document.querySelectorAll(".tab:not(.tree-child) .tab-placeholder").length') == 1
        capture('04-ungrouped-new-tab-aligned')
        (args.output/'results.json').write_text(json.dumps({'group_rows':rows,'top_level_title_offsets':top_level,'middle_click_grouped':True},indent=2)+'\n')
        print('PASS: icon alignment, page links, two-level limit, middle click, plain new tab, vertical decorations')
    except Exception:
        try:
            capture('failure')
            (args.output/'failure-state.json').write_text(evaluate('JSON.stringify(Array.from(document.querySelectorAll(".tab")).map(e=>({text:e.textContent,group:e.dataset.group,html:e.outerHTML})))'))
        except Exception:
            pass
        raise
    finally:
        pointer.close()
        if browser.poll() is None:
            os.killpg(browser.pid,signal.SIGTERM)
            try:
                browser.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(browser.pid,signal.SIGKILL)
                browser.wait()
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
