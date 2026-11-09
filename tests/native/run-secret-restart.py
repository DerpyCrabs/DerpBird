#!/usr/bin/env python3
"""Restart a real isolated Secret Service while the same native client stays alive."""
import os
from pathlib import Path
import selectors
import subprocess
import sys
import tempfile
import time

binary = str(Path(sys.argv[1]).resolve())
if len(sys.argv) == 2:
    with tempfile.TemporaryDirectory(prefix='derpbird-secret-restart-') as directory:
        env = os.environ.copy()
        for key in ('DBUS_SESSION_BUS_ADDRESS', 'GNOME_KEYRING_CONTROL', 'DISPLAY', 'WAYLAND_DISPLAY'):
            env.pop(key, None)
        for key, name in (('XDG_DATA_HOME', 'data'), ('XDG_CONFIG_HOME', 'config'), ('XDG_RUNTIME_DIR', 'runtime')):
            path = Path(directory) / name
            path.mkdir(mode=0o700)
            env[key] = str(path)
        raise SystemExit(subprocess.run(['dbus-run-session', '--', sys.executable, __file__, binary, '--inside'], env=env, timeout=45).returncode)


def start(log):
    daemon = subprocess.Popen(['gnome-keyring-daemon', '--foreground', '--unlock', '--components=secrets'], stdin=subprocess.PIPE, stdout=log, stderr=log)
    daemon.stdin.write(b'derpbird-restart-test-password')
    daemon.stdin.close()
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        result = subprocess.run(['gdbus', 'call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.NameHasOwner', 'org.freedesktop.secrets'], capture_output=True, timeout=2)
        if result.returncode == 0 and b'true' in result.stdout:
            return daemon
        if daemon.poll() is not None:
            raise RuntimeError('Secret Service exited before readiness')
        time.sleep(.05)
    daemon.kill(); daemon.wait()
    raise RuntimeError('Secret Service readiness timeout')


def stop(process):
    if process and process.poll() is None:
        process.terminate()
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired: process.kill(); process.wait()


with tempfile.TemporaryFile() as log:
    daemon = client = None
    try:
        daemon = start(log)
        client = subprocess.Popen([binary, '--restart'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        with selectors.DefaultSelector() as selector:
            selector.register(client.stdout, selectors.EVENT_READ)
            if not selector.select(15): raise RuntimeError('Client setup timeout')
        assert client.stdout.readline().strip() == 'READY'
        stop(daemon)
        daemon = start(log)
        output, _ = client.communicate('\n', timeout=15)
        print(output, end='')
        assert client.returncode == 0 and 'RECOVERED' in output
    finally:
        stop(client)
        stop(daemon)
