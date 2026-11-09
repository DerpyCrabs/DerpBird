#!/usr/bin/env python3
"""Capture shell transitions in an isolated Spark Wayland session.

The browser must already be running with a disposable profile and DevTools.
Uses real compositor pointer events, never the user's desktop session.
"""
import argparse
import json
import math
import os
from pathlib import Path
import socket
import struct
import subprocess
import time
from PIL import Image, ImageChops


class Pointer:
    def __init__(self, environment, extent):
        self.extent = extent
        self.socket = socket.socket(socket.AF_UNIX)
        self.socket.settimeout(5)
        self.socket.connect(str(Path(environment['XDG_RUNTIME_DIR']) / environment['WAYLAND_DISPLAY']))
        self.send(1, 1, 2)  # wl_display.get_registry
        self.send(1, 0, 3)  # wl_display.sync
        manager = None
        while True:
            obj, header = struct.unpack('<II', self.read(8))
            payload = self.read((header >> 16) - 8)
            if obj == 2 and header & 65535 == 0:
                name, length = struct.unpack('<II', payload[:8])
                if payload[8:8 + length - 1] == b'zwlr_virtual_pointer_manager_v1':
                    manager = name
            if obj == 3:
                break
        assert manager is not None, 'Compositor does not support virtual pointer input'
        interface = b'zwlr_virtual_pointer_manager_v1\0'
        payload = (struct.pack('<II', manager, len(interface)) + interface
                   + b'\0' * (-len(interface) % 4) + struct.pack('<II', 1, 4))
        self.send(2, 0, payload=payload)
        self.send(4, 0, 0, 5)

    def read(self, size):
        result = b''
        while len(result) < size:
            part = self.socket.recv(size - len(result))
            if not part:
                raise RuntimeError('Wayland disconnected')
            result += part
        return result

    def send(self, obj, opcode, *values, payload=None):
        if payload is None:
            payload = struct.pack('<' + 'I' * len(values), *values)
        self.socket.sendall(struct.pack('<II', obj, ((8 + len(payload)) << 16) | opcode) + payload)

    def move(self, x, y):
        self.send(5, 1, int(time.monotonic() * 1000) & 0xffffffff,
                  round(x), round(y), *self.extent)
        self.send(5, 4)

    def button(self, pressed):
        self.send(5, 2, int(time.monotonic() * 1000) & 0xffffffff, 272, int(pressed))
        self.send(5, 4)

    def close(self):
        self.socket.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--environment', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--wayland-output', default='HEADLESS-1')
    parser.add_argument('--extent', type=int, nargs=2, default=[1920, 1080])
    parser.add_argument('--origin', type=float, nargs=2, default=[2, 2], help='Shell origin in physical output pixels')
    parser.add_argument('--port', type=int, default=18993)
    parser.add_argument('--layout', choices=['vertical', 'horizontal'], default='vertical')
    args = parser.parse_args()
    environment = json.loads(args.environment.read_text())
    assert 'artifacts' in environment['XDG_RUNTIME_DIR'], 'Use the isolated test compositor'
    capture_env = dict(os.environ, XDG_RUNTIME_DIR=environment['XDG_RUNTIME_DIR'], WAYLAND_DISPLAY=environment['WAYLAND_DISPLAY'])
    args.output.mkdir(parents=True, exist_ok=True)
    helper = Path(__file__).with_name('ladybird-devtools-eval.py')
    def evaluate(code, url="about:derpbird"):
        script = args.output / 'evaluate.js'
        script.write_text(code)
        result = subprocess.run(['python3', str(helper), '--port', str(args.port), '--url', url, '--script', str(script)], capture_output=True, text=True, timeout=15, check=True)
        response = json.loads(result.stdout)
        assert not response.get('hasException'), response
        return response.get('result')
    captures = []
    def capture(case, delay=.3):
        time.sleep(delay)
        path = args.output / (case + '.png')
        subprocess.run(['grim', '-o', args.wayland_output, str(path)], env=capture_env, check=True, timeout=10)
        captures.append(case)
    pointer = Pointer(capture_env, args.extent)
    try:
        pointer.move(args.extent[0] - 50, args.extent[1] - 100)
        evaluate('document.getElementById("location").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));document.getElementById("location").blur();"reset"')
        orientation = evaluate('document.querySelector("[role=tablist]").getAttribute("aria-orientation")')
        if orientation != args.layout:
            evaluate('document.querySelector("[aria-label=Menu]").click();"open"')
            label = 'Vertical tabs' if args.layout == 'vertical' else 'Horizontal tabs'
            evaluate('Array.from(document.querySelectorAll(".browser-menu button")).find(b=>b.textContent===' + json.dumps(label) + ').click();"layout"')
            evaluate('document.querySelector(".browser-menu")&&document.querySelector("[aria-label=Menu]").click();"close"')
        evaluate("document.body.style.cssText='margin:0;background:repeating-linear-gradient(0deg,#315777 0 12px,#25394b 12px 24px)';document.body.innerHTML='<div style=\"padding:24px;color:white;font:20px sans-serif\">Page rendering reference</div>'; 'fixture'", 'about:blank')
        content_geometry = json.loads(evaluate('JSON.stringify({dpr:devicePixelRatio,rect:document.getElementById("content-surface").getBoundingClientRect().toJSON()})'))
        capture('01-idle')
        evaluate('document.getElementById("location").focus();"focus"')
        capture('02-focus')
        for number, value in enumerate(['t', 'te', 'tes'], 3):
            evaluate('var a=document.getElementById("location");a.value=' + json.dumps(value) + ';a.dispatchEvent(new Event("input",{bubbles:true}));"input"')
            capture(f'{number:02}-{value}-transition', 0)
            capture(f'{number:02}-{value}-settled', .4)
        evaluate('document.getElementById("location").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));"dismiss"')
        capture('06-dismiss-transition', 0)
        capture('06-dismiss-settled')
        evaluate('document.querySelector("[aria-label=Menu]").click();"open"')
        capture('07-menu-transition', 0)
        capture('07-menu-settled')
        evaluate('document.querySelector("[aria-label=Menu]").click();"close"')
        capture('08-menu-dismiss')
        if args.layout == 'vertical':
            geometry = json.loads(evaluate('JSON.stringify({dpr:devicePixelRatio,rect:document.getElementById("sidebar-resize").getBoundingClientRect().toJSON()})'))
            rect, scale = geometry['rect'], geometry['dpr']
            x = args.origin[0] + (rect['left'] + rect['width'] / 2) * scale
            for case, y in [('09-hover-top', rect['top']+15), ('10-hover-middle', (rect['top']+rect['bottom'])/2), ('11-hover-bottom', rect['bottom']-30)]:
                pointer.move(x, args.origin[1]+y*scale)
                capture(case+'-transition', 0)
                capture(case+'-settled', .7)
            pointer.move(args.extent[0]-50, args.extent[1]-100)
            capture('12-hover-leave-transition', 0)
            capture('12-hover-leave-settled', .7)
            pointer.move(x, args.origin[1]+(rect['top']+80)*scale)
            pointer.button(True)
            delta = -70 if rect['left'] > args.extent[0]/scale*.35 else 70
            pointer.move(x+delta, args.origin[1]+(rect['top']+80)*scale)
            capture('13-drag-transition', 0)
            capture('13-drag-settled')
            pointer.button(False)
            pointer.move(args.extent[0]-50, args.extent[1]-100)
            capture('14-drag-release')
            resized = json.loads(evaluate('JSON.stringify(document.getElementById("sidebar-resize").getBoundingClientRect().toJSON())'))
            assert abs(resized['left']-rect['left']) > 20, 'Dragging did not resize the sidebar'
        # Compare the label area beneath the toolbar, outside popup shadows and
        # the status/SVG icons (whose raster quality has a separate oracle).
        # Typing must neither move text nor introduce clipped duplicate glyphs.
        failures = []
        if args.layout == 'vertical':
            scale = float(evaluate('devicePixelRatio'))
            ox, oy = args.origin
            box = (round(ox+22*scale), round(oy+40*scale), round(ox+50*scale), round(oy+180*scale))
            reference = Image.open(args.output/'01-idle.png').convert('RGB').crop(box)
            for case in captures:
                if case.startswith(('03-', '04-', '05-', '06-', '07-', '08-')):
                    actual = Image.open(args.output/(case+'.png')).convert('RGB').crop(box)
                    difference = ImageChops.difference(reference, actual)
                    if difference.getbbox():
                        failures.append(case)
                        difference.save(args.output/(case+'-unexpected-sidebar-difference.png'))
        # Keep a page patch outside both the address popup and browser menu.
        scale = content_geometry['dpr']
        rect = content_geometry['rect']
        ox, oy = args.origin
        box = (round(ox+(rect['left']+10)*scale), round(oy+(rect['bottom']-100)*scale),
               round(ox+(rect['left']+40)*scale), round(oy+(rect['bottom']-40)*scale))
        reference = Image.open(args.output/'01-idle.png').convert('RGB').crop(box)
        assert len(reference.getcolors(reference.width*reference.height) or []) > 1, 'Page fixture is obscured'
        page_failures = []
        for case in captures:
            if case.startswith(('02-', '03-', '04-', '05-', '06-', '07-', '08-')):
                actual = Image.open(args.output/(case+'.png')).convert('RGB').crop(box)
                if ImageChops.difference(reference, actual).getbbox():
                    page_failures.append(case)
        separator_failures = []
        if args.layout == 'vertical':
            rect = geometry['rect']
            left = math.floor(ox+rect['left']*scale)-1
            right = math.ceil(ox+rect['right']*scale)+1
            top = math.ceil(oy+rect['top']*scale)+3
            bottom = math.floor(oy+rect['bottom']*scale)-3
            for case in ['09-hover-top-settled', '10-hover-middle-settled', '11-hover-bottom-settled']:
                pixels = Image.open(args.output/(case+'.png')).convert('RGB').load()
                counts = [sum(g > r+8 and g > b+4 and g > 90 for r,g,b in [pixels[x,y] for x in range(left,right)]) for y in range(top,bottom)]
                if min(counts) < 1 or max(counts) > math.ceil(scale)+1:
                    separator_failures.append({'case':case,'min_width':min(counts),'max_width':max(counts)})
        result = {'layout':args.layout, 'captures':captures, 'unexpected_sidebar_changes':failures,
                  'unexpected_page_changes':page_failures, 'separator_failures':separator_failures}
        (args.output/'results.json').write_text(json.dumps(result, indent=2)+'\n')
        print(json.dumps(result), flush=True)
        if failures or page_failures or separator_failures:
            raise SystemExit(1)
    finally:
        pointer.close()


if __name__ == '__main__':
    main()
