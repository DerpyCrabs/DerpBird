#!/usr/bin/env python3
import argparse,json,subprocess,time,importlib.util
from pathlib import Path
parser=argparse.ArgumentParser(description='Check approved chrome through real native pointer and keyboard input. Start on a new tab in an isolated fresh profile.')
parser.add_argument('--environment',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
parser.add_argument('--port',default=18997,type=int)
parser.add_argument('--extent',type=int,nargs=2,default=[1280,900])
args=parser.parse_args()
root=Path(__file__).resolve().parents[1];out=args.output;out.mkdir(parents=True,exist_ok=True)
env=json.loads(args.environment.read_text())
assert 'artifacts' in env['XDG_RUNTIME_DIR'], 'Use an owned test compositor'
spec=importlib.util.spec_from_file_location('surface',root/'scripts/test-shell-surface-transitions.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
pointer=module.Pointer(env,args.extent);report=[]
def evaluate(code):
 script=out/'probe.js';script.write_text(code)
 r=subprocess.run(['python3',str(root/'scripts/ladybird-devtools-eval.py'),'--port',str(args.port),'--url','about:derpbird','--script',str(script)],capture_output=True,text=True,timeout=15)
 if r.returncode:raise RuntimeError(r.stderr[-1200:])
 x=json.loads(r.stdout)
 if x.get('hasException'):raise RuntimeError(str(x))
 return x['result']
def wait(code):
 for _ in range(50):
  if evaluate(code):return
  time.sleep(.1)
 raise AssertionError(code)
def click(q):
 b=json.loads(evaluate('JSON.stringify(document.querySelector('+json.dumps(q)+').getBoundingClientRect().toJSON())'))
 pointer.move(b['x']+b['width']/2,b['y']+b['height']/2);pointer.button(True);pointer.button(False);time.sleep(.2)
def key(*keys):
 import os
 subprocess.run(['wtype',*keys],env=dict(os.environ,**env),check=True,timeout=5);time.sleep(.15)
def check(name,code):
 wait(code);report.append(name);(out/'checks.json').write_text(json.dumps(report,indent=2));print(name,flush=True)
import os
keyboard=subprocess.Popen(['wtype','-s','600000'],env=dict(os.environ,**env))
try:
 click('[aria-label="Open settings"]');check('Native settings renders approved appearance',"!!document.querySelector('.haz-themes')")
 click('.haz-themes button:nth-child(2)');check('Light theme persists through native command',"document.body.dataset.theme==='light'")
 click('.haz-themes button:first-child');check('Dark theme restored',"document.body.dataset.theme==='dark'")
 click('.haz-settings-nav button:nth-child(2)');click('#always-close');check('Native close-button preference applied',"document.body.classList.contains('haz-quiet-close')")
 click('#always-close');check('Close buttons restored',"document.body.classList.contains('haz-always-close')")
 click('#wrap-tabs');check('Native wrapping preference applied',"document.querySelector('.shell').classList.contains('wrap-tabs')")
 click('#wrap-tabs');click('.haz-settings-nav button:first-child');click('.layout-choice:has(input[value=compact])');check('Compact layout via real settings',"document.querySelector('.shell').classList.contains('compact-chrome')")
 for label,popup in [('Styles on this page','.page-sources-popup.styles'),('Scripts on this page','.page-sources-popup.scripts'),('Proxy switcher','.proxy-popup'),('Menu','.browser-menu')]:
  click('.navigation [aria-label="'+label+'"]');check(label+' opens',"!!document.querySelector('"+popup+":not(.shell-overlay-exit)')")
  check(label+' keeps window inset',"(()=>{const r=document.querySelector('"+popup+"').getBoundingClientRect();return r.left>=8&&r.top>=8&&r.right<=innerWidth-8&&r.bottom<=innerHeight-8})()")
 key('-k','Escape');click('#compact-location');check('Compact palette centered',"(()=>{const r=document.querySelector('.address-palette').getBoundingClientRect();return Math.abs(r.x+r.width/2-innerWidth/2)<1&&r.right<=innerWidth&&r.y>=0})()")
 key('-k','Escape');check('Escape closes palette',"!document.querySelector('.address-palette:not(.shell-overlay-exit)')")
 (out/'checks.json').write_text(json.dumps(report,indent=2))
finally:
 keyboard.terminate();keyboard.wait(timeout=5);pointer.close()
