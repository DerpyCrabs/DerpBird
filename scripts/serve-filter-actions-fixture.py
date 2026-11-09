#!/usr/bin/env python3
"""Combined ECMAScript and CNAME action fixture for the Wayland browser."""
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
        r'/tracker\.example.*\/substitute/$redirect=noop.json',
        r'||tracker.example^$removeparam=drop',
        r'/(?<=\/)ad(?=vert)/', r'/\/(track)\1$/',
        r'/query$removeparam=/^(discard)=\1$/i',
        r'/header$header=x-marker:/^(track)\1$/',
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
        if self.path == '/':
            response = PAGE.replace('PORT', str(args.port)).encode()
            mime = 'text/html; charset=utf-8'
        else:
            response = json.dumps({'path': self.path, 'body': body.decode(errors='replace')}).encode()
            mime = 'application/json'
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(response)))
        if not self.path.startswith('/no-cors'):
            self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('X-Marker', 'tracktrack')
        self.end_headers()
        self.wfile.write(response)
PAGE = r'''<!doctype html><meta charset=utf-8><title>Filter actions</title>
<style>body{background:#171923;color:#eef;font:18px system-ui;margin:36px}pre{line-height:1.8;color:#bce8d0}input{font:inherit;padding:12px}</style>
<h1>Фильтрация: общий пакет</h1><pre id=result>Запуск…</pre><input placeholder="Проверка ввода" oninput="const t=performance.now();requestAnimationFrame(()=>latency.textContent=(performance.now()-t).toFixed(1)+' мс')"><span id=latency></span>
<script>
(async()=>{
 const lines=[];const record=(name,ok)=>{lines.push(name+': '+(ok?'PASS':'FAIL'));document.getElementById('result').textContent=lines.join('\n')};
 async function blocked(path){try{await fetch(path);return false}catch{return true}}
 record('Lookbehind + lookahead',await blocked('/advert'));
 record('Backreference',await blocked('/tracktrack'));
 record('Positive control',(await fetch('/advice')).ok);
 const query=await (await fetch('/query?discard=DISCARD&keep=yes')).json();
 record('Regex removeparam',query.path==='/query?keep=yes');
 record('Response header',await blocked('/header'));
 const base='http://visible.example:PORT';
 const substitute=await (await fetch(base+'/substitute')).text();
 record('CNAME local resource',substitute==='{}');
 const post=await fetch(base+'/rewrite?drop=secret&keep=yes',{method:'POST',body:'preserved'});
 const data=await post.json();
 record('CNAME query + POST',data.path==='/rewrite?keep=yes'&&data.body==='preserved');
 record('Original hostname',new URL(post.url).hostname==='visible.example');
 record('Final response still enforces CORS',await blocked(base+'/no-cors?drop=secret'));
 await fetch('/metrics',{method:'POST',body:JSON.stringify(lines)});
})().catch(e=>document.getElementById('result').textContent+='\nERROR '+e);
</script>'''
dns = socketserver.ThreadingUDPServer(('127.0.0.1', args.dns_port), DNS)
threading.Thread(target=dns.serve_forever, daemon=True).start()
print(f'http://page.example:{args.port}/', flush=True)
try: ThreadingHTTPServer(('127.0.0.1', args.port), HTTP).serve_forever()
finally: dns.shutdown(); dns.server_close()
