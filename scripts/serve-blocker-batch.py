#!/usr/bin/env python3
"""Native filter acceptance with full pinned lists and a loopback-only DNS fixture."""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import shutil
import socketserver
import struct
import threading
import time

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--root',type=Path,required=True)
p.add_argument('--corpus',type=Path,required=True)
p.add_argument('--port',type=int,default=18963)
p.add_argument('--dns-port',type=int,default=15363)
a=p.parse_args()
a.root.mkdir(parents=True,exist_ok=False)
profile=a.root/'profile'; (profile/'config').mkdir(parents=True)
cache=profile/'data/ContentBlocking/Lists';cache.mkdir(parents=True)
manifest={v['file']:v for v in json.loads((a.corpus/'manifest.json').read_text())}
cases=[]; subscriptions=[]
for filename in ('easylist.txt','easyprivacy.txt'):
 data=(a.corpus/filename).read_bytes()
 assert hashlib.sha256(data).hexdigest()==manifest[filename]['sha256']
 identity='corpus-'+filename[:-4]
 shutil.copyfile(a.corpus/filename,cache/(identity+'.txt'))
 subscriptions.append(dict(identifier=identity,enabled=True,url='https://fixture.invalid/'+filename))
 hosts=[m[1] for line in data.decode().splitlines() if (m:=re.fullmatch(r'\|\|([a-z0-9.-]+)\^',line))]
 for i in range(16):cases.append(dict(host=hosts[i*len(hosts)//16],list=filename))
filters='''/batch/json-remove$xhr,replace=json:..ads
/batch/json-set$xhr,replace=json:.payload={"a":1,"b":2}
/batch/json-lines$xhr,replace=jsonl:.ads
/batch/text$xhr,replace=/advert/clean/g
/batch/except$xhr,replace=/advert/clean/g
@@/batch/except$replace
/batch/important$xhr,replace=/advert/clean/g,important
@@/batch/important$replace
/batch/cookie$xhr,requestheader=cookie:batch_probe=1
/batch/header$xhr,header=x-batch:blocked
/batch/domain|$xhr,domain=page.fixture.invalid,top=page.fixture.invalid,to=page.fixture.invalid
/batch/domain-control$xhr,domain=unused.invalid
/batch/rewrite$removeparam=drop
'''
(profile/'config/Settings.json').write_text(json.dumps(dict(firstRunComplete=True,restorePreviousSession=False,
 backgroundNetworking={'enabled':False},dnsSettings={'mode':'custom','server':'127.0.0.1','port':a.dns_port,'type':'udp','dnssec':False},
 contentBlockers={'enabled':True,'builtInLists':{'easyList':False,'easyPrivacy':False},'customSubscriptions':subscriptions,'customFilters':filters})))
(a.root/'corpus-cases.json').write_text(json.dumps(cases,indent=2))
lock=threading.Lock()
def event(value):
 with lock,(a.root/'events.jsonl').open('a') as out:out.write(json.dumps({'time':time.time(),**value})+'\n')
class DNS(socketserver.BaseRequestHandler):
 def handle(self):
  packet,sock=self.request
  if len(packet)<17:return
  offset=12
  while offset<len(packet) and packet[offset]:
   size=packet[offset];offset+=size+1
   if size>63:return
  offset+=1
  if offset+4>len(packet):return
  kind,cls=struct.unpack('!HH',packet[offset:offset+4]);answer=b''
  event({'dns':packet[12:offset].hex(),'type':kind})
  if cls==1 and kind==1:answer=b'\xc0\x0c'+struct.pack('!HHIH',1,1,60,4)+b'\x7f\0\0\1'
  sock.sendto(packet[:2]+struct.pack('!HHHHH',0x8180,1,int(bool(answer)),0,0)+packet[12:offset+4]+answer,self.client_address)
PAGE=r'''<!doctype html><meta charset=utf-8><title>Blocker acceptance batch</title>
<style>body{background:#171923;color:#eef;font:16px system-ui;margin:24px}pre{line-height:1.4}</style>
<h1>Full lists and response policy</h1><input placeholder="Input responsiveness"><pre id=result>Running…</pre><script>
(async()=>{
 const rows=[];const record=async(name,ok,detail='')=>{const row={name,ok:!!ok,detail};rows.push(row);result.textContent=rows.map(r=>(r.ok?'PASS ':'FAIL ')+r.name+(r.detail?' '+r.detail:'')).join('\n');await fetch('/report',{method:'POST',body:JSON.stringify(row)})};
 const text=async path=>(await fetch(path)).text();
 const blocked=async path=>{try{await fetch(path);return false}catch(e){await fetch('/request-error',{method:'POST',body:JSON.stringify({path,error:String(e)})});return true}};
 await record('JSON recursive removal',await text('/batch/json-remove')==='{"nested":{"keep":3}}');
 const assigned=await text('/batch/json-set');await record('JSON assignment',assigned==='{"payload":{"a":1,"b":2}}',assigned);
 await record('JSONL removal',await text('/batch/json-lines')==='{"keep":2}\r\n\n{}\n');
 const replaced=await text('/batch/text');await record('Text replacement',replaced==='clean clean',replaced);
 await record('Replacement exception',await text('/batch/except')==='advert advert');
 await record('Important replacement overrides exception',await text('/batch/important')==='clean clean');
 await record('Malformed JSON preserved',await text('/batch/json-remove?invalid')==='not JSON');
 document.cookie='batch_probe=1; path=/';
 await record('Post-cookie authoritative request policy',await blocked('/batch/cookie'));
 document.cookie='batch_probe=; Max-Age=0; path=/';
 await record('Removed cookie negative control',!(await blocked('/batch/cookie')));
 await record('Response header policy',await blocked('/batch/header'));
 await record('Combined domain/top/destination',await blocked('/batch/domain'));
 await record('Unmatched domain control',!(await blocked('/batch/domain-control')));
 await record('Query rewriting',await text('/batch/rewrite?drop=secret&keep=yes')==='/batch/rewrite?keep=yes');
 for(const item of CASES){await record('Full '+item.list+' '+item.host,await blocked('http://'+item.host+':PORT/resource.js'))}
 for(let i=0;i<4;i++)await record('DNS/CORS negative control '+i,!(await blocked('http://control-'+i+'.fixture.invalid:PORT/resource.js')));
 await fetch('/done',{method:'POST',body:JSON.stringify({total:rows.length,failed:rows.filter(r=>!r.ok)})});
})().catch(async e=>{result.textContent+='\nERROR '+e;await fetch('/fatal',{method:'POST',body:String(e)})});
</script>'''
class HTTP(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  body=self.rfile.read(int(self.headers.get('Content-Length','0'))).decode()
  event({'report':self.path,'body':body});self.send_response(204);self.end_headers()
 def do_GET(self):
  event({'http':self.path,'host':self.headers.get('Host'),'cookie':self.headers.get('Cookie')})
  path=self.path.split('?',1)[0];mime='text/plain'
  if path=='/':body=PAGE.replace('CASES',json.dumps(cases)).replace('PORT',str(a.port));mime='text/html'
  elif path=='/batch/json-remove':body='not JSON' if '?' in self.path else '{"ads":[1],"nested":{"ads":2,"keep":3}}';mime='application/json'
  elif path=='/batch/json-set':body='{"payload":0}';mime='application/json'
  elif path=='/batch/json-lines':body='{"ads":1,"keep":2}\r\n\n{"ads":3}\n';mime='application/x-ndjson'
  elif path in ('/batch/text','/batch/except','/batch/important'):body='advert advert'
  elif path=='/batch/rewrite':body=self.path
  else:body='ok'
  data=body.encode();self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store');self.send_header('Access-Control-Allow-Origin','*')
  if path=='/batch/header':self.send_header('X-Batch','blocked')
  self.end_headers()
  try:self.wfile.write(data)
  except (BrokenPipeError,ConnectionResetError):pass
server=socketserver.ThreadingUDPServer(('127.0.0.1',a.dns_port),DNS)
threading.Thread(target=server.serve_forever,daemon=True).start()
try:ThreadingHTTPServer(('127.0.0.1',a.port),HTTP).serve_forever()
finally:server.shutdown();server.server_close()
