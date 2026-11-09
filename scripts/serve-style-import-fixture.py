#!/usr/bin/env python3
"""Isolated native fixture for local and remote Less dependencies."""
import argparse,json,threading,time
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root',type=Path,required=True)
parser.add_argument('--port',type=int,default=18953)
parser.add_argument('--stylus',action='store_true',help='Exercise local Stylus imports instead of Less')
args=parser.parse_args()
root=args.root.resolve();root.mkdir(parents=True,exist_ok=False)
profile=root/'profile';(profile/'config').mkdir(parents=True);(profile/'data').mkdir()
styles=root/'styles';(styles/'nested').mkdir(parents=True)
(profile/'config/Settings.json').write_text(json.dumps({'firstRunComplete':True,'restorePreviousSession':False,'backgroundNetworking':{'enabled':False}}))
(profile/'data/DerpBirdStyleFolders.json').write_text(json.dumps([str(styles)]))
(styles/'palette.less').write_text('@accent: rgb(180, 20, 30);\n')
(styles/'nested/theme.user.less').write_text('''/* ==UserStyle==
@name Local and remote dependencies
@namespace derpbird.fixture
@version 1.0.0
@preprocessor less
==/UserStyle== */
@import "../palette.less";
@import "http://127.0.0.1:PORT/remote.less";
@-moz-document domain("127.0.0.1") { #probe { color: @accent !important; .remote(); } }
'''.replace('PORT',str(args.port)))
if args.stylus:
 (styles/'palette.less').unlink()
 (styles/'nested/theme.user.less').unlink()
 (styles/'palette.styl').write_text('accent = rgb(180, 20, 30)\n')
 (styles/'border.styl').write_text('border-width = 4px\nborder-color = rgb(22, 33, 44)\n')
 (styles/'nested/theme.user.styl').write_text('''/* ==UserStyle==
@name Local Stylus dependencies
@namespace derpbird.fixture
@version 1.0.0
@preprocessor stylus
==/UserStyle== */
@import "../palette"
@require "../border"
@-moz-document domain("127.0.0.1")
  #probe
    color accent !important
    border border-width solid border-color !important
''')
lock=threading.Lock()
def record(data):
 with lock:
  with (root/'events.jsonl').open('a') as f:f.write(json.dumps({'time':time.time(),**data})+'\n')
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  record({'request':self.path})
  if self.path=='/remote.less':body=b'.remote(){border:4px solid rgb(22,33,44) !important;}';mime='text/plain'
  else:
   body=b'''<!doctype html><meta charset=utf-8><title>Local Less dependencies</title><style>body{font:24px sans-serif;background:#eee;padding:32px}#probe{padding:20px;color:black}pre{font-size:18px}</style><h1>Local Less dependencies</h1><div id=probe>Local palette + remote border</div><pre id=status>Waiting for style</pre><script>let previous='';setInterval(()=>{const s=getComputedStyle(document.getElementById('probe'));const result={color:s.color,border:s.borderTopColor,width:s.borderTopWidth};const text=JSON.stringify(result);document.getElementById('status').textContent=text;if(text!==previous){previous=text;fetch('/report',{method:'POST',body:text})}},500)</script>''';mime='text/html'
  self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def do_POST(self):
  length=int(self.headers.get('Content-Length','0'))
  if self.path!='/report' or not 0<length<4096:self.send_error(400);return
  record({'computed':json.loads(self.rfile.read(length))});self.send_response(204);self.end_headers()
server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
print(f'Profile: {profile}\nFixture: http://127.0.0.1:{args.port}',flush=True)
try:server.serve_forever()
except KeyboardInterrupt:pass
finally:server.server_close()
