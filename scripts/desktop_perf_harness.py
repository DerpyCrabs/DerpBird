"""Full DerpBird process tree in an owned Wayland desktop, with real OS input.

Automation is used only for setup and correctness. Timed interactions use the
Wayland seat; displayed results come from compositor screenshots, never RAF.
"""
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import time
from PIL import Image
from build_config import ROOT
from test_compositor import sway_executable


def wait_for(predicate, timeout=20):
    end = time.monotonic() + timeout
    while True:
        value = predicate()
        if value:
            return value
        if time.monotonic() >= end:
            raise TimeoutError('Condition did not become true')
        time.sleep(.05)


def stop_process(process):
    if process and process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()


def remote_value(value):
    kind = value.get('type')
    if kind in ('undefined', 'null'):
        return None
    if kind == 'object':
        return {k: remote_value(v) for k, v in value.get('value', [])}
    if kind == 'array':
        return [remote_value(v) for v in value.get('value', [])]
    return value.get('value')


class NativeConnection:
    """The same owner-only BiDi socket as the native MCP adapter, without its overlay."""
    def __init__(self, path):
        self.socket = socket.socket(socket.AF_UNIX)
        self.socket.settimeout(30)
        self.socket.connect(str(path))
        self.stream = self.socket.makefile('rb')
        self.sequence = 0

    def request(self, method, **params):
        self.sequence += 1
        self.socket.sendall((json.dumps(dict(id=self.sequence, method=method, params=params)) + '\n').encode())
        while True:
            line = self.stream.readline(16 * 1024 * 1024)
            if not line:
                raise RuntimeError('Native browser connection closed')
            packet = json.loads(line)
            if packet.get('id') != self.sequence:
                continue
            if packet['type'] != 'success':
                raise RuntimeError(packet)
            return packet['result']

    def evaluate(self, context, code):
        result = self.request('script.callFunction', target={'context': context},
                              functionDeclaration='() => (' + code + ')', awaitPromise=True)
        if result['type'] != 'success':
            raise RuntimeError(result)
        return remote_value(result['result'])

    def close(self):
        self.stream.close()
        self.socket.close()


