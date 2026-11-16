#!/usr/bin/env python3
"""Run production layout, Settings, URL focus and drag checks on an owned compositor."""
import json, os, signal, subprocess, tempfile, time, sys
from pathlib import Path
from build_config import engine_build
root = Path(__file__).resolve().parents[1]
out = Path(tempfile.mkdtemp(prefix='browser-layouts-', dir=root / 'artifacts'))
runtime = out / 'runtime'; runtime.mkdir(mode=0o700)
config = out / 'sway.conf'
config.write_text('output HEADLESS-1 resolution 1280x800\noutput * bg #222222 solid_color\ndefault_border none\ndefault_floating_border none\n')
compositor = Path(os.environ.get('DERPBIRD_TEST_SWAY', '/tmp/derpbird-test-compositor/usr/bin/sway'))
assert compositor.is_file(), 'Set DERPBIRD_TEST_SWAY to the isolated-test sway executable'
env = dict(os.environ, XDG_RUNTIME_DIR=str(runtime), WLR_BACKENDS='headless', WLR_RENDERER='pixman', WLR_LIBINPUT_NO_DEVICES='1', LD_LIBRARY_PATH=str(compositor.parent.parent / 'lib'))
env.pop('WAYLAND_DISPLAY', None); env.pop('DISPLAY', None)
with (out / 'compositor.log').open('w') as log:
    process = subprocess.Popen([str(compositor), '-c', str(config)], env=env, stdout=log, stderr=log, start_new_session=True)
keyboard=None
try:
    deadline=time.monotonic()+15
    while not any(p.is_socket() for p in runtime.glob('wayland-*')):
        assert process.poll() is None and time.monotonic()<deadline, 'Compositor startup failed'
        time.sleep(.1)
    env_file=out/'environment.json'
    env_file.write_text(json.dumps({'XDG_RUNTIME_DIR':str(runtime),'WAYLAND_DISPLAY':next(p.name for p in runtime.glob('wayland-*') if p.is_socket()),'QT_QPA_PLATFORM':'wayland'}))
    # Keep the seat's keyboard capability alive between short wtype commands.
    keyboard=subprocess.Popen(['wtype','-s','240000'],env=dict(os.environ,**json.loads(env_file.read_text())))
    print(out,flush=True)
    subprocess.run(['python3',str(root/'scripts/test-split-view.py'),'--environment',str(env_file),'--output',str(out/'checks'),('--workspaces' if '--workspaces' in sys.argv else '--layouts'),'--browser',str(engine_build()/'bin/Ladybird')],cwd=root,check=True,timeout=240)
finally:
    if keyboard is not None:
        keyboard.terminate();keyboard.wait(timeout=5)
    os.killpg(process.pid,signal.SIGTERM)
    try:process.wait(timeout=5)
    except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
