#!/usr/bin/env python3
"""Run in the test desktop session; preserve logs and an isolated profile.

The loaded platform plugin is evidence of the backend, not a rendering test.
Keep this process alive while exercising the browser, then close its windows.
"""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
from browser_metrics import BrowserMetrics
from ui_resources import verify_built_ui

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--check-environment', action='store_true')
parser.add_argument('--metrics', action='store_true', help='Sample browser process-tree CPU and aggregate RSS once per second')
parser.add_argument('--profile', type=Path, help='Reuse a test profile for restart/persistence checks')
parser.add_argument('browser_args', nargs='*')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
env = os.environ.copy()
runtime = Path(env.get('XDG_RUNTIME_DIR', f'/run/user/{os.getuid()}'))
display = env.get('WAYLAND_DISPLAY', 'wayland-0')
endpoint = runtime / display
if not endpoint.is_socket() or endpoint.stat().st_uid != os.getuid():
    raise SystemExit(f'No Wayland socket owned by this user: {endpoint}')
with socket.socket(socket.AF_UNIX) as connection:
    connection.settimeout(5)
    connection.connect(str(endpoint))
print(f'Wayland socket accepts connections: {endpoint}', flush=True)
if args.check_environment:
    raise SystemExit(0)

binary = root / 'vendor/ladybird/Build/release/bin/Ladybird'
if not binary.is_file():
    raise SystemExit('Build Ladybird before running the Wayland test.')
verify_built_ui(root)

artifacts = root / 'artifacts'
artifacts.mkdir(exist_ok=True)
run = Path(tempfile.mkdtemp(prefix='wayland-', dir=artifacts))
profile = args.profile.expanduser().resolve() if args.profile else run / 'profile'
env.update(XDG_RUNTIME_DIR=str(runtime), WAYLAND_DISPLAY=display,
           QT_QPA_PLATFORM='wayland', XDG_SESSION_TYPE='wayland',
           QT_DEBUG_PLUGINS='1', DERPBIRD_PROFILE=str(profile))
env.pop('DISPLAY', None)
print(f'Test artifacts: {run}', flush=True)
with (run / 'browser.log').open('w') as log:
    process = subprocess.Popen(
        ['python3', str(root / 'scripts/run.py'), *args.browser_args],
        env=env, stdout=log, stderr=subprocess.STDOUT)
    metrics = BrowserMetrics(process.pid, run / 'metrics.json') if args.metrics else None
    try:
        deadline = time.monotonic() + 30
        backend = None
        while process.poll() is None and time.monotonic() < deadline:
            try:
                mappings = Path(f'/proc/{process.pid}/maps').read_text()
            except FileNotFoundError:
                break
            backend = next((line.split()[-1] for line in mappings.splitlines()
                            if '/platforms/libqwayland' in line), None)
            if backend:
                break
            time.sleep(0.1)
        if not backend:
            raise SystemExit(f'Wayland plugin not observed; inspect {run / "browser.log"}')
        evidence = dict(pid=process.pid, platform_plugin=backend,
                        socket=str(endpoint), profile=str(profile),
                        engine_revision=subprocess.check_output(
                            ['git', '-C', str(root / 'vendor/ladybird'), 'rev-parse', 'HEAD'], text=True).strip())
        (run / 'backend.json').write_text(json.dumps(evidence, indent=2) + '\n')
        print(f'Loaded Wayland platform plugin: {backend}', flush=True)
        raise SystemExit(process.wait())
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()

        if metrics:
            metrics.close()
            print(f'Process metrics: {run / "metrics.json"}', flush=True)
