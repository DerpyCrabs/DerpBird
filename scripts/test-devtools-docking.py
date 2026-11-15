#!/usr/bin/env python3
"""Exercise native DevTools docking, picking and scrolling in an owned headless Wayland session."""
import importlib.util,json,os,signal,socket,struct,subprocess,tempfile,time,io
from PIL import Image
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from threading import Thread
from build_config import engine_build
root=Path(__file__).resolve().parents[1]
out=Path(tempfile.mkdtemp(prefix='devtools-docking-',dir=root/'artifacts'))
runtime=out/'runtime';runtime.mkdir(mode=0o700)
config=out/'sway.conf';config.write_text('output HEADLESS-1 resolution 1280x800\noutput * bg #222222 solid_color\ndefault_border none\ndefault_floating_border none\n')
compositor=Path(os.environ.get('DERPBIRD_TEST_SWAY','/tmp/derpbird-test-compositor/usr/bin/sway'))
assert compositor.exists(),'Set DERPBIRD_TEST_SWAY to an isolated-test sway executable'
env=dict(os.environ,XDG_RUNTIME_DIR=str(runtime),WLR_BACKENDS='headless',WLR_RENDERER='pixman',WLR_LIBINPUT_NO_DEVICES='1',LD_LIBRARY_PATH=str(compositor.parent.parent/'lib'))
env.pop('WAYLAND_DISPLAY',None);env.pop('DISPLAY',None)
comp=subprocess.Popen([str(compositor),'-c',str(config)],env=env,stdout=(out/'compositor.log').open('w'),stderr=subprocess.STDOUT,start_new_session=True)
browser=None;pointer=None;server=None
print(out,flush=True)
try:
 deadline=time.monotonic()+15
 while not list(runtime.glob('wayland-*')):
  assert comp.poll() is None and time.monotonic()<deadline,'Compositor failed';time.sleep(.1)
 display=next(p.name for p in runtime.glob('wayland-*') if not p.name.endswith('.lock'))
 env.update(WAYLAND_DISPLAY=display,QT_QPA_PLATFORM='wayland',DERPBIRD_UI='1');env.pop('LD_LIBRARY_PATH',None)
 spec=importlib.util.spec_from_file_location('pointer',root/'scripts/test-shell-surface-transitions.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);pointer=m.Pointer(env,[1280,800])
 image=Image.new('RGB',(420,280));image.putdata([(int(x*255/419),int(y*255/279),160) for y in range(280) for x in range(420)])
 image_buffer=io.BytesIO();image.save(image_buffer,format='JPEG');image_data=image_buffer.getvalue()
 class Fixture(BaseHTTPRequestHandler):
  def do_GET(self):
   if self.path=='/preview.jpg':
    self.send_response(200);self.send_header('Content-Type','image/jpeg');self.end_headers();self.wfile.write(image_data);return
   if self.path in ['/theme.css','/page.js']:
    self.send_response(200);self.send_header('Content-Type','text/css' if self.path.endswith('.css') else 'text/javascript');self.end_headers();self.wfile.write(b'body{color:#123}' if self.path.endswith('.css') else b'console.log("image fixture")');return
   body=b'<!doctype html><title>Docking fixture</title><link rel="stylesheet" href="/theme.css"><script src="/page.js"></script><style>body{margin:0;background:#f2f4f6;font:20px sans-serif}#probe{margin:40px;padding:20px;background:#abc;color:rgb(12,34,56);width:140px}</style><div id="probe">Pick this element</div><img src="/preview.jpg" width="210" height="140">'
   self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(body)
  def log_message(self,*_):pass
 server=ThreadingHTTPServer(('127.0.0.1',0),Fixture);Thread(target=server.serve_forever,daemon=True).start()
 profile=out/'profile';(profile/'config').mkdir(parents=True);(profile/'data').mkdir();(profile/'data/ImportWelcomeSeen').write_text('1')
 (profile/'config/Settings.json').write_text(json.dumps({'firstRunComplete':True,'restorePreviousSession':False,'backgroundNetworking':{'enabled':False}}))
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 browser=subprocess.Popen([str(engine_build()/'bin/Ladybird'),'--profile-path',str(profile),f'--devtools={port}',f'http://127.0.0.1:{server.server_port}/'],env=env,stdout=(out/'browser.log').open('w'),stderr=subprocess.STDOUT,start_new_session=True)
 def evaluate(code,role='tools'):
  with socket.create_connection(('127.0.0.1',port),3) as s:
   s.settimeout(4)
   def recv():
    size=b''
    while True:
     c=s.recv(1)
     if not c:raise RuntimeError('Connection closed')
     if c==b':':break
     size+=c
    n=int(size);data=b''
    while len(data)<n:data+=s.recv(n-len(data))
    return json.loads(data)
   def send(v):
    data=json.dumps(v).encode();s.sendall(str(len(data)).encode()+b':'+data)
   def wait(pred):
    for _ in range(256):
     v=recv()
     if v.get('error'):raise RuntimeError(v)
     if pred(v):return v
    raise RuntimeError('No response')
   recv();send({'to':'root','type':'listTabs'});tabs=wait(lambda x:'tabs'in x)['tabs']
   (out/'tabs.json').write_text(json.dumps(tabs));tabs=sorted([t for t in tabs if t['url']=='about:derpbird'],key=lambda t:t['browserId']);assert tabs,'No tools document'
   tab=tabs[0] if role=='shell' else tabs[-1]
   if role=='tools':assert len(tabs)>1,'Tools not open'
   send({'to':tab['actor'],'type':'getWatcher'});watcher=wait(lambda x:'actor'in x)['actor']
   send({'to':watcher,'type':'watchTargets','targetType':'frame'});target=wait(lambda x:x.get('type')=='target-available-form')['target']
   send({'to':target['consoleActor'],'type':'evaluateJSAsync','text':code});r=wait(lambda x:x.get('type')=='evaluationResult');assert not r.get('hasException'),r
   return r.get('result')
 def until(code,role='tools'):
  deadline=time.monotonic()+15
  while time.monotonic()<deadline:
   assert browser.poll() is None,'Browser exited'
   try:
    v=evaluate(code,role)
    if v:return v
   except (OSError,AssertionError,RuntimeError):pass
   time.sleep(.1)
  raise AssertionError(code)
 def capture(name):subprocess.run(['grim','-o','HEADLESS-1',str(out/(name+'.png'))],env=env,check=True,timeout=10)
 def rpc(payload,role='tools'):
  evaluate('window.testResponse=null;window.testId=(window.testId??1000000)+1;if(!window.testListener){window.testListener=true;document.addEventListener("WebUIMessage",e=>{if(e.detail.name==="derpbird.response"&&e.detail.data.requestId===window.testId)window.testResponse=e.detail.data})}window.ladybird.sendMessage("derpbird.request",{requestId:window.testId,payload:'+json.dumps(payload)+'});true',role)
  r=json.loads(until('window.testResponse&&JSON.stringify(window.testResponse)',role));assert r['ok'],r;return r.get('value')
 def click_selector(selector):evaluate('document.querySelector('+json.dumps(selector)+').click();true')
 def geometry():return json.loads(evaluate('JSON.stringify({w:innerWidth,h:innerHeight})'))
 until('!!document.querySelector(".tab.active")','shell')
 snapshot=rpc({'type':'snapshot'},'shell')
 tab=snapshot['tabs'][0]['id']
 rpc({'type':'command','command':{'type':'tab.inspect','tabId':tab}},'shell')
 time.sleep(1);capture('opened')
 until('!!document.querySelector(".dt")')
 results={}
 for dock in ['right','bottom','left','window','right']:
  click_selector('[aria-label="Dock position"]')
  until('!!document.querySelector(".dt-dock-menu")')
  click_selector('[aria-label="'+('Undock into separate window' if dock=='window' else 'Dock '+dock)+'"]')
  time.sleep(.35)
  state=rpc({'type':'devtools.bootstrap'});assert state['dock']==dock,state
  results[dock]=geometry();capture(dock)
 assert results['right']['h']>results['bottom']['h'],results
 assert results['bottom']['w']>results['right']['w'],results
 # The tools renderer survives every reparent, including undocking.
 evaluate('window.sessionProbe=123;true');rpc({'type':'devtools.dock','position':'bottom'});assert evaluate('window.sessionProbe')==123
 rpc({'type':'devtools.dock','position':'right'});time.sleep(.3)
 # Drag the actual native splitter before picking.
 content=json.loads(evaluate('JSON.stringify(document.querySelector("#content-surface").getBoundingClientRect().toJSON())','shell'))
 before=geometry()['w'];boundary=content['right']-before-3
 pointer.move(boundary,content['y']+200);pointer.button(True);time.sleep(.1)
 samples=[]
 for step in range(1,9):
  pointer.move(boundary-step*10,content['y']+200);time.sleep(.03)
  actual=geometry()['w'];samples.append(actual)
  assert abs(actual-(before+step*10))<=4,('Viewport lags splitter',step,actual,before)
  if step==6:capture('during-divider-drag')
 results['liveResizeWidths']=samples
 pointer.button(False);time.sleep(.2)
 results['resized']=geometry()['w']>before+30;assert results['resized']
 saved_width=geometry()['w'];saved_fraction=saved_width/(content['width']-5)
 capture('resized-tools')
 rpc({'type':'devtools.dock','position':'bottom'});time.sleep(.15)
 bottom_y=content['bottom']-geometry()['h']-3
 pointer.move(content['x']+200,bottom_y);pointer.button(True);time.sleep(.1)
 for step in range(1,7):pointer.move(content['x']+200,bottom_y-step*10);time.sleep(.03)
 pointer.button(False);time.sleep(.15);saved_bottom=geometry()['h']
 rpc({'type':'devtools.dock','position':'right'});time.sleep(.15)
 rpc({'type':'devtools.dock','position':'bottom'});time.sleep(.15)
 assert abs(geometry()['h']-saved_bottom)<=2,'Bottom size lost'
 results['bottomRestoredHeight']=saved_bottom
 rpc({'type':'devtools.dock','position':'right'});time.sleep(.15)
 assert abs(geometry()['w']-saved_width)<=2,'Dock switch lost size'
 # Change the real browser allocation and verify that the pane keeps its share.
 sway_socket=next(runtime.glob('sway-ipc.*.sock'))
 swaymsg=compositor.with_name('swaymsg')
 subprocess.run([str(swaymsg),'-s',str(sway_socket),'output HEADLESS-1 resolution 1600x900'],env=env,check=True,stdout=subprocess.DEVNULL)
 time.sleep(.4)
 wider=json.loads(evaluate('JSON.stringify(document.querySelector("#content-surface").getBoundingClientRect().toJSON())','shell'))
 results['fractionAfterWindowResize']=geometry()['w']/(wider['width']-5)
 assert abs(results['fractionAfterWindowResize']-saved_fraction)<.01,(saved_fraction,results)
 subprocess.run([str(swaymsg),'-s',str(sway_socket),'output HEADLESS-1 resolution 1280x800'],env=env,check=True,stdout=subprocess.DEVNULL);time.sleep(.3)
 click_selector('[aria-label="Pick element"]');until('document.querySelector(\'[aria-label="Pick element"]\').getAttribute("aria-pressed")==="true"')
 content=json.loads(evaluate('JSON.stringify(document.querySelector("#content-surface").getBoundingClientRect().toJSON())','shell'))
 pointer.move(content['x']+100,content['y']+70);time.sleep(.3);pointer.button(True);pointer.button(False)
 until('document.querySelector(\'.dt-dom-row[aria-pressed=true]\')?.textContent.includes("probe")')
 until('document.querySelector(\'[aria-label="Pick element"]\').getAttribute("aria-pressed")==="false"')
 results['picked']=True
 until('document.querySelector(".dt-rule")?.textContent.includes("rgb(12, 34, 56)")')
 # Wheel over actual computed style panel; no scripted scroll assignment.
 bounds=json.loads(evaluate('JSON.stringify(document.querySelector(".dt-rule").getBoundingClientRect().toJSON())'))
 tools_x=content['right']-geometry()['w']
 pointer.move(tools_x+bounds['x']+bounds['width']/2,content['y']+bounds['y']+80)
 pointer.send(5,3,int(time.monotonic()*1000)&0xffffffff,0,600*256);pointer.send(5,4)
 results['scrollTop']=until('document.querySelector(".dt-rule").scrollTop>0&&document.querySelector(".dt-rule").scrollTop')
 capture('picked-and-scrolled')
 # Reload after capture starts, then preview the captured JPEG without refetching it.
 rpc({'type':'command','command':{'type':'tab.reload','tabId':tab}},'shell')
 until('document.querySelector(\'.dt-dom-row\')?.textContent.includes("document")')
 evaluate('Array.from(document.querySelectorAll("[role=tab]")).find(b=>b.textContent==="Network").click();true')
 until('document.querySelector(\'[aria-label="GET preview.jpg"]\')')
 click_selector('[aria-label="GET preview.jpg"]')
 until('document.querySelector(".dt-image-preview img")?.naturalWidth===420')
 results['imagePreview']=True
 results['resourceColors']=json.loads(evaluate('JSON.stringify(Array.from(new Set(Array.from(document.querySelectorAll(".dt-kind[data-resource-type]")).map(e=>getComputedStyle(e).color))))'))
 assert len(results['resourceColors'])>=3,results['resourceColors']
 capture('image-preview')
 click_selector('[aria-label="Close developer tools"]');time.sleep(.4)
 rpc({'type':'command','command':{'type':'tab.inspect','tabId':tab}},'shell');until('!!document.querySelector(".dt")')
 assert rpc({'type':'devtools.bootstrap'})['dock']=='right'
 results['reopened']=True
 assert abs(geometry()['w']-saved_width)<=2,'Reopen lost size'
 results['restoredFraction']=saved_fraction
 # Restart with the same profile after choosing a different saved position.
 snapshot=rpc({'type':'snapshot'},'shell');tab=snapshot['tabs'][0]['id']
 rpc({'type':'command','command':{'type':'tab.inspect','tabId':tab}},'shell');until('!!document.querySelector(".dt")')
 rpc({'type':'devtools.dock','position':'left'});click_selector('[aria-label="Close developer tools"]');time.sleep(.3)
 os.killpg(browser.pid,signal.SIGTERM);browser.wait(timeout=5)
 browser=subprocess.Popen([str(engine_build()/'bin/Ladybird'),'--profile-path',str(profile),f'--devtools={port}',f'http://127.0.0.1:{server.server_port}/'],env=env,stdout=(out/'browser-restarted.log').open('w'),stderr=subprocess.STDOUT,start_new_session=True)
 until('!!document.querySelector(".tab.active")','shell');snapshot=rpc({'type':'snapshot'},'shell');tab=snapshot['activeTabId']
 rpc({'type':'command','command':{'type':'tab.inspect','tabId':tab}},'shell');until('!!document.querySelector(".dt")')
 assert rpc({'type':'devtools.bootstrap'})['dock']=='left','Restart lost position'
 rpc({'type':'devtools.dock','position':'right'});time.sleep(.3)
 assert abs(geometry()['w']-saved_width)<=2,'Restart lost fractional size'
 results['restartRestoredPositionAndFraction']=True
 rpc({'type':'command','command':{'type':'tab.close','tabId':tab}},'shell');time.sleep(.4)
 assert browser.poll() is None,'Closing an inspected tab crashed the browser'
 results['closedTab']=True
 (out/'results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results),flush=True)
finally:
 if pointer:pointer.close()
 if server:server.shutdown();server.server_close()
 for process in [browser,comp]:
  if process and process.poll() is None:
   os.killpg(process.pid,signal.SIGTERM)
   try:process.wait(timeout=5)
   except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
