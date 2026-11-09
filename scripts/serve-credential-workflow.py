#!/usr/bin/env python3
"""Local synthetic form-submission fixture. Never writes submitted secrets to logs."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=18959)
args = parser.parse_args()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        submitted = self.path == '/submitted'
        body = ('''<!doctype html><meta charset="utf-8"><title>Credential submission</title>
<style>body{background:#181b25;color:white;font:20px system-ui;padding:32px}label{display:block;margin:18px 0}input,button{font:inherit;padding:10px}input{display:block}a{color:#a5b4fc}</style>
<h1>Credential submission</h1>''' + ('<p id="result">Form submitted successfully</p><a href="/">Back to login</a>' if submitted else '''
<form method="post" action="/submit"><label>Username<input name="username" autocomplete="username"></label>
<label>Password<input type="password" name="password" autocomplete="current-password"></label>
<button type="submit">Sign in</button></form>''')).encode()
        self.send_response(200)
        self.send_header('Content-Type','text/html;charset=utf-8')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get('Content-Length', '0'))
        if self.path != '/submit' or not 0 < length <= 4096:
            self.send_error(400); return
        fields = parse_qs(self.rfile.read(length).decode())
        if not fields.get('username') or not fields.get('password'):
            self.send_error(400); return
        self.send_response(303)
        self.send_header('Location','/submitted')
        self.send_header('Content-Length','0')
        self.end_headers()

ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
