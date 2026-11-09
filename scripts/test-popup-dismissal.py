#!/usr/bin/env python3
"""Check popup dismissal with real page clicks in an isolated Wayland session."""
import argparse, importlib.util, json, os, signal, socket, subprocess, tempfile, time, sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--environment', required=True, type=Path)
p.add_argument('--output', type=Path)
a = p.parse_args()
env = json.loads(a.environment.read_text())
assert 'wayland' in env.get('XDG_RUNTIME_DIR', '') and env.get('WAYLAND_DISPLAY'), 'Use an isolated test compositor'
spec = importlib.util.spec_from_file_location('transitions', root/'scripts/test-shell-surface-transitions.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix='derpbird-dismissal-') as tmp:
    out = Path(tmp); profile = out/'profile'
    (profile/'config').mkdir(parents=True); (profile/'data').mkdir()
    (profile/'config/Settings.json').write_text(json.dumps({'firstRunComplete': True, 'restorePreviousSession': False, 'backgroundNetworking': {'enabled': False}}))
    (profile/'data/ImportWelcomeSeen').write_text('1')
    with socket.socket() as sock: sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    log = (out/'browser.log').open('w')
    keyboard_device = subprocess.Popen(['wtype', '-s', '600000'], env=env, stdout=log, stderr=subprocess.STDOUT)
    time.sleep(.2)
    proc = subprocess.Popen([str(root/'vendor/ladybird/Build/release/bin/Ladybird'), '--profile-path', str(profile), f'--devtools={port}', 'about:blank'], env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    pointer = module.Pointer(env, [1200, 800])
    def evaluate(code, url='about:derpbird'):
        script = out/'eval.js'; script.write_text(code)
        result = subprocess.run(['python3', str(root/'scripts/ladybird-devtools-eval.py'), '--port', str(port), '--url', url, '--script', str(script)], capture_output=True, text=True, timeout=15)
        if result.returncode: raise RuntimeError(result.stderr[-800:])
        return json.loads(result.stdout)['result']
    def wait(code, url='about:derpbird'):
        deadline = time.monotonic()+10
        while time.monotonic()<deadline:
            try:
                if evaluate(code, url): return
            except RuntimeError: pass
            time.sleep(.1)
        raise AssertionError('Timed out: '+code)
    def click(selector):
        rect = json.loads(evaluate('JSON.stringify(document.querySelector('+json.dumps(selector)+').getBoundingClientRect().toJSON())'))
        pointer.move(rect['x']+rect['width']/2, rect['y']+rect['height']/2)
        time.sleep(.1); pointer.button(True); pointer.button(False); time.sleep(.15)
    def key(*args):
        subprocess.run(['wtype', '-d', '50', *args, '-s', '100'], env=env, check=True, timeout=5)
        time.sleep(.1)
    def no_shell_focus():
        wait('!document.hasFocus() && !document.querySelector("button:focus,input:focus,textarea:focus,select:focus")')
        wait('document.hasFocus() && document.activeElement.id==="target"', 'about:blank')
    def capture(name):
        if a.output:
            a.output.mkdir(parents=True, exist_ok=True)
            subprocess.run(['grim', str(a.output/(name+'.png'))], env=env, check=True, timeout=5)
    try:
        wait('!!document.querySelector("button[aria-label=Menu]")')
        evaluate('window.testKeys=[];document.addEventListener("keydown",e=>window.testKeys.push(e.key));window.pageClicks=0;document.addEventListener("pointerdown",()=>++window.pageClicks);document.body.innerHTML="<input id=target style=position:fixed;inset:0;width:100%;height:100%>";true', 'about:blank')
        for label, popup in [('Styles on this page', '.page-sources-popup'), ('Scripts on this page', '.page-sources-popup'), ('Proxy switcher', '.proxy-popup'), ('Menu', '.browser-menu')]:
            button = 'button[aria-label='+json.dumps(label)+']'
            for _ in range(2):
                click(button); wait('!!document.querySelector('+json.dumps(popup)+')')
                if popup=='.page-sources-popup':
                    wait('!!document.querySelector(".page-sources-popup footer button:not(:disabled)")')
                    click(popup+' header')
                    assert evaluate('!!document.querySelector('+json.dumps(popup)+')'), 'Inside click dismissed popup'
                assert evaluate('document.documentElement.dataset.inputMethod==="pointer"')
                assert evaluate('Array.from(document.querySelectorAll(":focus-visible")).every(e=>getComputedStyle(e).outlineStyle==="none" && getComputedStyle(e).boxShadow==="none")'), 'Mouse focus ring'
                capture(label.split()[0]+'-pointer-open')
                before = evaluate('window.pageClicks', 'about:blank')
                click('#content-surface')
                wait('!document.querySelector('+json.dumps(popup)+')')
                wait('window.pageClicks>'+str(before), 'about:blank')
                no_shell_focus()
                key('x')
                wait('document.getElementById("target").value.endsWith("x")', 'about:blank')
            click(button); wait('!!document.querySelector('+json.dumps(popup)+')')
            time.sleep(.2); key('-k', 'Escape')
            wait('document.activeElement===document.querySelector('+json.dumps(button)+')')
            assert evaluate('getComputedStyle(document.activeElement).outlineStyle!=="none"'), 'Keyboard focus ring missing'
            key('-k', 'Return'); wait('!!document.querySelector('+json.dumps(popup)+')')
            wait('document.querySelector('+json.dumps(popup)+').contains(document.activeElement)')
            key('-k', 'Tab')
            if popup in ['.proxy-popup', '.browser-menu']:
                wait('!document.querySelector('+json.dumps(popup)+')')
            else:
                wait('document.querySelector('+json.dumps(popup)+')?.contains(document.activeElement)')
                assert evaluate('getComputedStyle(document.activeElement).outlineStyle!=="none"'), 'Tab focus ring missing'
                key('-k', 'Escape'); wait('!document.querySelector('+json.dumps(popup)+')')
            click('#content-surface'); no_shell_focus()
            capture(label.split()[0]+'-dismissed')
            print(label+': mouse dismissal, page input, keyboard open/Escape and focus rings passed', flush=True)
        toolbar_popups = [('Styles on this page', '.page-sources-popup.styles'), ('Scripts on this page', '.page-sources-popup.scripts'), ('Proxy switcher', '.proxy-popup'), ('Menu', '.browser-menu')]
        for source_label, source_popup in toolbar_popups:
            for target_label, target_popup in toolbar_popups:
                source_button = 'button[aria-label='+json.dumps(source_label)+']'
                target_button = 'button[aria-label='+json.dumps(target_label)+']'
                click(source_button); wait('!!document.querySelector('+json.dumps(source_popup)+')')
                click(target_button)
                if source_label == target_label:
                    wait('!document.querySelector('+json.dumps(source_popup)+')')
                else:
                    wait('!!document.querySelector('+json.dumps(target_popup)+') && !document.querySelector('+json.dumps(source_popup)+')')
                click('#content-surface'); no_shell_focus()
        print('All 16 toolbar transitions: same button closes, another button switches', flush=True)
        click('#location')
        assert evaluate('getComputedStyle(document.querySelector("#location")).borderTopColor==="rgb(49, 52, 56)"'), 'Pointer address highlight'
        key('example'); click('#content-surface'); no_shell_focus()
        key('-M', 'ctrl', 'l', '-m', 'ctrl')
        wait('document.activeElement.id==="location" && document.documentElement.dataset.inputMethod==="keyboard"')
        assert evaluate('getComputedStyle(document.querySelector("#location")).borderTopColor==="rgb(156, 186, 173)"'), 'Keyboard address highlight missing'
        capture('address-keyboard')
        click('#content-surface'); no_shell_focus(); capture('address-dismissed')
        print('Address: mouse focus, Ctrl+L, page focus transfer passed', flush=True)
    finally:
        if sys.exc_info()[0]:
            log.flush()
            print((out/'browser.log').read_text()[-4000:], file=sys.stderr)
            for url in ['about:derpbird','about:blank']:
                try: print(url, evaluate('JSON.stringify({focus:document.hasFocus(),element:document.activeElement.tagName,id:document.activeElement.id,value:document.querySelector("#target")?.value,keys:window.testKeys})', url), file=sys.stderr)
                except Exception: pass
        pointer.close()
        if proc.poll() is None:
            os.killpg(proc.pid, signal.SIGTERM)
            try: proc.wait(timeout=5)
            except subprocess.TimeoutExpired: os.killpg(proc.pid, signal.SIGKILL); proc.wait()
        keyboard_device.terminate(); keyboard_device.wait(timeout=5)
        log.close()
