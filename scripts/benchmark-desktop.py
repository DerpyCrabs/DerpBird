#!/usr/bin/env python3
"""Run the native Qt URL-bar benchmark in an owned headless Wayland session."""
import argparse
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import tempfile
from build_config import ROOT, engine_build
from test_compositor import sway_executable
from performance_suite import FixtureServer


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--samples',type=int,default=5)
    parser.add_argument('--warmups',type=int,default=1)
    args=parser.parse_args();out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
    # Unix-domain socket paths have a small fixed limit. Report paths can be long.
    short=tempfile.TemporaryDirectory(prefix='pd-',dir=ROOT/'artifacts')
    runtime=Path(short.name)/'r';runtime.mkdir(mode=0o700)
    config=out/'sway.conf'
    config.write_text('output HEADLESS-1 resolution 1280x720\noutput * bg #222222 solid_color\ndefault_border none\ndefault_floating_border none\n')
    compositor=sway_executable()
    env=dict(os.environ,XDG_RUNTIME_DIR=str(runtime),WLR_BACKENDS='headless',WLR_RENDERER='pixman',WLR_LIBINPUT_NO_DEVICES='1',LD_LIBRARY_PATH=str(compositor.parent.parent/'lib'))
    env.pop('WAYLAND_DISPLAY',None);env.pop('DISPLAY',None)
    with (out/'compositor.log').open('w') as log:
        process=subprocess.Popen([str(compositor),'-c',str(config)],env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    keyboard=None
    try:
        deadline=time.monotonic()+15
        while not any(p.is_socket() for p in runtime.glob('wayland-*')):
            if process.poll() is not None or time.monotonic()>deadline:raise RuntimeError('Compositor startup failed; inspect compositor.log')
            time.sleep(.1)
        display=next(p.name for p in runtime.glob('wayland-*') if p.is_socket())
        overrides=dict(XDG_RUNTIME_DIR=str(runtime),WAYLAND_DISPLAY=display,QT_QPA_PLATFORM='wayland',DERPBIRD_UI='1')
        environment=out/'environment.json';environment.write_text(json.dumps(overrides))
        keyboard=subprocess.Popen(['wtype','-s','240000'],env=dict(os.environ,**overrides))
        settings=out/'settings.json';settings.write_text(json.dumps({'firstRunComplete':True,'searchEngine':{'suggestions':False},'contentBlockers':{'enabled':False},'backgroundNetworking':{'enabled':False}}))
        with socket.socket() as probe:probe.bind(('127.0.0.1',0));port=probe.getsockname()[1]
        with FixtureServer() as fixture:
            subprocess.run([sys.executable,str(ROOT/'scripts/benchmark-urlbar.py'),'--browser',str(engine_build()/'bin/Ladybird'),
                            '--environment',str(environment),'--settings',str(settings),'--output',str(out/'urlbar'),'--profile',str(Path(short.name)/'p'),
                            '--samples',str(args.samples),'--warmups',str(args.warmups),'--port',str(port),'--wayland-output','HEADLESS-1','--url',fixture.endpoint+'/page?count=200'],cwd=ROOT,check=True,timeout=180)
    finally:
        if keyboard is not None:
            keyboard.terminate();keyboard.wait(timeout=5)
        try:os.killpg(process.pid,signal.SIGTERM)
        except ProcessLookupError:pass
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
        short.cleanup()
    return 0

if __name__=='__main__':raise SystemExit(main())
