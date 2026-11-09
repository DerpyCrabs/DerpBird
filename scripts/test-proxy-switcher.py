#!/usr/bin/env python3
"""Verify proxy IPC, persistence and real HTTP/subresource/WebSocket routing in an isolated Qt profile."""
import argparse, base64, hashlib, json, os, signal, socket, subprocess, tempfile, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path)
args = parser.parse_args()
output = args.output or Path(tempfile.mkdtemp(prefix='proxy-network-', dir=root/'artifacts'))
output.mkdir(parents=True, exist_ok=True)
profile = output/'profile'
assert not profile.exists(), 'Use a fresh test output directory'
(profile/'config').mkdir(parents=True)
(profile/'data').mkdir()
(profile/'config/Settings.json').write_text(json.dumps({'firstRunComplete': True, 'restorePreviousSession': False, 'backgroundNetworking': {'enabled': False}, 'contentBlockers': {'enabled': False}}))
(profile/'data/ImportWelcomeSeen').write_text('1')
proxy_requests, origin_requests = [], []
class Origin(BaseHTTPRequestHandler):
    def do_GET(self):
        origin_requests.append(self.path)
        body=b'<!doctype html><title>DIRECT fixture</title><h1>Direct</h1>'
        self.send_response(200);self.send_header('Content-Type','text/html');self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)
    def log_message(self,*_): pass
