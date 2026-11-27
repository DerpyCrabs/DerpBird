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
    parser.add_argument('--selection-only', action='store_true', help='Exercise opening and closing without checking the theme')
    args = parser.parse_args()
    environment = dict(os.environ, **json.loads(args.environment.read_text()))
    assert 'artifacts' in environment['XDG_RUNTIME_DIR'], 'Use the isolated compositor'
    args.output.mkdir(parents=True, exist_ok=True)
    profile = args.output / 'profile'
    (profile / 'config').mkdir(parents=True, exist_ok=True)
    (profile / 'data').mkdir(exist_ok=True)
    (profile / 'data/ImportWelcomeSeen').write_text('1')
    shutil.copyfile(args.settings, profile / 'config/Settings.json')
    icon = io.BytesIO()
    Image.new('RGBA', (16, 16), '#56ae85').save(icon, format='PNG')

    child_icon = io.BytesIO()
    Image.new('RGBA', (16, 16), '#d6b985').save(child_icon, format='PNG')

    downloads = args.output / 'downloads'
    downloads.mkdir(exist_ok=True)
    environment['XDG_DOWNLOAD_DIR'] = str(downloads.resolve())
    attachment = b'video attachment fixture'
    release_attachment = threading.Event()
    release_page = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            if self.path == '/slow-page':
                if not release_page.wait(15):
                    self.send_error(504)
                    return
                self.send_response(200)
                self.send_header('Content-Type', 'text/html')
                self.end_headers()
                self.wfile.write(b'<title>Delayed document</title>')
                return
            if self.path == '/clip.mp4':
                if not release_attachment.wait(15):
                    self.send_error(504)
                    return
                self.send_response(200)
                self.send_header('Content-Type', 'video/mp4')
                self.send_header('Content-Disposition', 'attachment; filename="clip.mp4"')
                self.send_header('Content-Length', str(len(attachment)))
                self.end_headers()
                self.wfile.write(attachment)
                return
            if self.path in ['/icon.png', '/child-icon.png']:
                body, mime = (icon if self.path == '/icon.png' else child_icon).getvalue(), 'image/png'
            elif self.path in ['/root', '/child', '/grandchild', '/middle']:
                title = {'/root': 'Root with icon', '/child': 'Child without icon', '/grandchild': 'Second child', '/middle': 'Middle-click child'}[self.path]
                favicon = '<link rel="icon" href="/icon.png">' if self.path == '/root' else '<link rel="icon" href="/child-icon.png">' if self.path == '/grandchild' else ''
                target = '/child' if self.path == '/root' else '/grandchild'
                body = (f'<!doctype html><title>{title}</title>{favicon}<body style="padding:24px;font:20px sans-serif"><h1>{title}</h1>'
                        f'<p><a id="open" target="_blank" href="{target}">Open child</a></p>'
                        '<p><a id="middle" href="/middle">Open with middle click</a></p>'
                        '<p><a id="download" target="_blank" href="/clip.mp4">Download</a></p>'
                        '<p><a id="slow" target="_blank" href="/slow-page">Delayed page</a></p>').encode()
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
    environment['DERPBIRD_PROFILE'] = str(profile.resolve())
    profile_args = [] if args.browser.name == 'derpbird' else ['--profile-path', str(profile.resolve())]
    with (args.output / 'browser.log').open('w') as log:
        browser = subprocess.Popen([str(args.browser), *profile_args, '--devtools=18993', base+'/root'], env=environment, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
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
            time.sleep(.3)
            for down in [1,0]:
                pointer.send(5,2,int(time.monotonic()*1000)&0xffffffff,button,down)
                pointer.send(5,4)
                time.sleep(.06)

        until('document.querySelector(".tab-favicon")?.complete')
        if evaluate('document.querySelector("[role=tablist]").getAttribute("aria-orientation")') != 'vertical':
            evaluate('window.ladybird.sendMessage("derpbird.request",{requestId:900001,payload:{type:"command",command:{type:"shell.set-layout",layout:"vertical"}}});true')
            until('document.querySelector("[role=tablist]").getAttribute("aria-orientation")==="vertical"')
        click_link('/root', '#open')
        until('document.querySelectorAll(".tree-child").length===1 && document.querySelector(".tree-child .tab-title")?.textContent==="Child without icon"')
        capture('01-page-opened-child')
        click_link('/child', '#open')
        until('document.querySelectorAll(".tree-child").length===2')
        until('Array.from(document.querySelectorAll(".tree-child .tab-title")).some(e=>e.textContent==="Second child")')
        rows = json.loads(evaluate('JSON.stringify(Array.from(document.querySelectorAll(".tab")).map(e=>({id:e.querySelector("[role=tab]").dataset.tabId,group:e.dataset.group,left:e.querySelector(".tab-title").getBoundingClientRect().left,border:getComputedStyle(e).borderLeftWidth,line:getComputedStyle(e,"::before").content})))'))
        assert rows[1]['group'] == rows[2]['group'] == rows[0]['id'], rows
        assert rows[1]['left'] == rows[2]['left'] > rows[0]['left'], rows
        if not args.selection_only:
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
        if not args.selection_only:
            assert evaluate('document.querySelectorAll(".tab:not(.tree-child) .tab-favicon").length') == 1
            assert evaluate('document.querySelectorAll(".tab:not(.tree-child) .tab-placeholder").length') == 1
        capture('04-ungrouped-new-tab-aligned')
        # The grandchild displays at level two but returns to its actual opener.
        def select(tab_id):
            selector = json.dumps(f'[role=tab][data-tab-id="{tab_id}"]')
            evaluate(f'document.querySelector({selector}).click();true')
            until(f'document.querySelector({selector}).getAttribute("aria-selected")==="true"')

        def close_active(expected):
            evaluate('document.querySelector("[aria-selected=true][role=tab]").closest(".tab").querySelector(".close-tab").click();true')
            until('document.querySelector("[aria-selected=true][role=tab]").dataset.tabId===' + json.dumps(expected))

        middle = evaluate('document.querySelectorAll(".tree-child [role=tab]")[2].dataset.tabId')
        select(rows[2]['id'])
        close_active(rows[1]['id'])
        close_active(middle)
        close_active(rows[0]['id'])
        def modified_click(modifiers, button):
            command = ['wtype']
            for modifier in modifiers:
                command.extend(['-M', modifier])
            command.extend(['-s', '1200'])
            for modifier in reversed(modifiers):
                command.extend(['-m', modifier])
            with subprocess.Popen(command, env=environment) as keyboard:
                time.sleep(.15)
                click_link('/root', '#middle', button)
                assert keyboard.wait(timeout=3) == 0

        for modifiers, button, foreground in [(['ctrl'], 272, False), (['ctrl', 'shift'], 272, True), (['shift'], 274, True)]:
            modified_click(modifiers, button)
            until('document.querySelectorAll(".tree-child").length===1')
            child = evaluate('document.querySelector(".tree-child [role=tab]").dataset.tabId')
            expected = child if foreground else rows[0]['id']
            assert evaluate('document.querySelector("[role=tab][aria-selected=true]").dataset.tabId') == expected
            if foreground:
                close_active(rows[0]['id'])
            else:
                evaluate('document.querySelector(".tree-child .close-tab").click();true')
                until('document.querySelectorAll(".tree-child").length===0')
                assert evaluate('document.querySelector("[role=tab][aria-selected=true]").dataset.tabId') == expected

        # Leave an unrelated top-level tab open throughout the reading queue.
        evaluate('window.ladybird.sendMessage("derpbird.request",{requestId:900002,payload:{type:"command",command:{type:"shell.set-layout",layout:"horizontal"}}});true')
        until('document.querySelector("[role=tablist]").getAttribute("aria-orientation")==="horizontal"')
        children = []
        for count in range(1, 4):
            click_link('/root', '#middle', 274)
            until(f'document.querySelectorAll(".tree-child").length==={count}')
            assert evaluate('document.querySelector("[role=tab][aria-selected=true]").dataset.tabId') == rows[0]['id']
            children.append(evaluate('Array.from(document.querySelectorAll(".tree-child [role=tab]")).at(-1).dataset.tabId'))
        for child in children:
            subprocess.run(['wtype', '-M', 'ctrl', '-k', 'w', '-m', 'ctrl'], env=environment, check=True)
            until('document.querySelector("[aria-selected=true][role=tab]").dataset.tabId===' + json.dumps(child))
        pinned = children[-1]
        pin_command = {'type': 'command', 'command': {'type': 'tab.pin', 'tabId': pinned, 'value': True}}
        evaluate('window.ladybird.sendMessage("derpbird.request",{requestId:900003,payload:'+json.dumps(pin_command)+'});true')
        until('document.querySelector(".pinned-tab-unit [role=tab]")?.dataset.tabId===' + json.dumps(pinned))
        # An unrelated tab remains to the right. Keep the server response pending
        # while inspecting selection so a transient foreground tab cannot pass.
        click_link('/middle', '#download')
        until('document.querySelectorAll("[role=tab]").length===3')
        active_id = 'document.querySelector("[role=tab][aria-selected=true]").dataset.tabId'
        assert evaluate(active_id) == pinned
        release_attachment.set()
        until('document.querySelectorAll("[role=tab]").length===2')
        assert evaluate(active_id) == pinned
        deadline = time.monotonic() + 5
        while not (downloads / 'clip.mp4').exists() and time.monotonic() < deadline:
            time.sleep(.05)
        assert (downloads / 'clip.mp4').read_bytes() == attachment
        # Completion can show the downloads popover above the content.
        until('document.querySelector("#downloads-popover:not([hidden])") !== null')
        until('Array.from(document.querySelectorAll(".transfer-row")).some(row=>row.querySelector("b").textContent==="clip.mp4" && row.title.startsWith("Finished · ") && row.querySelector("small").textContent.endsWith(new Intl.RelativeTimeFormat(undefined,{numeric:"auto"}).format(0,"second")))')
        evaluate('document.querySelector("#downloads-indicator").click();true')
        until('document.querySelector("#downloads-popover").hidden')

        tab_order = 'JSON.stringify(Array.from(document.querySelectorAll("[role=tab]"),e=>e.dataset.tabId))'
        unrelated = json.loads(evaluate(tab_order))[1]
        click_link('/middle', '#open')
        until('document.querySelectorAll("[role=tab]").length===3 && '+active_id+'!=='+json.dumps(pinned))
        first = evaluate(active_id)
        assert json.loads(evaluate(tab_order)) == [pinned, first, unrelated]
        select(pinned)
        click_link('/middle', '#open', 274)
        until('document.querySelectorAll("[role=tab]").length===4')
        order = json.loads(evaluate(tab_order))
        assert order[:2] == [pinned, first] and order[-1] == unrelated, order
        assert evaluate(active_id) == pinned
        click_link('/middle', '#slow')
        until('document.querySelectorAll("[role=tab]").length===5')
        select(unrelated)
        release_page.set()
        until('Array.from(document.querySelectorAll(".tab-title")).some(t=>t.textContent==="Delayed document")')
        assert evaluate(active_id) == unrelated
        (args.output/'results.json').write_text(json.dumps({'group_rows':rows,'top_level_title_offsets':top_level,'middle_click_grouped':True},indent=2)+'\n')
        print('PASS: page links, two-level tree, foreground/background gestures and close selection')
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