class Desktop:
    width, height = 1280, 800

    def __init__(self, output, binary, url):
        self.output, self.binary, self.url = Path(output), Path(binary).resolve(), url
        self.browser = self.compositor = self.pointer = self.connection = self.keyboard = None
        self.temporary = None
        self.logs = []

    def __enter__(self):
        try:
            self.start()
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def start(self):
        self.output.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix='dp-', dir=ROOT / 'artifacts')
        self.runtime = Path(self.temporary.name) / 'r'
        self.runtime.mkdir(mode=0o700)
        config = self.output / 'sway.conf'
        config.write_text(f'output HEADLESS-1 resolution {self.width}x{self.height}\n'
                          'output * bg #222222 solid_color\ndefault_border none\n'
                          'default_floating_border none\nseat seat0 hide_cursor 100\n')
        compositor = sway_executable()
        self.env = dict(os.environ, XDG_RUNTIME_DIR=str(self.runtime), WLR_BACKENDS='headless',
                        WLR_RENDERER='pixman', WLR_LIBINPUT_NO_DEVICES='1')
        for key in ('WAYLAND_DISPLAY', 'DISPLAY', 'SWAYSOCK', 'LD_LIBRARY_PATH',
                    'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy',
                    'DERPBIRD_PROFILE', 'DERPBIRD_AGENT', 'DERPBIRD_AGENT_WINDOW', 'DERPBIRD_AUTOMATION_SOCKET'):
            self.env.pop(key, None)
        self.env.update(NO_PROXY='127.0.0.1,localhost', no_proxy='127.0.0.1,localhost')
        self.compositor = self.launch([compositor, '-c', config], 'compositor.log',
                                     dict(self.env, LD_LIBRARY_PATH=str(compositor.parent.parent / 'lib')))
        def display_ready():
            if self.compositor.poll() is not None:
                raise RuntimeError('Test compositor exited; inspect compositor.log')
            return next((p.name for p in self.runtime.glob('wayland-*') if p.is_socket()), None)
        self.env.update(WAYLAND_DISPLAY=wait_for(display_ready), QT_QPA_PLATFORM='wayland', DERPBIRD_UI='1')
        self.keyboard = self.launch(['wtype', '-s', '3600000'], 'keyboard.log', self.env)
        profile = Path(self.temporary.name) / 'profile'
        (profile / 'config').mkdir(parents=True)
        (profile / 'data').mkdir()
        (profile / 'data/ImportWelcomeSeen').write_text('1')
        (profile / 'config/Settings.json').write_text(json.dumps({
            'firstRunComplete': True, 'restorePreviousSession': False,
            'derpbirdSessionRestoreInitialized': True,
            'backgroundNetworking': {'enabled': False}, 'searchEngine': {'suggestions': False},
            'contentBlockers': {'enabled': True, 'customFilters': '|'+self.url+'/blocked/*$xhr\n'},
        }))
        self.started = time.monotonic()
        self.browser = self.launch([self.binary, '--profile-path', profile, self.url + '/page?scene=static&color=1'], 'browser.log', self.env)
        def socket_ready():
            if self.browser.poll() is not None:
                raise RuntimeError('Browser exited; inspect browser.log')
            return next(self.runtime.glob('derpbird-automation-*.sock'), None)
        self.connection = NativeConnection(wait_for(socket_ready, 30))
        self.tab = wait_for(lambda: next((t for w in self.windows() for t in w['tabs'] if t.get('context') and t['url'].startswith(self.url)), None), 30)
        wait_for(lambda: self.evaluate('document.readyState === "complete" && !!window.desktopPerf'), 30)
        spec = importlib.util.spec_from_file_location('desktop_pointer', ROOT / 'scripts/test-shell-surface-transitions.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.pointer = module.Pointer(self.env, [self.width, self.height])
        self.shell_context = wait_for(lambda: next((t['context'] for t in self.connection.request('browsingContext.getTree')['contexts'] if t['url'] == 'about:derpbird'), None))
        # Real seat input also establishes focus. The shell is never driven by DOM events.
        self.pointer.move(900, 600)
        self.pointer.button(True)
        self.pointer.button(False)
        self.wait_color(1)
        self.startup_ms = (time.monotonic() - self.started) * 1000

    def launch(self, command, name, env):
        log = (self.output / name).open('wb')
        self.logs.append(log)
        return subprocess.Popen(list(map(str, command)), env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)

    def windows(self):
        return self.connection.request('derpbird.windows')['windows']

    def active_tab(self):
        return next(t for w in self.windows() for t in w['tabs'] if t['active'])

    def evaluate(self, code):
        return self.connection.evaluate(self.tab['context'], code)

    def shell(self, code):
        return self.connection.evaluate(self.shell_context, code)

    def shell_rect(self, selector):
        return self.shell('document.querySelector('+json.dumps(selector)+').getBoundingClientRect().toJSON()')

    def command(self, **command):
        window = self.windows()[0]
        return self.connection.request('derpbird.request', windowId=window['windowId'],
                                       payload={'type':'command','command':command})

    def click(self, selector):
        rect = self.shell_rect(selector)
        self.pointer.move(rect['x']+rect['width']/2, rect['y']+rect['height']/2)
        self.pointer.button(True)
        self.pointer.button(False)

    def keys(self, *args):
        subprocess.run(['wtype', *args], env=self.env, check=True, timeout=10, stdout=subprocess.DEVNULL)

    def shortcut(self, key, modifier='ctrl'):
        self.keys('-M', modifier, '-k', key, '-m', modifier)

    def type_url(self, url):
        self.shortcut('l')
        self.keys(url)

    def navigate(self, scene='static', color=1, **params):
        from urllib.parse import urlencode
        self.type_url(self.url + '/page?' + urlencode(dict(scene=scene, color=color, **params)))
        self.keys('-k', 'Return')
        wait_for(lambda: self.active_tab()['url'].startswith(self.url + '/page?'), 30)
        self.tab = self.active_tab()
        wait_for(lambda: self.evaluate(f'!!window.desktopPerf && desktopPerf.scene === {json.dumps(scene)} && desktopPerf.color === {color}'), 30)
        if scene == 'static':
            self.wait_color(color)
        time.sleep(.2)

    def pixels(self, box='800,500 64x64'):
        capture = subprocess.run(['grim', '-t', 'ppm', '-g', box, '-'], env=self.env,
                                 check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
        return Image.open(io.BytesIO(capture.stdout)).convert('RGB')

    def screenshot(self, name):
        subprocess.run(['grim', str(self.output / (name + '.png'))], env=self.env, check=True, timeout=5)

    def wait_color(self, color, timeout=10):
        expected = palette(color)
        return wait_for(lambda: max(abs(a-b) for a,b in zip(self.pixels().getpixel((32,32)), expected)) < 8, timeout)

    def __exit__(self, *_):
        if self.connection:
            self.connection.close()
        if self.pointer:
            self.pointer.close()
        stop_process(self.browser)
        stop_process(self.keyboard)
        stop_process(self.compositor)
        for log in self.logs:
            log.close()
        if self.temporary:
            self.temporary.cleanup()


def palette(index):
    return [(index * factor) % 160 + 40 for factor in (53, 97, 131)]
