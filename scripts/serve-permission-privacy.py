#!/usr/bin/env python3
"""Native permission UI and session-bound Blob URL acceptance fixture."""
import argparse,json,threading,time
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,required=True);p.add_argument('--port',type=int,default=18971);p.add_argument('--reuse',action='store_true');a=p.parse_args();a.root.mkdir(parents=True,exist_ok=a.reuse)
(a.root/'profile/config').mkdir(parents=True,exist_ok=a.reuse)
if not a.reuse:(a.root/'profile/config/Settings.json').write_text(json.dumps({'firstRunComplete':True,'restorePreviousSession':False,'backgroundNetworking':{'enabled':False}}))
lock=threading.Lock();urls={}
def record(data):
 with lock,(a.root/'events.jsonl').open('a') as f:f.write(json.dumps({'time':time.time(),**data})+'\n')
page='''<!doctype html><meta charset=utf-8><title>Permissions and private storage</title><style>body{background:#171923;color:#eee;font:22px monospace;padding:25px}button{font:inherit;padding:12px;margin:5px}pre{white-space:pre-wrap;font-size:18px}</style><h1>Permissions / private storage</h1><button id=permission>Request notifications</button><button id=locationPermission>Request location</button><button id=microphonePermission>Request microphone</button><button id=refreshPermissions>Read permissions</button><button id=make>Publish Blob</button><button id=probe>Probe published Blobs</button><br><button id=writeStorage>Write storage</button><button id=readStorage>Read storage</button><pre id=state></pre><script>
const context=location.pathname.slice(1)||'regular';
async function report(name,value){state.textContent+=name+': '+JSON.stringify(value)+'\\n';await fetch('/report',{method:'POST',body:JSON.stringify({context,name,value})})}
report('capabilities',{indexedDB:typeof indexedDB,caches:typeof caches,serviceWorker:typeof navigator.serviceWorker,storage:typeof navigator.storage,broadcastChannel:typeof BroadcastChannel,notification:typeof Notification});
const read=async()=>{const result={};for(const name of ['notifications','geolocation','microphone']){try{const status=await navigator.permissions.query({name});result[name]=status.state;status.onchange=()=>report('permission-change',{name,state:status.state})}catch(e){result[name]=String(e)}}await report('permissions',result)};read();
permission.onclick=async()=>{try{await report('notification-request',await Notification.requestPermission());await read()}catch(e){await report('failure',String(e))}};
refreshPermissions.onclick=read;
locationPermission.onclick=()=>{navigator.geolocation.getCurrentPosition(async()=>{await report('geolocation-request',{ok:true});await read()},async e=>{await report('geolocation-request',{ok:false,code:e.code,message:e.message});await read()},{timeout:10000,maximumAge:0})};
microphonePermission.onclick=async()=>{try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});const tracks=stream.getTracks();await report('microphone-request',{ok:true,tracks:tracks.length});tracks.forEach(track=>track.stop())}catch(e){await report('microphone-request',{ok:false,name:e.name,message:e.message})}await read()};

make.onclick=async()=>{const url=URL.createObjectURL(new Blob(['blob-'+context],{type:'text/plain'}));await fetch('/publish',{method:'POST',body:JSON.stringify({context,url})});await report('published',url)};
async function idb(write){return new Promise((resolve,reject)=>{const open=indexedDB.open('derpbird-privacy-fixture',1);open.onupgradeneeded=()=>open.result.createObjectStore('values');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result;const tx=db.transaction('values',write?'readwrite':'readonly');const request=write?tx.objectStore('values').put(context,'marker'):tx.objectStore('values').get('marker');let value;request.onsuccess=()=>value=request.result;tx.oncomplete=()=>{db.close();resolve(write?context:value??null)};tx.onerror=()=>{db.close();reject(tx.error)}}})}
async function storage(write){const result={};for(const [name,op]of Object.entries({indexedDB:()=>idb(write),cache:async()=>{const cache=await caches.open('derpbird-privacy-fixture');if(write)await cache.put('/marker',new Response(context));const hit=await cache.match('/marker');return hit?await hit.text():null},estimate:()=>navigator.storage.estimate()})){try{result[name]=await Promise.race([op(),new Promise((_,reject)=>setTimeout(()=>reject(Error('probe timeout')),5000))])}catch(e){result[name]={error:String(e)}}}await report(write?'storage-write':'storage-read',result)}
writeStorage.onclick=()=>storage(true);readStorage.onclick=()=>storage(false);
probe.onclick=async()=>{const urls=await (await fetch('/urls')).json();const results={};for(const [key,url]of Object.entries(urls)){try{results[key]={ok:true,text:await (await fetch(url)).text()}}catch(e){results[key]={ok:false,error:String(e)}}}await report('blob-probe',results)};
</script>'''.encode()
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  size=int(self.headers.get('Content-Length','0'))
  if size>65536:self.send_error(413);return
  data=json.loads(self.rfile.read(size));record(data)
  if self.path=='/publish':
   with lock:urls[data['context']]=data['url']
  self.send_response(204);self.end_headers()
 def do_GET(self):
  with lock:body=json.dumps(urls).encode() if self.path=='/urls' else page
  self.send_response(200);self.send_header('Content-Type','application/json' if self.path=='/urls' else 'text/html; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)
print(f'http://127.0.0.1:{a.port}/regular',flush=True)
ThreadingHTTPServer(('127.0.0.1',a.port),Handler).serve_forever()
