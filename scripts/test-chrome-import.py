#!/usr/bin/env python3
"""Exercise Chrome import in an isolated native Wayland browser using synthetic data."""
import argparse, importlib.util, json, os, signal, sqlite3, struct, subprocess, time
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('browser', 'environment', 'settings', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    a = parser.parse_args()
    a.output.mkdir(parents=True, exist_ok=True)
    profile = a.output.resolve() / 'profile'
    assert not profile.exists()
    (profile / 'config').mkdir(parents=True)
    (profile / 'config/Settings.json').write_bytes(a.settings.read_bytes())
    config = a.output.resolve() / 'source-config'
    source = config / 'google-chrome/Default'
    source.mkdir(parents=True)
    (source / 'Preferences').write_text('{}')
    documents = a.output.resolve() / 'Documents'; documents.mkdir()
    (documents / 'fixture-passwords.csv').write_text('name,url,username,password\nFixture,https://fixture.invalid,user,synthetic-password-only\n')
    (config / 'user-dirs.dirs').write_text('XDG_DOCUMENTS_DIR="' + str(documents) + '"\n')
    (source.parent / 'Local State').write_text(json.dumps({'profile': {'info_cache': {'Default': {'name': 'Import fixture'}}}}))
    (source / 'Bookmarks').write_text(json.dumps({'roots': {'bookmark_bar': {'type': 'folder', 'name': 'Work', 'children': [
        {'type': 'url', 'name': 'Imported bookmark', 'url': 'https://bookmark.invalid/'},
        {'type': 'url', 'name': 'Duplicate', 'url': 'https://bookmark.invalid/'}]}}}))
    with sqlite3.connect(source / 'History') as db:
        db.execute('CREATE TABLE urls(url TEXT,title TEXT,last_visit_time INTEGER,hidden INTEGER)')
        db.execute('INSERT INTO urls VALUES(?,?,?,0)', ('https://history.invalid/', 'Imported history', 13300000000000000))
    sessions = source / 'Sessions'; sessions.mkdir()
    body = bytearray(b'SNSS' + struct.pack('<i', 3))
    def command(code, data): body.extend(struct.pack('<HB', len(data)+1, code) + data)
    command(0, struct.pack('<ii', 1, 10))
    url = b'https://tab.invalid/'
    navigation = struct.pack('<iii', 10, 0, len(url)) + url
    navigation += b'\0' * (-len(navigation) % 4)
    command(6, struct.pack('<i', len(navigation)) + navigation)
    command(255, b'')
    (sessions / 'Session_1').write_bytes(body)
    env = dict(os.environ, **json.loads(a.environment.read_text()), XDG_CONFIG_HOME=str(config))
    assert 'artifacts' in env['XDG_RUNTIME_DIR']
    capture = dict(os.environ, XDG_RUNTIME_DIR=env['XDG_RUNTIME_DIR'], WAYLAND_DISPLAY=env['WAYLAND_DISPLAY'])
    spec = importlib.util.spec_from_file_location('pointer', Path(__file__).with_name('test-shell-surface-transitions.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    pointer = module.Pointer(capture, [1280, 720])
    def launch():
        log = (a.output / 'browser.log').open('a')
        process = subprocess.Popen([str(a.browser), '--profile-path', str(profile), '--devtools=18993', 'about:blank'], env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        log.close(); return process
    def stop(process):
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired: os.killpg(process.pid, signal.SIGKILL); process.wait()
    def evaluate(code):
        script = a.output / 'evaluate.js'; script.write_text(code)
        result = subprocess.run(['python3', str(Path(__file__).with_name('ladybird-devtools-eval.py')), '--port', '18993', '--url', 'about:derpbird', '--script', str(script)], capture_output=True, text=True, check=True, timeout=15)
        value = json.loads(result.stdout).get('result')
        return {'true': True, 'false': False, 'undefined': None, 'null': None}.get(value, value) if isinstance(value, str) else value
    def until(code):
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            try:
                value = evaluate(code)
                if value: return value
            except subprocess.CalledProcessError: pass
            time.sleep(.15)
        raise AssertionError(code)
    def click(code):
        evaluate('(()=>{const e=' + code + '; e.scrollIntoView({block:"nearest"}); return true})()')
        time.sleep(.1)
        geometry = json.loads(evaluate('JSON.stringify((()=>{const e=' + code + ';return {r:e.getBoundingClientRect().toJSON(),dpr:devicePixelRatio}})())'))
        r = geometry['r']; dpr = geometry['dpr']
        pointer.move((r['left']+r['width']/2)*dpr, (r['top']+r['height']/2)*dpr)
        for state in (1, 0): pointer.send(5, 2, int(time.monotonic()*1000)&0xffffffff, 272, state); pointer.send(5, 4)
        time.sleep(.2)
    def button(text): return 'Array.from(document.querySelectorAll("button")).find(e=>e.textContent===' + json.dumps(text) + ')'
    def screenshot(name):
        subprocess.run(['grim', '-o', 'WAYLAND-1', str(a.output / (name + '.png'))], env=capture, check=True, timeout=10)
    browser = launch()
    try:
        until('document.querySelector(".import-manager h2")?.textContent === "Welcome to DerpBird"')
        until('document.querySelector("select option")?.textContent.includes("Import fixture")')
        screenshot('01-first-launch')
        click('document.querySelectorAll(".import-options input")[2]')
        click(button('Import selected data'))
        until('document.querySelector(".import-result")?.textContent.includes("1 history entries imported")')
        assert evaluate('document.querySelector(".import-result").textContent.includes("1 bookmarks imported")')
        assert evaluate('document.querySelector(".import-result").textContent.includes("1 tabs opened")')
        evaluate('document.querySelector(".import-result").scrollIntoView({block:"nearest"}); true')
        screenshot('02-imported')
        click('document.querySelectorAll(".import-options input")[2]')
        click(button('Import selected data'))
        until('document.querySelector(".import-result")?.textContent.includes("0 history entries imported")')
        assert evaluate('document.querySelector(".import-result").textContent.includes("0 bookmarks imported")')
        evaluate('document.querySelector(".import-result").scrollIntoView({block:"nearest"}); true')
        screenshot('03-repeat-deduplicated')
        click(button('Done'))
        until('!document.querySelector(".import-manager")')
        assert (profile / 'data/ImportWelcomeSeen').exists()
        stop(browser); browser = launch()
        until('!!document.querySelector(".tab-title")')
        time.sleep(.5)
        assert not evaluate('!!document.querySelector(".import-manager")')
        click('document.querySelector("[aria-label=Menu]")')
        click(button('Import browser data'))
        until('document.querySelector(".import-manager h2")?.textContent === "Import browser data"')
        screenshot('04-reopen-from-menu')
        evaluate('document.querySelector(".import-passwords").scrollIntoView({block:"nearest"}); true')
        screenshot('05-password-import')
        click(button('Choose password CSV…'))
        time.sleep(1)
        screenshot('06-native-csv-picker')
        (a.output / 'results.json').write_text(json.dumps({'first_launch': True, 'bookmarks': True, 'history': True, 'tabs': True, 'deduplication': True, 'welcome_not_repeated': True, 'menu_entry': True}, indent=2))
        print('Native Chrome import interaction passed; screenshots:', a.output)
    finally:
        if browser.poll() is None:
            screenshot('99-final-state')
        stop(browser)

if __name__ == '__main__': main()
