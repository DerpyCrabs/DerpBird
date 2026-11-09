#!/usr/bin/env python3
"""Exercise a real Secret Service on an isolated bus/keyring, never the login keyring."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

binary = str(Path(sys.argv[1]).resolve())
if len(sys.argv) == 2:
    with tempfile.TemporaryDirectory(prefix='derpbird-secrets-') as directory:
        env = os.environ.copy()
        for key in ('DBUS_SESSION_BUS_ADDRESS', 'GNOME_KEYRING_CONTROL', 'DISPLAY', 'WAYLAND_DISPLAY'):
            env.pop(key, None)
        for key, name in (('XDG_DATA_HOME', 'data'), ('XDG_CONFIG_HOME', 'config'), ('XDG_RUNTIME_DIR', 'runtime')):
            path = Path(directory) / name
            path.mkdir(mode=0o700)
            env[key] = str(path)
        result = subprocess.run(['dbus-run-session', '--', sys.executable, __file__, binary, '--inside'], env=env, timeout=45)
        if result.returncode:
            raise SystemExit(result.returncode)
        env['DBUS_SESSION_BUS_ADDRESS'] = 'unix:path=' + str(Path(directory) / 'absent-bus')
        subprocess.run([binary, '--unavailable'], env=env, check=True, timeout=10)
        raise SystemExit(0)

with tempfile.TemporaryFile() as log:
    daemon = subprocess.Popen(['gnome-keyring-daemon', '--foreground', '--unlock', '--components=secrets'], stdin=subprocess.PIPE, stdout=log, stderr=log)
    try:
        daemon.stdin.write(b'derpbird-isolated-test-password')
        daemon.stdin.close()
        deadline = time.monotonic() + 10
        while True:
            ready = subprocess.run(['gdbus', 'call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.NameHasOwner', 'org.freedesktop.secrets'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=2)
            if ready.returncode == 0 and b'true' in ready.stdout:
                break
            if daemon.poll() is not None or time.monotonic() >= deadline:
                raise RuntimeError('Isolated Secret Service did not become ready')
            time.sleep(0.05)
        subprocess.run([binary], check=True, timeout=20)
    finally:
        daemon.terminate()
        try:
            daemon.wait(timeout=5)
        except subprocess.TimeoutExpired:
            daemon.kill()
            daemon.wait()