class Proxy(BaseHTTPRequestHandler):
    def do_CONNECT(self):
        proxy_requests.append('CONNECT '+self.path)
        self.send_response(200);self.end_headers();self.close_connection=False
    def do_GET(self):
        proxy_requests.append(self.path)
        if self.headers.get('Upgrade','').lower()=='websocket':
            key=self.headers['Sec-WebSocket-Key']
            accept=base64.b64encode(hashlib.sha1((key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
            self.send_response(101);self.send_header('Upgrade','websocket');self.send_header('Connection','Upgrade');self.send_header('Sec-WebSocket-Accept',accept);self.end_headers();return
        if '/asset.js' in self.path:
            body=b'document.title="PROXIED fixture";new WebSocket("ws://socket.proxy-fixture.invalid/socket");';kind='application/javascript'
        else:
            body=b'<!doctype html><title>PROXIED fixture</title><h1>Proxy</h1><script src="http://asset.proxy-fixture.invalid/asset.js"></script>';kind='text/html'
        self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)
    def log_message(self,*_): pass
origin=ThreadingHTTPServer(('127.0.0.1',0),Origin);proxy=ThreadingHTTPServer(('127.0.0.1',0),Proxy)
for server in [origin,proxy]:Thread(target=server.serve_forever,daemon=True).start()
with socket.socket() as sock:sock.bind(('127.0.0.1',0));devtools=sock.getsockname()[1]
env=dict(os.environ, QT_QPA_PLATFORM='offscreen', DERPBIRD_UI='1')
for key in list(env):
    if key.lower() in ['http_proxy','https_proxy','all_proxy','no_proxy']:env.pop(key)
browser=None
log=(output/'browser.log').open('w')
def start():
    global browser
    browser=subprocess.Popen([str(root/'vendor/ladybird/Build/release/bin/Ladybird'),'--profile-path',str(profile.resolve()),f'--devtools={devtools}','about:blank'],env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
def stop():
    if browser and browser.poll() is None:
        os.killpg(browser.pid,signal.SIGTERM)
        try:browser.wait(timeout=5)
        except subprocess.TimeoutExpired:os.killpg(browser.pid,signal.SIGKILL);browser.wait()
def evaluate(code):
    path=output/'evaluate.js';path.write_text(code)
    result=subprocess.run(['python3',str(root/'scripts/ladybird-devtools-eval.py'),'--port',str(devtools),'--url','about:derpbird','--script',str(path)],capture_output=True,text=True,check=True,timeout=15)
    return json.loads(result.stdout)['result']
def until(code):
    end=time.monotonic()+15
    while time.monotonic()<end:
        assert browser.poll() is None, 'Browser exited'
        try:
            result=evaluate(code)
            if result:return result
        except subprocess.CalledProcessError:pass
        time.sleep(.05)
    raise AssertionError('Timed out: '+code)
def rpc(payload):
    evaluate('window.proxyTestResult=null;window.proxyTestId=(window.proxyTestId??1000000)+1;document.addEventListener("WebUIMessage",window.proxyTestListener??=(e)=>{if(e.detail.name==="derpbird.response"&&e.detail.data.requestId===window.proxyTestId)window.proxyTestResult=e.detail.data});window.ladybird.sendMessage("derpbird.request",{requestId:window.proxyTestId,payload:'+json.dumps(payload)+'});true')
    response=json.loads(until('window.proxyTestResult&&JSON.stringify(window.proxyTestResult)'))
    return response
def request(payload):
    response=rpc(payload);assert response['ok'],response;return response.get('value')
def navigate(url):
    tab=until('document.querySelector("[role=tab][aria-selected=true]")?.dataset.tabId')
    request({'type':'command','command':{'type':'tab.navigate','tabId':tab,'url':url}})
def title(text):until('document.querySelector(".tab.active .tab-title")?.textContent==='+json.dumps(text))
results={}
try:
    start();until('!!window.ladybird&&!!document.querySelector("[role=tab]")')
    snapshot=request({'type':'proxy.get'})
    options={'schemaVersion':2,'+proxy':{'name':'proxy','profileType':'FixedProfile','fallbackProxy':{'scheme':'http','host':'127.0.0.1','port':proxy.server_port}},'+auto':{'name':'auto','profileType':'SwitchProfile','defaultProfileName':'direct','rules':[{'condition':{'conditionType':'HostWildcardCondition','pattern':'*.proxy-fixture.invalid'},'profileName':'proxy'}]}}
    snapshot=request({'type':'proxy.replace','revision':snapshot['revision'],'options':options,'active':'auto'})
    navigate('http://page.proxy-fixture.invalid/page');title('PROXIED fixture')
    deadline=time.monotonic()+5
    while not any('/socket' in url for url in proxy_requests) and time.monotonic()<deadline:time.sleep(.05)
    assert any('/asset.js' in url for url in proxy_requests),proxy_requests
    assert any('/socket' in url for url in proxy_requests),proxy_requests
    results['http_subresources_websocket_remote_dns']=True
    navigate(f'http://127.0.0.1:{origin.server_port}/direct');title('DIRECT fixture');assert '/direct' in origin_requests
    results['automatic_direct_fallback']=True
    old=dict(snapshot)
    snapshot=request({'type':'proxy.replace',**snapshot,'active':'proxy'})
    navigate(f'http://127.0.0.1:{origin.server_port}/forced');title('PROXIED fixture');assert '/forced' not in origin_requests
    results['live_switch_existing_request_server']=True
    assert not rpc({'type':'proxy.replace',**old,'active':'direct'})['ok']
    results['stale_window_rejected']=True
    invalid=json.loads(json.dumps(snapshot));invalid['options']['+auto']['defaultProfileName']='auto'
    assert not rpc({'type':'proxy.replace',**invalid})['ok']
    assert request({'type':'proxy.get'})==snapshot
    results['invalid_import_is_atomic']=True
    snapshot=request({'type':'proxy.replace',**snapshot,'active':'direct'})
    navigate(f'http://127.0.0.1:{origin.server_port}/after-switch');title('DIRECT fixture');assert '/after-switch' in origin_requests
    results['direct_mode_after_proxy']=True
    snapshot=request({'type':'proxy.replace',**snapshot,'active':'auto'})
    stop();start();until('!!window.ladybird&&!!document.querySelector("[role=tab]")')
    assert request({'type':'proxy.get'})==snapshot
    navigate('http://page.proxy-fixture.invalid/restarted');title('PROXIED fixture')
    results['restart_persistence_before_first_request']=True
    assert (profile/'config/DerpBirdProxy.json').stat().st_mode & 0o777 == 0o600
    results['owner_only_settings']=True
    with socket.socket() as unavailable:
        unavailable.bind(('127.0.0.1',0))
        broken=json.loads(json.dumps(snapshot));broken['options']['+proxy']['fallbackProxy']['port']=unavailable.getsockname()[1]
        broken=request({'type':'proxy.replace',**broken,'active':'proxy'})
        navigate(f'http://127.0.0.1:{origin.server_port}/must-not-connect-directly')
        until('!document.querySelector(".tab.active .tab-loading")')
        assert '/must-not-connect-directly' not in origin_requests
        assert request({'type':'proxy.get'})['active']=='proxy'
    results['failed_proxy_does_not_fall_back_to_direct']=True
    (output/'results.json').write_text(json.dumps(results,indent=2)+'\n')
    print(json.dumps(results));print('Artifacts:',output)
finally:
    stop();log.close()
    for server in [origin,proxy]:server.shutdown();server.server_close()
