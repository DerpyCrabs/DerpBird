#!/usr/bin/env python3
"""Exercise native shell menus with a real pointer in isolated Spark Wayland."""
import argparse, importlib.util, json, os, signal, subprocess, time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from PIL import Image


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('browser','environment','settings','output'):p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--expect-pass',action='store_true')
    a=p.parse_args(); env=dict(os.environ,**json.loads(a.environment.read_text()))
    assert 'artifacts' in env['XDG_RUNTIME_DIR']
    capture=dict(os.environ,XDG_RUNTIME_DIR=env['XDG_RUNTIME_DIR'],WAYLAND_DISPLAY=env['WAYLAND_DISPLAY'])
    a.output.mkdir(parents=True,exist_ok=True); profile=a.output/'profile';assert not profile.exists()
    (profile/'config').mkdir(parents=True)
    settings=json.loads(a.settings.read_text());settings.setdefault('tabs',{})['verticalTabsExpanded']=False
    (profile/'config/Settings.json').write_text(json.dumps(settings))
    spec=importlib.util.spec_from_file_location('pointer',Path(__file__).with_name('test-shell-surface-transitions.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    pointer=m.Pointer(capture,[1280,720])
    class Fixture(BaseHTTPRequestHandler):
        def do_GET(self):
            body=b'<!doctype html><title>Menu interaction</title><body style="background:#fff;color:#111"><h1>Page click target</h1><button onclick="document.body.dataset.clicked=\'yes\'">Click me</button></body>'
            self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(body)
        def log_message(self,*_):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Fixture);Thread(target=server.serve_forever,daemon=True).start()
    url='http://127.0.0.1:'+str(server.server_port)+'/'
    with (a.output/'browser.log').open('w') as log:
        browser=subprocess.Popen([str(a.browser),'--profile-path',str(profile.resolve()),'--devtools=18993',url],env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    def evaluate(code,target='about:derpbird'):
        path=a.output/'evaluate.js';path.write_text(code)
        r=subprocess.run(['python3',str(Path(__file__).with_name('ladybird-devtools-eval.py')),'--port','18993','--url',target,'--script',str(path)],capture_output=True,text=True,check=True,timeout=15)
        return json.loads(r.stdout).get('result')
    def until(code):
        end=time.monotonic()+15
        while time.monotonic()<end:
            try:
                v=evaluate(code)
                if v:return v
            except subprocess.CalledProcessError:pass
            time.sleep(.1)
        raise AssertionError(code)
    def geometry(selector):return json.loads(evaluate('JSON.stringify({r:document.querySelector('+json.dumps(selector)+').getBoundingClientRect().toJSON(),dpr:devicePixelRatio})'))
    def move(x,y,dpr):pointer.move(x*dpr,y*dpr);time.sleep(.15)
    def click(selector,button=272):
        g=geometry(selector);r=g['r'];move(r['left']+r['width']/2,r['top']+r['height']/2,g['dpr'])
        for state in (1,0):pointer.send(5,2,int(time.monotonic()*1000)&0xffffffff,button,state);pointer.send(5,4)
        time.sleep(.25)
    def screenshot(name):
        subprocess.run(['grim','-o','WAYLAND-1',str(a.output/(name+'.png'))],env=capture,check=True,timeout=10)
    results={}
    try:
        until('document.querySelector(".tab-title")?.textContent==="Menu interaction"')
        results['compact_mode_removed']=evaluate('!document.querySelector(".shell.compact, [aria-label^=Toggle]") && document.querySelector(".tab-title").getBoundingClientRect().width>0')
        click('[role=tab]',273);until('!!document.querySelector(".tab-menu")')
        g=geometry('#sidebar-resize');menu=geometry('.tab-menu')['r'];x=g['r']['right']-.5;y=menu['top']+35
        move(x,y,g['dpr']);time.sleep(.7)
        results['menu_above_resize']=evaluate('!!document.elementFromPoint('+str(x)+','+str(y)+').closest(".tab-menu")')
        screenshot('01-menu-over-divider')
        selector='.tab-menu button:nth-of-type(2)'
        pointer.move(1100,600);time.sleep(.15)
        before=evaluate('getComputedStyle(document.querySelector('+json.dumps(selector)+')).backgroundColor')
        g=geometry(selector);move(g['r']['left']+20,g['r']['top']+g['r']['height']/2,g['dpr'])
        after=evaluate('getComputedStyle(document.querySelector('+json.dumps(selector)+')).backgroundColor')
        results['hover_background']={'before':before,'after':after,'changed':before!=after}
        results['hover_media']=evaluate('matchMedia("(hover: hover)").matches')
        screenshot('02-menu-item-hover')
        im=Image.open(a.output/'02-menu-item-hover.png').convert('RGB')
        dpr=g['dpr'];cy=round((g['r']['top']+g['r']['height']/2)*dpr)
        selected=im.getpixel((round((g['r']['left']+4)*dpr),cy));background=im.getpixel((round((menu['left']+2)*dpr),cy))
        results['visible_hover_contrast']=max(abs(a-b) for a,b in zip(selected,background))>=10
        page=geometry('#content-surface');move(page['r']['right']-30,page['r']['bottom']-30,page['dpr']);pointer.button(True);pointer.button(False);time.sleep(.4)
        results['page_click_closes_tab_menu']=evaluate('!document.querySelector(".tab-menu")')
        screenshot('03-tab-menu-page-click')
        evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));true')
        click('[aria-label=Menu]');until('!!document.querySelector(".browser-menu")')
        results['collapse_menu_item_removed']=evaluate('!Array.from(document.querySelectorAll(".browser-menu button")).some(e=>/^(Collapse|Expand) tab bar$/.test(e.textContent))')
        click_target=geometry('.browser-menu button');move(click_target['r']['left']+20,click_target['r']['top']+click_target['r']['height']/2,click_target['dpr'])
        screenshot('04-browser-menu-hover')
        move(page['r']['left']+20,page['r']['bottom']-30,page['dpr']);pointer.button(True);pointer.button(False);time.sleep(.4)
        results['page_click_closes_browser_menu']=evaluate('!document.querySelector(".browser-menu")')
        screenshot('05-browser-menu-page-click')
        (a.output/'results.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results))
        if a.expect_pass:assert results['compact_mode_removed'] and results['collapse_menu_item_removed'] and results['visible_hover_contrast'] and results['menu_above_resize'] and results['hover_background']['changed'] and results['page_click_closes_tab_menu'] and results['page_click_closes_browser_menu'],results
    finally:
        pointer.close();server.shutdown();server.server_close()
        if browser.poll() is None:
            os.killpg(browser.pid,signal.SIGTERM)
            try:browser.wait(timeout=5)
            except subprocess.TimeoutExpired:os.killpg(browser.pid,signal.SIGKILL);browser.wait()

if __name__=='__main__':main()
