#!/usr/bin/env python3
"""Loopback recovery fixture with uncached pages and an append-only request log."""
import argparse
import html
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import time
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port',type=int,default=18944)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args();args.output.parent.mkdir(parents=True,exist_ok=True)
lock=threading.Lock()
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        with lock:
            with args.output.open('a') as out:out.write(json.dumps({'time':time.time(),'path':self.path})+'\n')
        label=html.escape(self.path)
        body=f'''<!doctype html><meta charset="utf-8"><title>Recovery {label}</title><style>body{{font:24px system-ui;background:#181b25;color:white;padding:40px}}a{{color:#a5b4fc}}</style><h1>Recovery {label}</h1><a href="{label.rstrip('/')}/next">Next history entry</a><p>This page is deliberately not cached.</p>'''.encode()
        self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
print(f'Session fixture listening on {server.server_port}',flush=True)
try:server.serve_forever()
except KeyboardInterrupt:pass
finally:server.server_close()
