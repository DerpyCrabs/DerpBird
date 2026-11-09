#!/usr/bin/env python3
"""Run native Wayland credential UI checks with a persistent isolated test keyring.

All data lives in artifacts/credential-wayland-test-v2. The fixed unlock password is
only for that disposable test keyring; no login keyring or desktop bus is used.
Close the browser normally to stop the daemon and session bus.
"""
import os
from pathlib import Path
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[1]
fixture = root / 'artifacts/credential-wayland-test-v2'
if '--inside' not in sys.argv:
    env = os.environ.copy()
    display = env.get('WAYLAND_DISPLAY', 'wayland-0')
    endpoint = Path(env.get('XDG_RUNTIME_DIR', f'/run/user/{os.getuid()}')) / display
    if not endpoint.is_socket() or endpoint.stat().st_uid != os.getuid():
        raise SystemExit('Owned Wayland socket required')
    env['WAYLAND_DISPLAY'] = str(endpoint)
    for key in ('DBUS_SESSION_BUS_ADDRESS', 'GNOME_KEYRING_CONTROL', 'DISPLAY'):
        env.pop(key, None)
    for key, name in (('XDG_DATA_HOME', 'data'), ('XDG_CONFIG_HOME', 'config'), ('XDG_RUNTIME_DIR', 'runtime')):
        path = fixture / name
        path.mkdir(parents=True, mode=0o700, exist_ok=True)
        path.chmod(0o700)
        env[key] = str(path)
    raise SystemExit(subprocess.run(['dbus-run-session', '--', sys.executable, __file__, '--inside', *sys.argv[1:]], env=env).returncode)

with (fixture / 'keyring.log').open('w') as log:
    daemon = subprocess.Popen(['gnome-keyring-daemon', '--foreground', '--unlock', '--components=secrets'], stdin=subprocess.PIPE, stdout=log, stderr=log)
    try:
        # stdin is a password byte stream: a newline becomes part of the password.
        daemon.stdin.write(b'derpbird-isolated-test-password')
        daemon.stdin.close()
        deadline = time.monotonic() + 10
        while True:
            ready = subprocess.run(['gdbus', 'call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.NameHasOwner', 'org.freedesktop.secrets'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=2)
            if ready.returncode == 0 and b'true' in ready.stdout: break
            if daemon.poll() is not None or time.monotonic() >= deadline:
                raise RuntimeError('Isolated Secret Service failed to start')
            time.sleep(0.05)
        raise SystemExit(subprocess.run([sys.executable, str(root / 'scripts/run-wayland-test.py'), '--profile', str(fixture / 'profile'), *(sys.argv[2:] or ['https://example.com'])]).returncode)
    finally:
        daemon.terminate()
        try: daemon.wait(timeout=5)
        except subprocess.TimeoutExpired:
            daemon.kill()
            daemon.wait()
