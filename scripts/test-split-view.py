#!/usr/bin/env python3
"""Exercise split tabs in a disposable native browser on an isolated compositor."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from PIL import Image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--environment', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--browser', type=Path, default=Path('vendor/ladybird/Build/release/bin/Ladybird'))
    parser.add_argument('--close-only', action='store_true')
    parser.add_argument('--layouts', action='store_true')
    parser.add_argument('--workspaces', action='store_true')
    args = parser.parse_args()
    env = dict(os.environ, **json.loads(args.environment.read_text()), DERPBIRD_UI='1')
    assert 'artifacts' in env['XDG_RUNTIME_DIR'], 'Use an isolated test compositor'
    args.output.mkdir(parents=True, exist_ok=True)
    profile = args.output / 'profile'
    assert not profile.exists(), 'Use a fresh test output directory'
    (profile / 'config').mkdir(parents=True)
    (profile / 'data').mkdir()
    (profile / 'data/ImportWelcomeSeen').write_text('1\n')
    (profile / 'config/Settings.json').write_text(json.dumps({'firstRunComplete': True, 'restorePreviousSession': True, 'derpbirdSessionRestoreInitialized': True}))
    helper = Path(__file__).with_name('ladybird-devtools-eval.py')
    spec = importlib.util.spec_from_file_location('transitions', Path(__file__).with_name('test-shell-surface-transitions.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    pointer = module.Pointer(env, [1280, 800])
    colors = {'Notes': '#e8e4da', 'Checklist': '#dce5ec', 'Release': '#f0e0d8'}
    class Fixture(BaseHTTPRequestHandler):
        def do_GET(self):
            name = self.path.strip('/')
            body = ('<!doctype html><title>'+name+'</title><style>body{margin:24px;background:'+colors.get(name, '#ffffff')+';font:20px sans-serif}button{font:inherit}</style><h1>'+name+'</h1><button onclick="this.textContent=\'Clicked\'">Click me</button><p><a id=middle href="/'+name+'-middle">Middle click</a> <a id=target target=_blank href="/'+name+'-target">New tab link</a> <button id=script onclick="window.open(\'/'+name+'-script\')">Open tab</button></p>').encode()
            self.send_response(200); self.send_header('Content-Type', 'text/html'); self.end_headers(); self.wfile.write(body)
        def log_message(self, *_): pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
    Thread(target=server.serve_forever, daemon=True).start()
    urls = {name: f'http://127.0.0.1:{server.server_port}/{name}' for name in colors}
    browser = None
    def evaluate(code, url='about:derpbird'):
        script = args.output / 'evaluate.js'; script.write_text(code)
        result = subprocess.run(['python3', str(helper), '--port', '18993', '--url', url, '--script', str(script)], capture_output=True, text=True, timeout=15, check=True)
        value = json.loads(result.stdout); assert not value.get('hasException'), value
        return value.get('result')
    def until(code, url='about:derpbird'):
        deadline = time.monotonic() + 20
        while True:
            try:
                value = evaluate(code, url)
                if value: return value
            except subprocess.CalledProcessError: pass
            assert browser.poll() is None and time.monotonic() < deadline, code
            time.sleep(.1)
    def request(payload, expected_error=False):
        evaluate('''if(!window.splitTestListener){window.splitTestListener=true;document.addEventListener('WebUIMessage',e=>{if(e.detail.name==='derpbird.response'&&e.detail.data.requestId===window.splitTestId)window.splitTestResponse=e.detail.data})}window.splitTestResponse=null;window.ladybird.sendMessage('derpbird.request',{requestId:window.splitTestId=(window.splitTestId??1000000)+1,payload:'''+json.dumps(payload)+'});true')
        response = json.loads(until('window.splitTestResponse&&JSON.stringify(window.splitTestResponse)'))
        assert response['ok'] != expected_error, response
        return response.get('value')
    def command(value): return request({'type': 'command', 'command': value})
    def snapshot(): return request({'type': 'snapshot'})
    def bounds(selector):
        return json.loads(evaluate('JSON.stringify((()=>{const r=document.querySelector('+json.dumps(selector)+').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})())'))
    def click(x, y):
        pointer.move(x, y); time.sleep(.3); pointer.button(True); time.sleep(.06); pointer.button(False); time.sleep(.15)
    def drag(start, end, preview=None, cancel=False):
        pointer.move(*start); time.sleep(.1); pointer.button(True); time.sleep(.1)
        for step in range(1, 17):
            pointer.move(start[0]+(end[0]-start[0])*step/16, start[1]+(end[1]-start[1])*step/16); time.sleep(.04)
        if preview: capture(preview)
        if cancel: evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true")
        pointer.button(False); time.sleep(.5)
    def capture(name):
        time.sleep(.3)
        path = args.output / (name+'.png')
        subprocess.run(['grim', '-o', 'HEADLESS-1', str(path)], env=env, check=True, timeout=10)
        return Image.open(path)
    def launch(url_list=()):
        nonlocal browser
        log = open(args.output / f'browser-{time.time_ns()}.log', 'w')
        browser = subprocess.Popen([str(args.browser.resolve()), '--profile-path', str(profile.resolve()), '--devtools=18993', *url_list], env=env, stdout=log, stderr=log, start_new_session=True)
        log.close()
        until('document.querySelectorAll("[role=tab]").length>=3')
    def tab_center(tab_id):
        selector = '[role=tab][data-tab-id="'+tab_id+'"]'
        # Pin/unpin now animates the real tab. Resolve the pointer destination
        # only after its rendered geometry settles, not from a transient frame.
        previous = None
        stable = 0
        deadline = time.monotonic() + 3
        while stable < 3:
            r = bounds(selector)
            stable = stable + 1 if r == previous else 0
            previous = r
            assert time.monotonic() < deadline, ('Tab did not settle', tab_id, r)
            time.sleep(.05)
        return (r['x']+r['width']/2, r['y']+r['height']/2)
    def open_child(name, method, keep=False):
        command({'type': 'tab.activate', 'tabId': ids[name]})
        before = snapshot()
        existing_ids = {tab['id'] for tab in before['tabs']}
        split = next((item for item in before['splits'] if ids[name] in [item['firstTabId'], item['secondTabId']]), None)
        page = bounds('#content-surface')
        x, y = page['x'], page['y']
        if split and split['secondTabId'] == ids[name]:
            if split['axis'] == 'horizontal': x += int((page['width']-6)*split['ratio'])+6
            else: y += int((page['height']-6)*split['ratio'])+6
        rect = json.loads(evaluate('JSON.stringify((()=>{const r=document.getElementById('+json.dumps(method)+').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})())', urls[name]))
        pointer.move(x+rect['x']+rect['width']/2, y+rect['y']+rect['height']/2); time.sleep(.15)
        button = 274 if method == 'middle' else 272
        pointer.send(5, 2, int(time.monotonic()*1000)&0xffffffff, button, 1); pointer.send(5, 4)
        pointer.send(5, 2, int(time.monotonic()*1000)&0xffffffff, button, 0); pointer.send(5, 4)
        until('document.querySelectorAll("[role=tab]").length==='+str(len(existing_ids)+1))
        after = snapshot()
        child = next(tab for tab in after['tabs'] if tab['id'] not in existing_ids)
        parent = split['firstTabId'] if split else ids[name]
        assert child.get('parentId') == parent, {'source':name,'method':method,'child':child,'snapshot':after}
        assert after['splits'] == before['splits'], 'Opening a child dissolved or changed its split'
        assert evaluate('document.querySelectorAll(".tree-child").length') >= 1
        capture('child-'+name+'-'+method)
        if not keep:
            command({'type':'tab.close','tabId':child['id']})
            until('document.querySelectorAll("[role=tab]").length==='+str(len(existing_ids)))
            command({'type':'tab.activate','tabId':ids[name]})
        return child['id']
    def close_cases():
        def create():
            before = {tab['id'] for tab in snapshot()['tabs']}
            command({'type':'tab.create','private':False,'url':urls['Notes']+'-close-'+str(time.time_ns())})
            return next(tab['id'] for tab in snapshot()['tabs'] if tab['id'] not in before)
        def close(tab_id, active):
            if active: command({'type':'tab.activate','tabId':tab_id})
            count = len(snapshot()['tabs'])
            r = bounds('[role=tab][data-tab-id="'+tab_id+'"] + .close-tab')
            click(r['x']+r['width']/2, r['y']+r['height']/2)
            until('document.querySelectorAll("[role=tab]").length==='+str(count-1))
            assert browser.poll() is None, 'Browser crashed while closing a tab'
        command({'type':'shell.set-layout','layout':'vertical'})
        # Closing ordinary foreground/background tabs exercises the stack's
        # temporary mismatch between its page count and the tab-bar count.
        for _ in range(4):
            first, second = create(), create()
            close(first, False)
            close(second, True)
        for close_first in [True, False]:
            first, second = create(), create()
            command({'type':'tab.split','tabId':second,'targetId':first,'edge':'right'})
            command({'type':'tab.new-child','tabId':second})
            state = snapshot()
            children = [tab['id'] for tab in state['tabs'] if tab.get('parentId') == first]
            assert len(children) == 1 and len(state['splits']) == 1, state
            close(first if close_first else second, True)
            state = snapshot(); assert not state['splits'], state
            assert all(tab.get('parentId') != (first if close_first else second) for tab in state['tabs'])
            close(children[0], True)
            close(second if close_first else first, True)
        # Close an ordinary group parent and then its promoted child.
        parent = create()
        command({'type':'tab.new-child','tabId':parent})
        child = next(tab['id'] for tab in snapshot()['tabs'] if tab.get('parentId') == parent)
        close(parent, True)
        assert all(tab.get('parentId') != parent for tab in snapshot()['tabs'])
        close(child, True)
        # Final-tab closure must terminate cleanly, not dereference a missing page.
        while len(snapshot()['tabs']) > 1: close(snapshot()['tabs'][-1]['id'], True)
        r = bounds('.close-tab'); click(r['x']+r['width']/2, r['y']+r['height']/2)
        assert browser.wait(timeout=15) == 0, 'Browser crashed while closing its final tab'
    def layout_cases():
        arrangements = [dict(preset='classic', side='left', address='top'), dict(preset='bottom', side='left', address='bottom')]
        for side in ['left', 'right']:
            arrangements += [dict(preset='sidebar', side=side, address=address) for address in ['top', 'bottom']]
            arrangements.append(dict(preset='compact', side=side, address='top'))
        command({'type':'browser.open-page','page':'settings'})
        until('document.querySelector(".layout-settings") !== null', 'about:settings')
        settings_id=snapshot()['activeTabId']
        for index, layout in enumerate(arrangements):
            command({'type':'tab.activate','tabId':settings_id})
            def choose(name, value):
                evaluate('document.querySelector('+json.dumps('input[name="'+name+'"][value="'+value+'"]')+').click();true','about:settings')
            choose('browser-layout',layout['preset'])
            if layout['preset'] in ['sidebar','compact']:
                until('document.querySelector("input[name=tab-side]") !== null','about:settings')
                choose('tab-side',layout['side'])
            if layout['preset']=='sidebar':choose('address-position',layout['address'])
            expected=dict(layout)
            # Compact mode retains the last full-width address preference.
            if layout['preset']=='compact':expected['address']='bottom'
            until('document.querySelector(".shell").classList.contains('+json.dumps('horizontal' if layout['preset'] in ['classic','bottom'] else 'vertical')+')')
            assert snapshot()['preferences']['chromeLayout']==expected, snapshot()['preferences']
            command({'type':'tab.activate','tabId':ids['Notes']})
            page=bounds('#content-surface')
            until('Math.abs(innerWidth-'+str(page['width'])+')<=2',urls['Notes'])
            image=capture('layout-'+str(index))
            # A real page must paint all the way to the shell edges.
            for x,y in [(page['x']+page['width']/2,page['y']+page['height']/2),(page['x']+page['width']-2,page['y']+page['height']-2)]:
                assert image.getpixel((round(x),round(y)))[:3]==(232,228,218), ('unpainted content',layout,x,y)
            evaluate('window.layoutKeys=[];document.addEventListener("keydown",e=>layoutKeys.push([e.key,e.ctrlKey]));window.addEventListener("derpbird-focus-address",()=>layoutKeys.push("native-focus"));true')
            click(page['x']+page['width']/2,page['y']+page['height']/2)
            subprocess.run(['wtype','-s','100','-M','ctrl','-k','l','-m','ctrl'],env=env,check=True,timeout=10)
            selector='#palette-location' if layout['preset']=='compact' else '#location'
            try:until('document.activeElement===document.querySelector('+json.dumps(selector)+')')
            except AssertionError:
                capture('focus-failed')
                print(evaluate('JSON.stringify({active:document.activeElement?.id,keys:window.layoutKeys,focus:document.hasFocus()})'),flush=True)
                raise
            if layout['preset']=='compact':
                opened=capture('palette-open-'+str(index))
                # The dialog must overlay, not erase, the separate native page.
                sample=(round(page['x']+page['width']-20),round(page['y']+page['height']-20))
                before=image.getpixel(sample)[:3];after=opened.getpixel(sample)[:3]
                assert after[0]>after[2]+5 and after[0]>80, ('page replaced by gray behind palette',before,after)
                popup=bounds('.address-palette')
                corner=opened.getpixel((round(popup['x']+1),round(popup['y']+1)))[:3]
                assert corner[0]>corner[2]+2, ('opaque rectangle behind rounded dialog corner',corner)
                click(page['x']+page['width']-20,page['y']+page['height']-20)
                until('document.querySelector(".address-palette")===null')
                subprocess.run(['wtype','-M','ctrl','-k','l','-m','ctrl'],env=env,check=True,timeout=10)
                until('document.activeElement===document.querySelector("#palette-location")')
            evaluate('window.layoutInput=document.querySelector('+json.dumps(selector)+');layoutInput.value="typed.example";layoutInput.dispatchEvent(new Event("input",{bubbles:true}));layoutInput.setSelectionRange(2,6);true')
            command({'type':'tab.mute','tabId':ids['Release'],'value':index%2==0})
            assert evaluate('document.activeElement===layoutInput&&layoutInput.value==="typed.example"&&layoutInput.selectionStart===2&&layoutInput.selectionEnd===6'), 'URL input flicker'
            if layout['preset']=='compact':evaluate('document.querySelector('+json.dumps('[aria-label="Close address palette"]')+').click();true')
            else:subprocess.run(['wtype','-k','Escape'],env=env,check=True,timeout=10)
            drag(tab_center(ids['Release']),tab_center(ids['Notes']))
            assert next(t for t in snapshot()['tabs'] if t['id']==ids['Release']).get('parentId')==ids['Notes']
            before=snapshot()['tabs'];drag(tab_center(ids['Notes']),tab_center(ids['Checklist']),cancel=True)
            assert snapshot()['tabs']==before, 'Cancelled drag changed groups'
            command({'type':'tab.ungroup','tabId':ids['Release']})
            assert all('parentId' not in t for t in snapshot()['tabs'])
        try:command({'type':'window.close'})
        except (subprocess.CalledProcessError,AssertionError):pass
        assert browser.wait(timeout=15)==0
        launch()
        assert snapshot()['preferences']['chromeLayout']==expected, 'Layout lost on restart'
        command({'type':'tab.activate','tabId':next(t['id'] for t in snapshot()['tabs'] if t['url']=='about:settings')})
        until('document.querySelector("input[name=browser-layout][value=compact]:checked")!==null','about:settings')
        assert evaluate('document.querySelector("input[name=tab-side][value=right]").checked','about:settings')
        capture('settings-restored')
        (args.output/'report.json').write_text(json.dumps({'passed':True,'layouts':arrangements,'checks':['real Settings controls','native saved preferences','native content edge coverage','native Ctrl+L','URL node/focus/caret stability','drag grouping','Escape cancellation','ungroup','restart and Settings restoration']},indent=2))
        print('Native browser layouts passed:',args.output)
    def check_pair_highlight():
        assert evaluate('document.querySelectorAll(".split-tab .tab.active").length') == 2
        assert evaluate('document.querySelectorAll(".split-tab [aria-selected=true]").length') == 1
        if evaluate('document.querySelector(".shell").classList.contains("vertical")'):
            assert evaluate('(()=>{const rows=[...document.querySelectorAll(".split-tab .tab")];const active=rows.find(row=>row.querySelector("[aria-selected=true]"));const inactive=rows.find(row=>!row.querySelector("[aria-selected=true]"));return getComputedStyle(active).backgroundColor!==getComputedStyle(inactive).backgroundColor})()'), 'Selected split member must have a distinct surface'
    def workspace_cases():
        state = snapshot()
        assert len(state['workspaces']['items']) == 1
        assert evaluate("document.querySelector('.workspace-shortcuts').hidden")
        original = {t['url'] for t in state['tabs']}
        first = state['tabs'][0]['id']
        command({'type':'tab.pin','tabId':first,'value':True})
        # Open the real form from the menu, then submit with real keyboard input.
        for selector in ['button[aria-label=Menu]', '[aria-label="New workspace"]']:
            r=bounds(selector);click(r['x']+r['width']/2,r['y']+r['height']/2)
        until('document.querySelector(".workspace-popover input")!==null')
        subprocess.run(['wtype','Research'],env=env,check=True)
        subprocess.run(['wtype','-k','Return'],env=env,check=True)
        until('document.querySelectorAll(".workspace-shortcuts [aria-pressed]").length===2')
        state=snapshot();research=state['workspaces']['active'];assert research!='default'
        assert len(state['tabs'])==1 and all(t['url'] not in original for t in state['tabs']),state
        command({'type':'workspace.update','id':research,'name':'Project','icon':'code','color':'lilac'})
        command({'type':'shell.set-sidebar-width','width':240})
        for i in range(9):
            command({'type':'tab.create','private':False,'url':urls['Notes']+'?pin='+str(i)})
            command({'type':'tab.pin','tabId':snapshot()['activeTabId'],'value':True})
        until('document.querySelectorAll(".pinned-tab-unit").length===9')
        rects=json.loads(evaluate('JSON.stringify([...document.querySelectorAll(".pinned-tab-unit")].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}))'))
        assert len({r['y'] for r in rects})==2 and all(r['w']==32 and r['h']==32 for r in rects),rects
        assert rects[5]['y']==rects[0]['y'] and rects[6]['y']>rects[0]['y'],rects
        for _ in range(12):
            subprocess.run(['wtype','-M','ctrl','-k','Tab','-m','ctrl'],env=env,check=True)
        assert snapshot()['workspaces']['active']==research
        # Closing the sole tab of a fresh workspace keeps its page selection local.
        command({'type':'workspace.create','name':'Temporary','icon':'leaf','color':'blue'})
        temporary=snapshot()['workspaces']['active']
        command({'type':'tab.close','tabId':snapshot()['activeTabId']})
        time.sleep(.3)
        assert snapshot()['workspaces']['active']==temporary
        command({'type':'workspace.switch','id':research})
        capture('workspaces-nine-pins')
        command({'type':'workspace.switch','id':'default'})
        assert {t['url'] for t in snapshot()['tabs']}==original
        command({'type':'workspace.switch','id':research})
        current=snapshot();assert sum(t['pinned'] for t in current['tabs'])==9
        ordinary=next(t for t in current['tabs'] if not t['pinned'])
        command({'type':'tab.close-others','tabId':ordinary['id']})
        time.sleep(.3)
        command({'type':'workspace.switch','id':'default'})
        assert {t['url'] for t in snapshot()['tabs']}==original
        try:command({'type':'window.close'})
        except (subprocess.CalledProcessError,AssertionError):pass
        assert browser.wait(timeout=15)==0
        launch()
        state=snapshot();assert len(state['workspaces']['items'])==3,state
        command({'type':'workspace.switch','id':research})
        state=snapshot();assert sum(t['pinned'] for t in state['tabs'])==9,state
        assert next(w for w in state['workspaces']['items'] if w['id']==research)['name']=='Project'
        command({'type':'workspace.switch','id':'default'})
        assert {t['url'] for t in snapshot()['tabs']}==original
        assert sum(t['pinned'] for t in snapshot()['tabs'])==1
        capture('workspaces-restored')
        try:command({'type':'window.close'})
        except (subprocess.CalledProcessError,AssertionError):pass
        assert browser.wait(timeout=15)==0
        persisted=(profile/'config/DerpBirdChrome.ini').read_bytes()
        launch()
        # Create the private window through the product command, close the ordinary
        # one in the same source document, then target the sole remaining shell.
        evaluate("window.ladybird.sendMessage('derpbird.request',{requestId:900001,payload:{type:'command',command:{type:'window.new',private:true}}});window.ladybird.sendMessage('derpbird.request',{requestId:900002,payload:{type:'command',command:{type:'window.close'}}});true")
        until('document.querySelectorAll("[role=tab]").length===1')
        assert all(t['private'] for t in snapshot()['tabs'])
        assert len(snapshot()['workspaces']['items'])==1
        command({'type':'workspace.create','name':'Private only','icon':'home','color':'peach'})
        command({'type':'tab.pin','tabId':snapshot()['activeTabId'],'value':True})
        try:command({'type':'window.close'})
        except (subprocess.CalledProcessError,AssertionError):pass
        assert browser.wait(timeout=15)==0
        assert (profile/'config/DerpBirdChrome.ini').read_bytes()==persisted,'Private workspaces were persisted'
        (args.output/'report.json').write_text(json.dumps({'passed':True,'checks':['real form keyboard creation','hidden Default controls','workspace switch isolation','rename and icon/color','9 pins 6+3 at fixed size','bulk close isolation','restart persistence of workspaces and pins','Ctrl+Tab isolation','last tab close stays in workspace','private workspace isolation and no persistence']},indent=2))
        print('Native workspace checks passed:',args.output,flush=True)

    try:
        launch(list(urls.values()))
        if args.workspaces:
            workspace_cases()
            return
        if args.close_only:
            close_cases()
            (args.output/'report.json').write_text(json.dumps({'passed':True,'checks':['ordinary foreground/background close','both split halves with children','group parent close','final tab close']}))
            print('Native close regression passed:',args.output)
            return
        state = snapshot()
        (args.output / 'initial.json').write_text(json.dumps(state, indent=2))
        ids = {tab['title']: tab['id'] for tab in state['tabs']}
        if args.layouts:
            layout_cases()
            return
        command({'type': 'shell.set-layout', 'layout': 'horizontal'})
        command({'type': 'tab.activate', 'tabId': ids['Notes']})
        for method in ['middle', 'target', 'script']: open_child('Notes', method)
        page = bounds('#content-surface')
        drag(tab_center(ids['Checklist']), (page['x']+page['width']-10, page['y']+page['height']/2), preview='00-edge-preview')
        until('document.querySelectorAll(".split-tab").length===1')
        state = snapshot(); assert len(state['splits']) == 1, state
        assert state['splits'][0]['axis'] == 'horizontal'
        capture('01-side-by-side')
        widths = json.loads(evaluate('JSON.stringify(Array.from(document.querySelectorAll(".tab-unit"),e=>e.getBoundingClientRect().width))'))
        # The approved design gives each split member a full ordinary-tab width.
        assert len(widths) == 2 and abs(widths[0]-2*widths[1]) <= 1, widths
        halves = json.loads(evaluate('JSON.stringify(Array.from(document.querySelectorAll(".split-tab .tab"),e=>e.getBoundingClientRect().width))'))
        assert abs(halves[0]-halves[1]) <= 1 and abs(sum(halves)-widths[0]) <= 1, halves
        preview = Image.open(args.output/'00-edge-preview.png')
        assert preview.getpixel((100, 700))[:3] == (232, 228, 218), 'Drag preview blanked the page'
        assert preview.getpixel((1000, 700))[:3] != (232, 228, 218), 'Drop target is not visible'
        for name in ['Notes', 'Checklist']:
            for method in ['middle', 'target', 'script']: open_child(name, method)
            check_pair_highlight()
        # Both native documents must be visible, narrower than the page viewport.
        for name in ['Notes', 'Checklist']:
            assert evaluate('document.visibilityState', urls[name]) == 'visible'
            width = float(evaluate('innerWidth', urls[name])); assert abs(width - (page['width']-6)/2) <= 2, width
        # A real click in the other pane activates its shared navigation and reaches the page.
        click(page['x']+60, page['y']+110)
        assert snapshot()['activeTabId'] == ids['Notes']
        assert evaluate('document.querySelector("button").textContent', urls['Notes']) == 'Clicked'
        # Open the actual split-half context menu and use its sole split action.
        pointer.move(*tab_center(ids['Notes'])); time.sleep(.1)
        pointer.send(5, 2, int(time.monotonic()*1000)&0xffffffff, 273, 1); pointer.send(5, 4)
        pointer.send(5, 2, int(time.monotonic()*1000)&0xffffffff, 273, 0); pointer.send(5, 4)
        until('document.querySelector(".tab-menu")!==null')
        menu_text = evaluate('document.querySelector(".tab-menu").textContent')
        assert 'Switch to top and bottom' in menu_text and 'Swap panes' not in menu_text and 'Move to group' not in menu_text
        assert not evaluate('document.querySelector(".tab-menu hr + hr")!==null')
        capture('01-split-menu')
        r = bounds('.tab-menu button'); click(r['x']+r['width']/2, r['y']+r['height']/2)
        until('document.querySelector(".split-divider.vertical")!==null')
        capture('02-top-and-bottom')
        for name in ['Notes', 'Checklist']:
            height = float(evaluate('innerHeight', urls[name])); assert abs(height - (page['height']-6)/2) <= 2, height
        divider = bounds('.split-divider')
        drag((divider['x']+divider['width']/2, divider['y']+3), (page['x']+page['width']/2, page['y']+page['height']*.65))
        state = snapshot(); assert .60 < state['splits'][0]['ratio'] < .70, state
        # The focused divider also supports keyboard resizing with bounded values.
        evaluate("document.querySelector('.split-divider').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));true")
        until('document.querySelector(".split-divider").getAttribute("aria-valuenow")==="80"')
        assert snapshot()['splits'][0]['ratio'] == .8
        evaluate("document.querySelector('.split-divider').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));true")
        until('document.querySelector(".split-divider").getAttribute("aria-valuenow")==="75"')
        assert snapshot()['splits'][0]['ratio'] == .75
        capture('03-resized')
        command({'type': 'tab.activate', 'tabId': ids['Release']})
        until('document.querySelector(".split-divider")===null')
        assert evaluate('document.visibilityState', urls['Notes']) == 'hidden'
        command({'type': 'tab.activate', 'tabId': ids['Checklist']})
        until('document.querySelector(".split-divider")!==null')
        command({'type': 'shell.set-layout', 'layout': 'vertical'})
        check_pair_highlight()
        capture('04-vertical-tabs')
        ratio = snapshot()['splits'][0]['ratio']
        # Escape cancels tab drops without changing the current pair or group tree.
        drag(tab_center(ids['Release']), (page['x']+10, page['y']+page['height']/2), cancel=True)
        assert len(snapshot()['splits']) == 1 and snapshot()['splits'][0]['ratio'] == ratio
        # A normal window close and restart preserves pair membership, axis and ratio.
        try: command({'type': 'window.close'})
        except (subprocess.CalledProcessError, AssertionError): pass
        assert browser.wait(timeout=15) == 0
        launch()
        until('document.querySelector(".split-divider.vertical")!==null')
        restored = snapshot()
        assert len(restored['splits']) == 1 and abs(restored['splits'][0]['ratio']-ratio) < .00001, restored
        ids = {tab['title']: tab['id'] for tab in restored['tabs']}
        restored_image = capture('04-restored')
        page = bounds('#content-surface')
        restored_sizes = {name: json.loads(evaluate('JSON.stringify({width:innerWidth,height:innerHeight,visibility:document.visibilityState})', urls[name])) for name in ['Notes', 'Checklist']}
        (args.output/'restored-sizes.json').write_text(json.dumps({'page':page,'ratio':ratio,'sizes':restored_sizes},indent=2))
        for name, proportion in [('Notes',ratio),('Checklist',1-ratio)]:
            assert abs(restored_sizes[name]['height']-(page['height']-6)*proportion) <= 2, restored_sizes

        assert restored_image.getpixel((1200, 400))[:3] == (232, 228, 218), 'Restored first pane has an unpainted area'
        # Closing one half returns the survivor to a full-width ordinary tab.
        command({'type': 'tab.close', 'tabId': ids['Checklist']})
        until('document.querySelectorAll("[role=tab]").length===2&&document.querySelector(".split-divider")===null')
        state = snapshot(); assert not state['splits'] and state['activeTabId'] == ids['Notes'], state
        command({'type': 'tab.activate', 'tabId': ids['Notes']})
        page = bounds('#content-surface')
        assert abs(float(evaluate('innerWidth', urls['Notes']))-page['width']) <= 2
        # The same pointer gesture still creates a group in the tab strip.
        drag(tab_center(ids['Release']), tab_center(ids['Notes']))
        until('document.querySelectorAll(".tree-child").length===1')
        capture('05-grouping')
        # Extracting that grouped tab to any edge creates the expected ordering.
        for edge, x, y, axis in [('left', .01, .5, 'horizontal'), ('top', .5, .01, 'vertical'), ('bottom', .5, .99, 'vertical')]:
            page = bounds('#content-surface')
            drag(tab_center(ids['Release']), (page['x']+page['width']*x, page['y']+page['height']*y))
            state = snapshot(); assert state['splits'], (edge, state)
            split = state['splits'][0]
            assert split['axis'] == axis and all('parentId' not in tab for tab in state['tabs']), state
            assert split['firstTabId' if edge in ['left', 'top'] else 'secondTabId'] == ids['Release']
            command({'type': 'tab.pin', 'tabId': ids['Release'], 'value': True})
            assert not snapshot()['splits']
            command({'type': 'tab.pin', 'tabId': ids['Release'], 'value': False})
            command({'type': 'tab.activate', 'tabId': ids['Notes']})
        capture('06-unpinned')
        close_cases()
        (args.output / 'report.json').write_text(json.dumps({'passed': True, 'checks': ['edge split', 'both native surfaces', 'page focus and input', 'switch axis', 'resize', 'switch away and back', 'both tab layouts', 'close half', 'drag grouping', 'all four edges', 'cancel drag', 'restart persistence', 'pin half', 'context menu', 'keyboard resizing', 'equal tab widths', 'preview pixels', 'ordinary tab children: middle click, target blank, window.open', 'both split halves: middle click, target blank, window.open', 'whole pair highlight', 'ordinary foreground/background close', 'both split halves with children', 'group parent close', 'final tab close']}, indent=2))
        print('Native split interactions passed:', args.output)
    finally:
        if browser and browser.poll() is None:
            os.killpg(browser.pid, signal.SIGTERM)
            try: browser.wait(timeout=10)
            except subprocess.TimeoutExpired: os.killpg(browser.pid, signal.SIGKILL)
        pointer.close(); server.shutdown()

if __name__ == '__main__': main()
