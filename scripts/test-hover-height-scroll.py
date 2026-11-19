#!/usr/bin/env python3
"""Check presented frames during a sidebar height transition on a private Wayland display."""
import argparse
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

from PIL import Image
from build_config import ROOT, engine_build
from desktop_perf_harness import stop_process, wait_for
from test_compositor import sway_executable


def capture(env, region=None):
    command = ['grim', '-t', 'ppm']
    if region:
        command.extend(['-g', region])
    data = subprocess.check_output([*command, '-'], env=env, timeout=5)
    return Image.open(io.BytesIO(data)).convert('RGB')


def find_sidebar(env):
    image = capture(env)
    y = image.height // 2
    for x in range(image.width):
        if image.getpixel((x, y)) == (222, 18, 67):
            # Sample away from the animated indicator on the edge of the rail.
            top = next(row for row in range(y + 1)
                       if image.getpixel((x + 20, row)) == (222, 18, 67))
            return x, top
    return None


def run(binary, instant, seconds):
    with tempfile.TemporaryDirectory(prefix='hover-height-') as temporary:
        root = Path(temporary)
        env = os.environ.copy()
        for key in ('DISPLAY', 'WAYLAND_DISPLAY', 'SWAYSOCK', 'DERPBIRD_PROFILE',
                    'DERPBIRD_UI', 'DERPBIRD_AGENT', 'DERPBIRD_AGENT_WINDOW', 'DERPBIRD_AUTOMATION_SOCKET'):
            env.pop(key, None)
        env.update(XDG_RUNTIME_DIR=temporary, XDG_CONFIG_HOME=str(root / 'config'),
                   XDG_DATA_HOME=str(root / 'data'), XDG_CACHE_HOME=str(root / 'cache'),
                   QT_QPA_PLATFORM='wayland', WLR_BACKENDS='headless', WLR_RENDERER='pixman',
                   WLR_LIBINPUT_NO_DEVICES='1', DBUS_SESSION_BUS_ADDRESS='unix:path=' + temporary + '/bus')
        config = root / 'sway.conf'
        config.write_text('output HEADLESS-1 resolution 1280x800@120Hz\ndefault_border none\n')
        profile = root / 'profile'
        (profile / 'config').mkdir(parents=True)
        (profile / 'data').mkdir()
        (profile / 'data/ImportWelcomeSeen').write_text('1')
        (profile / 'config/Settings.json').write_text(json.dumps({'firstRunComplete': True}))
        url = (ROOT / 'tests/rendering/hover-height-scroll.html').as_uri()
        if instant:
            url += '?instant'
        browser = None
        compositor = subprocess.Popen([sway_executable(), '-c', config], env=env, start_new_session=True,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            env['WAYLAND_DISPLAY'] = wait_for(lambda: next((p.name for p in root.glob('wayland-*') if p.is_socket()), None))
            browser = subprocess.Popen([binary, '--profile-path', profile, url], env=env, start_new_session=True,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            left, top = wait_for(lambda: find_sidebar(env))
            # One capture contains the moving indicator and a point well inside the stationary white card.
            region = f'{left},{top} 250x240'
            wait_for(lambda: capture(env, region).getpixel((240, 230)) == (255, 255, 255))
            heights = set()
            total = missing = 0
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                image = capture(env, region)
                heights.add(sum(image.getpixel((4, y)) == (255, 255, 255) for y in range(24)))
                missing += image.getpixel((240, 230)) != (255, 255, 255)
                total += 1
            minimum_heights = 2 if instant else 3
            if total < 30 or len(heights) < minimum_heights:
                raise RuntimeError(f'Insufficient animation samples: {total} frames, heights {sorted(heights)}')
            return missing, total
        finally:
            stop_process(browser)
            stop_process(compositor)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', type=Path, default=engine_build() / 'bin/Ladybird')
    parser.add_argument('--seconds', type=float, default=5)
    args = parser.parse_args()
    for instant in (True, False):
        missing, total = run(args.browser.resolve(), instant, args.seconds)
        name = 'instant' if instant else 'transition'
        print(f'{name}: card disappeared in {missing}/{total} sampled frames', flush=True)
        if missing:
            raise SystemExit(1)
