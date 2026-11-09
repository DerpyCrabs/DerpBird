#!/usr/bin/env python3
"""Loopback HTTP + authoritative DNS fixture for native CNAME policy qualification."""
import argparse
import base64
import hashlib
import json
import socketserver
import struct
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=18946)
parser.add_argument('--dns-port', type=int, default=18947)
parser.add_argument('--profile', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
args.profile.mkdir(parents=True, exist_ok=False)
(args.profile / 'config').mkdir()
(args.profile / 'data').mkdir()
args.output.parent.mkdir(parents=True, exist_ok=True)
(args.profile / 'config/Settings.json').write_text(json.dumps({
    'firstRunComplete': True, 'restorePreviousSession': False,
    'backgroundNetworking': {'enabled': False},
    'dnsSettings': {'mode': 'custom', 'server': '127.0.0.1', 'port': args.dns_port, 'type': 'udp', 'dnssec': False},
    'contentBlockers': {'enabled': True, 'customFilters': '\n'.join([
        '||tracker.example^', '@@/except$cname',
        '@@/ordinary', '/direct-ws$websocket',
    ])},
}))
lock = threading.Lock()
def log(value):
    with lock, args.output.open('a') as output:
        output.write(json.dumps({'time': time.time(), **value}) + '\n')
def name(value):
    return b''.join(bytes([len(label)]) + label.encode('ascii') for label in value.split('.')) + b'\0'
def rr(owner, kind, body):
    return name(owner) + struct.pack('!HHIH', kind, 1, 60, len(body)) + body
class DNS(socketserver.BaseRequestHandler):
    def handle(self):
        packet, sock = self.request
        if len(packet) < 17: return
        offset, labels = 12, []
        while offset < len(packet) and packet[offset]:
            size = packet[offset]; offset += 1
            if size > 63 or offset + size > len(packet): return
            labels.append(packet[offset:offset + size].decode('ascii')); offset += size
        offset += 1
        if offset + 4 > len(packet): return
        host = '.'.join(labels).lower()
        kind, cls = struct.unpack('!HH', packet[offset:offset+4])
        if cls != 1: return
        answers = []
        if host in ('page.example', 'visible.example', 'tracker.example'):
            if host == 'visible.example': answers.append(rr(host, 5, name('tracker.example')))
            if kind == 1: answers.append(rr('tracker.example' if host == 'visible.example' else host, 1, b'\x7f\0\0\1'))
        log({'dns': host, 'type': kind})
        response = packet[:2] + struct.pack('!HHHHH', 0x8180, 1, len(answers), 0, 0)
        sock.sendto(response + packet[12:offset+4] + b''.join(answers), self.client_address)

class HTTP(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_POST(self): self.do_GET()
    def do_GET(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        log({'http': self.path, 'host': self.headers.get('Host'), 'method': self.command, 'body': body.decode(errors='replace')})
        if self.headers.get('Upgrade', '').lower() == 'websocket':
            key = self.headers.get('Sec-WebSocket-Key', '')
            accept = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
            self.protocol_version = 'HTTP/1.1'
            self.send_response(101)
            self.send_header('Upgrade', 'websocket')
            self.send_header('Connection', 'Upgrade')
            self.send_header('Sec-WebSocket-Accept', accept)
            self.end_headers()
            self.wfile.flush()
            self.connection.settimeout(3)
            try: self.rfile.read(2)
            except TimeoutError: pass
            self.close_connection = True
            return
        if self.path == '/':
            response = '''<!doctype html><meta charset=utf-8><title>CNAME policy</title>
<style>body{background:#171923;color:#e9edf6;font:18px system-ui;margin:36px}pre{line-height:2;color:#bce8d0}input{font:inherit;padding:12px}</style>
<h1>CNAME: проверка до HTTP-запроса</h1><pre id=status>Запуск…</pre><input placeholder="Проверка отзывчивости" oninput="const start=performance.now();requestAnimationFrame(()=>document.getElementById('latency').textContent=(performance.now()-start).toFixed(1)+' мс')"><small id=latency></small><p id=frames>RAF…</p><p id=network></p><script>
let last=performance.now(),frames=[];
function frame(now){frames.push(now-last);last=now;if(frames.length>600)frames.shift();if(frames.length%60===0){const sorted=[...frames].sort((a,b)=>a-b);document.getElementById('frames').textContent='RAF p95: '+sorted[Math.floor(sorted.length*.95)].toFixed(1)+' мс; max: '+Math.max(...frames).toFixed(1)+' мс';}requestAnimationFrame(frame)}requestAnimationFrame(frame);
(async()=>{
 const lines=[]; const record=(name,ok)=>{lines.push(name+': '+(ok?'PASS':'FAIL'));status.textContent=lines.join('\\n')};
 const base='http://visible.example:PORT';
 async function probe(path,blocked,method='GET') {
  let failed=false;try{await fetch(base+path,{mode:'no-cors',method,cache:'no-store',body:method==='POST'?'must-not-reach-server':undefined})}catch{failed=true}
  record(path,failed===blocked);
 }
 await probe('/blocked',true);
 await probe('/except',false);
 await probe('/ordinary',false);
 await probe('/blocked-after-dns-cache',true);
 await probe('/blocked-post',true,'POST');
 async function websocket(path,blocked) {
  const opened=await new Promise(resolve=>{
   const socket=new WebSocket('ws://visible.example:PORT'+path);
   const timer=setTimeout(()=>{socket.close();resolve(false)},8000);
   socket.onopen=()=>{clearTimeout(timer);socket.close();resolve(true)};
   socket.onerror=()=>{clearTimeout(timer);resolve(false)};
  });
  record('WebSocket '+path,opened!==blocked);
 }
 await websocket('/blocked-ws',true);
 await websocket('/except-ws',false);
 await websocket('/direct-ws',true);
 const direct=await fetch('/direct');record('Unaliased loopback',direct.ok);
 const timings=[];let rejected=0;
 for(let i=0;i<8;i++){const start=performance.now();try{await fetch(base+'/timed-block-'+i,{mode:'no-cors',cache:'no-store'})}catch{rejected++}timings.push(performance.now()-start)}
 record('Repeated CNAME policy',rejected===8);
 timings.sort((a,b)=>a-b);
 document.getElementById('network').textContent='CNAME deny p95: '+timings[Math.floor(timings.length*.95)].toFixed(1)+' мс';
 setTimeout(()=>{const ordered=[...frames].sort((a,b)=>a-b);fetch('/metrics',{method:'POST',body:JSON.stringify({denied:rejected,denyMs:timings,rafP95:ordered[Math.floor(ordered.length*.95)],rafMax:Math.max(...frames)})})},3000);
})().catch(e=>document.getElementById('status').textContent+='\\nERROR '+e);
</script>'''.replace('PORT', str(args.port)).replace("status.textContent=", "document.getElementById('status').textContent=").encode()
            mime = 'text/html; charset=utf-8'
        else: response, mime = b'fixture', 'text/plain'
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(response)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(response)

dns = socketserver.ThreadingUDPServer(('127.0.0.1', args.dns_port), DNS)
threading.Thread(target=dns.serve_forever, daemon=True).start()
print(f'http://page.example:{args.port}/', flush=True)
try: ThreadingHTTPServer(('127.0.0.1', args.port), HTTP).serve_forever()
finally: dns.shutdown(); dns.server_close()
