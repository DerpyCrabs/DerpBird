#!/usr/bin/env python3
"""Exercise native shell menus with a real pointer in isolated Spark Wayland."""
import argparse, importlib.util, json, os, signal, subprocess, time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread, Event
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
    release_load=Event()
    class Fixture(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path=='/slow':release_load.wait(15)
            body=b'<!doctype html><title>Menu interaction</title><body style="background:#1e1e1e;color:#ddd;margin:0;font-family:Inter"><h1>Inter: Aa Bb 0123</h1><p>Regular / Medium / Bold</p><button onclick="document.body.dataset.clicked=\'yes\'">Click me</button></body>'
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
        assert evaluate('Array.from(document.querySelectorAll(".tab > button:first-child,.new-tab")).every(e=>getComputedStyle(e).fontSize==="13px")'), "Tab text size changed: "+name
        if evaluate('!!document.querySelector(".shell.horizontal")'):
            centered=evaluate('(()=>{const b=document.querySelector(".new-tab").getBoundingClientRect(),i=document.querySelector(".new-tab svg").getBoundingClientRect(),t=document.querySelector(".tab").getBoundingClientRect();return Math.abs((b.left+b.right-i.left-i.right)/2)<.7 && Math.abs((b.top+b.bottom-i.top-i.bottom)/2)<.7 && Math.abs((b.top+b.bottom-t.top-t.bottom)/2)<.7})()')
            assert centered, 'New-tab icon/button not centered: '+name
            separators=evaluate('Array.from(document.querySelectorAll(".tab")).every(e=>{const hidden=e.classList.contains("active") || e.nextElementSibling?.classList.contains("active");return getComputedStyle(e,"::after").visibility===(hidden?"hidden":"visible")})')
            assert separators, 'Separators beside active tab or missing between inactive tabs: '+name
        subprocess.run(['grim','-o','WAYLAND-1',str(a.output/(name+'.png'))],env=capture,check=True,timeout=10)
    def command(value):
        evaluate('window.ladybird.sendMessage("derpbird.request",{requestId:window.layoutId=(window.layoutId??1000000)+1,payload:'+json.dumps({'type':'command','command':value})+'});true')
    results={}
    try:
        until('document.querySelector(".tab-title")?.textContent==="Menu interaction"')
        command({'type':'shell.set-layout','layout':'horizontal'})
        until('!!document.querySelector(".shell.horizontal")')
        for _ in range(2):command({'type':'tab.create','private':False,'url':url})
        until('document.querySelectorAll(".tab").length===3')
        ids=json.loads(evaluate('JSON.stringify(Array.from(document.querySelectorAll("[role=tab]")).map(e=>e.dataset.tabId))'))
        command({'type':'tab.tree-move','tabId':ids[1],'targetId':ids[0],'placement':'inside'})
        command({'type':'tab.activate','tabId':ids[1]})
        until('document.querySelector("[aria-selected=true]").dataset.tabId==='+json.dumps(ids[1]))
        pointer.move(1200,600);pointer.button(True);pointer.button(False);time.sleep(.2)
        style = 'JSON.stringify(Array.from(document.querySelectorAll(".tab")).map(e=>({active:e.classList.contains("active"),background:getComputedStyle(e).backgroundColor,radius:getComputedStyle(e).borderTopLeftRadius,border:getComputedStyle(e).borderTopWidth,outline:getComputedStyle(e).outlineWidth})))'
        results['group_styles']=json.loads(evaluate(style))
        results['inactive_group_uses_regular_background']=results['group_styles'][0]['background']==results['group_styles'][2]['background']
        results['only_active_highlighted']=results['group_styles'][1]['background']!=results['group_styles'][0]['background']
        results['no_rounded_tabs']=all(r['radius']=='0px' for r in results['group_styles'])
        results['no_group_frame']=all(r['border']=='0px' for r in results['group_styles'])
        results['no_counters']=evaluate('document.querySelectorAll(".group-count").length===0')
        results['tabs_above_address']=evaluate('document.querySelector(".tabs").getBoundingClientRect().bottom<=document.querySelector(".navigation").getBoundingClientRect().top')
        results['group_stripe']=evaluate('Array.from(document.querySelectorAll(".tab[data-group]")).every(e=>parseFloat(getComputedStyle(e,"::before").height)>0 && getComputedStyle(e,"::before").backgroundColor!=="rgba(0, 0, 0, 0)")')
        results['separators_without_gaps']=evaluate('getComputedStyle(document.querySelector(".tab-list")).columnGap==="0px" && Array.from(document.querySelectorAll(".tab")).every(e=>getComputedStyle(e).marginRight==="0px" && parseFloat(getComputedStyle(e,"::after").width)>0)')
        until('document.querySelectorAll(".tab-placeholder").length===3')
        screenshot('01-group-child-active')
        title_left=evaluate('document.querySelectorAll(".tab-title")[1].getBoundingClientRect().left')
        command({'type':'tab.navigate-input','tabId':ids[1],'url':url+'slow'})
        until('!!document.querySelector(".tab-loading")')
        screenshot('01b-loading')
        spin_before=evaluate('getComputedStyle(document.querySelector(".tab-loading")).transform')
        time.sleep(.12)
        results['loading_animates']=evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches') or evaluate('getComputedStyle(document.querySelector(".tab-loading")).transform')!=spin_before
        results['loading_slot_stable']=evaluate('document.querySelectorAll(".tab-title")[1].getBoundingClientRect().left')==title_left
        release_load.set();until('!document.querySelector(".tab-loading") && document.querySelectorAll(".tab-placeholder").length===3')
        screenshot('01c-loaded')
        click('[data-tab-id="'+ids[0]+'"]');pointer.move(1200,600);pointer.button(True);pointer.button(False);time.sleep(.2)
        results['root_active_styles']=json.loads(evaluate(style));screenshot('02-group-root-active')
        # Check the popup anchor after moving the toolbar, including wrapped tabs.
        click('[aria-label=Menu]');until('!!document.querySelector(".browser-menu")')
        results['menu_below_toolbar']=evaluate('document.querySelector(".browser-menu").getBoundingClientRect().top>=document.querySelector(".navigation").getBoundingClientRect().bottom-1')
        screenshot('03-horizontal-menu')
        evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));true')
        for _ in range(4):command({'type':'tab.create','private':False,'url':url})
        until('document.querySelectorAll(".tab").length===7')
        screenshot('04-tabs-overflow')
        all_ids=json.loads(evaluate('JSON.stringify(Array.from(document.querySelectorAll("[role=tab]")).map(e=>e.dataset.tabId))'))
        for tab_id in all_ids[3:6]:command({'type':'tab.tree-move','tabId':tab_id,'targetId':ids[0],'placement':'inside'})
        until('document.querySelectorAll(".tab[data-group]").length===5')
        command({'type':'shell.set-wrap-tabs','value':True});until('!!document.querySelector(".wrap-tabs")')
        results['wrapped_above_address']=evaluate('document.querySelector(".tabs").getBoundingClientRect().bottom<=document.querySelector(".navigation").getBoundingClientRect().top')
        results['two_rows']=evaluate('document.querySelector(".tabs").getBoundingClientRect().height>40')
        screenshot('05-wrapped-tabs')
        page_geometry=geometry('#content-surface')
        edge=round(page_geometry['r']['top']*page_geometry['dpr'])
        im=Image.open(a.output/'05-wrapped-tabs.png').convert('RGB')
        results['no_page_gap']=all(max(im.getpixel((1000,y)))<100 for y in range(edge-1,edge+2))
        click('[aria-label=Menu]');until('!!document.querySelector(".browser-menu")')
        results['wrapped_menu_below_toolbar']=evaluate('document.querySelector(".browser-menu").getBoundingClientRect().top>=document.querySelector(".navigation").getBoundingClientRect().bottom-1')
        screenshot('06-wrapped-menu')
        evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));true')
        command({'type':'shell.set-wrap-tabs','value':False})
        for tab_id in all_ids[1:]:command({'type':'tab.close','tabId':tab_id})
        until('document.querySelectorAll(".tab").length===1')
        screenshot('07-single-tab')
        click('.new-tab');until('document.querySelectorAll(".tab").length===2')
        g=geometry('.new-tab');r=g['r'];move(r['left']+r['width']/2,r['top']+r['height']/2,g['dpr'])
        until('document.querySelector(".new-tab").matches(":hover")')
        screenshot('08-new-tab-hover')
        command({'type':'shell.set-layout','layout':'vertical'});until('!!document.querySelector(".shell.vertical")')
        move(750,375,1.6);screenshot('09-vertical-tabs')
        click('[aria-label=Menu]');until('!!document.querySelector(".browser-menu")');screenshot('10-vertical-menu')
        evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));document.getElementById("location").focus();document.getElementById("location").value="about:";document.getElementById("location").dispatchEvent(new Event("input",{bubbles:true}));true')
        until('!!document.querySelector(".address-suggestions")');screenshot('11-address-suggestions')
        results['fontconfig_error']='Fontconfig error:' in (a.output/'browser.log').read_text()
        results['fontconfig_warnings_absent']='Fontconfig warning:' not in (a.output/'browser.log').read_text()
        (a.output/'results.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results))
        if a.expect_pass:
            assert not results['fontconfig_error'],results
            assert all(v for k,v in results.items() if isinstance(v,bool) and k!='fontconfig_error'),results
    finally:
        release_load.set();pointer.close();server.shutdown();server.server_close()
        if browser.poll() is None:
            os.killpg(browser.pid,signal.SIGTERM)
            try:browser.wait(timeout=5)
            except subprocess.TimeoutExpired:os.killpg(browser.pid,signal.SIGKILL);browser.wait()

if __name__=='__main__':main()
