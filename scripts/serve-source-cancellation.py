#!/usr/bin/env python3
"""Loopback source fixture; records whether cancelling a browser load closes HTTP."""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=18961)
parser.add_argument('--events', type=Path, required=True)
args = parser.parse_args()
args.events.parent.mkdir(parents=True, exist_ok=True)
lock = threading.Lock()

def record(path, event):
    with lock, args.events.open('a') as log:
        log.write(json.dumps(dict(path=path, event=event, time=time.time())) + '\n')

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path.endswith('.js'):
            body = '// ==UserScript==\n// @name Cancellation script\n// @version 1\n// @match http://127.0.0.1/*\n// ==/UserScript==\nvoid 0;\n'
        elif path.endswith('.less'):
            body = '@accent: #abcdef;\n'
        else:
            body = '/* ==UserStyle==\n@name Cancellation style\n@namespace derpbird-test\n@version 1.0.0\n'
            body += ('@preprocessor less\n' if path == '/imports.user.css' else '')
            body += '==/UserStyle== */\n'
            body += '@import "./slow.less";\nbody { color: @accent; }' if path == '/imports.user.css' else 'body { color: #abcdef; }'
        slow = path.startswith('/slow')
        data = body.encode()
        padding = 400 if slow else 0
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(data) + padding))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        record(path, 'started')
        try:
            for _ in range(padding):
                self.wfile.write(b' ')
                self.wfile.flush()
                time.sleep(.05)
            self.wfile.write(data)
            self.wfile.flush()
            record(path, 'completed')
        except (BrokenPipeError, ConnectionResetError):
            record(path, 'disconnected')

ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
