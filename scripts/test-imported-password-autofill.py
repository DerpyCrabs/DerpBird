#!/usr/bin/env python3
"""CSV → isolated keyring → real form focus → choose login → fill, on Spark Wayland."""
import argparse, importlib.util, json, os, signal, subprocess, sys, time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('browser', 'environment', 'settings', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--inside', action='store_true')
    a = parser.parse_args(); a.output.mkdir(parents=True, exist_ok=True)
    if not a.inside:
        env = dict(os.environ)
        for key in ('DBUS_SESSION_BUS_ADDRESS', 'GNOME_KEYRING_CONTROL', 'DISPLAY'): env.pop(key, None)
        for key, name in [('XDG_DATA_HOME','keyring-data'),('XDG_CONFIG_HOME','keyring-config'),('XDG_RUNTIME_DIR','keyring-runtime')]:
            path = a.output.resolve()/name; path.mkdir(mode=0o700, exist_ok=True); env[key]=str(path)
        raise SystemExit(subprocess.run(['dbus-run-session','--',sys.executable,__file__,*sys.argv[1:],'--inside'],env=env).returncode)
    daemon = subprocess.Popen(['gnome-keyring-daemon','--foreground','--unlock','--components=secrets'],stdin=subprocess.PIPE,stdout=(a.output/'keyring.log').open('w'),stderr=subprocess.STDOUT)
    daemon.stdin.write(b'derpbird-isolated-autofill-fixture'); daemon.stdin.close()
    def stop_daemon():
        daemon.terminate()
        try: daemon.wait(timeout=5)
        except subprocess.TimeoutExpired: daemon.kill(); daemon.wait()
    import atexit; atexit.register(stop_daemon)
    deadline=time.monotonic()+10
    while time.monotonic()<deadline:
        ready=subprocess.run(['gdbus','call','--session','--dest','org.freedesktop.DBus','--object-path','/org/freedesktop/DBus','--method','org.freedesktop.DBus.NameHasOwner','org.freedesktop.secrets'],capture_output=True)
        if b'true' in ready.stdout:break
        time.sleep(.05)
    else:raise AssertionError('Test keyring unavailable')
    class Fixture(BaseHTTPRequestHandler):
        def log_message(self,*_):pass
        def do_GET(self):
            body=b'<!doctype html><title>Autofill fixture</title><style>body{background:#222;color:#ddd;font:18px sans-serif;padding:24px}label{display:block;margin:12px}input{display:block;font:18px sans-serif}#outside{position:fixed;right:24px;bottom:24px}</style><form><label>Username<input id="username" autocomplete="username"></label><label>Password<input id="password" type="password" autocomplete="current-password"></label><button type="button" id="outside">Outside</button></form>'
            self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(body)
    server=ThreadingHTTPServer(('127.0.0.1',0),Fixture);Thread(target=server.serve_forever,daemon=True).start()
    url='http://127.0.0.1:'+str(server.server_port)+'/'
    profile=a.output.resolve()/'profile';assert not profile.exists()
    (profile/'config').mkdir(parents=True);(profile/'config/Settings.json').write_bytes(a.settings.read_bytes())
    config=a.output.resolve()/'source-config';config.mkdir()
    documents=a.output.resolve()/'Documents';documents.mkdir()
    (documents/'fixture-passwords.csv').write_text('name,url,username,password\nFixture,'+url+',alice,synthetic-password-only\nSecond,'+url+',bob,second-synthetic-password\n')
    (config/'user-dirs.dirs').write_text('XDG_DOCUMENTS_DIR="'+str(documents)+'"\n')
    env=dict(os.environ,**json.loads(a.environment.read_text()))
    env.update(DBUS_SESSION_BUS_ADDRESS=os.environ['DBUS_SESSION_BUS_ADDRESS'],XDG_CONFIG_HOME=str(config),XDG_DATA_HOME=os.environ['XDG_DATA_HOME'])
    assert 'artifacts' in env['XDG_RUNTIME_DIR']
    capture=dict(os.environ,XDG_RUNTIME_DIR=env['XDG_RUNTIME_DIR'],WAYLAND_DISPLAY=env['WAYLAND_DISPLAY'])
    spec=importlib.util.spec_from_file_location('pointer',Path(__file__).with_name('test-shell-surface-transitions.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    pointer=module.Pointer(capture,[1280,720])
    def launch():
        log = (a.output / 'browser.log').open('a')
        process = subprocess.Popen([str(a.browser), '--profile-path', str(profile), '--devtools=18993', url], env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        log.close(); return process
    def stop(process):
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired: os.killpg(process.pid, signal.SIGKILL); process.wait()
    def evaluate(code, target='about:derpbird'):
        script = a.output / 'evaluate.js'; script.write_text(code)
        result = subprocess.run(['python3', str(Path(__file__).with_name('ladybird-devtools-eval.py')), '--port', '18993', '--url', target, '--script', str(script)], capture_output=True, text=True, check=True, timeout=15)
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
    def physical_click(x,y):
        pointer.move(x,y)
        for state in (1,0):pointer.send(5,2,int(time.monotonic()*1000)&0xffffffff,272,state);pointer.send(5,4)
        time.sleep(.2)
    browser=launch()
    try:
        until('!!document.querySelector(".import-manager")')
        click(button('Choose password CSV…'));time.sleep(.7);screenshot('01-csv-picker')
        # Native Qt chooser in this fixed 1280×720 Wayland test output.
        physical_click(500,142);physical_click(1060,603)
        until('document.querySelector(".import-result")?.textContent.includes("2 passwords imported")')
        screenshot('02-password-imported');click(button('Done'));until('!document.querySelector(".import-manager")')
        def field_click(id):
            content=json.loads(evaluate('JSON.stringify(document.getElementById("content-surface").getBoundingClientRect().toJSON())'))
            g=json.loads(evaluate('JSON.stringify({r:document.getElementById('+json.dumps(id)+').getBoundingClientRect().toJSON(),dpr:devicePixelRatio})',url))
            rect=g['r'];physical_click((content['left']+rect['left']+rect['width']/2)*g['dpr'],(content['top']+rect['top']+rect['height']/2)*g['dpr'])
        field_click('username')
        until('!!document.querySelector(".credential-autofill")')
        def assert_anchor(id):
            content=json.loads(evaluate('JSON.stringify(document.getElementById("content-surface").getBoundingClientRect().toJSON())'))
            field=json.loads(evaluate('JSON.stringify(document.getElementById('+json.dumps(id)+').getBoundingClientRect().toJSON())',url))
            popup=json.loads(evaluate('JSON.stringify(document.querySelector(".credential-autofill").getBoundingClientRect().toJSON())'))
            assert abs(popup['top']-(content['top']+field['bottom']+4))<2, 'Login menu must anchor below the field, including password fields'
            assert abs(popup['left']-(content['left']+field['left']))<2
        assert_anchor('username')
        screenshot('03-login-offer')
        assert evaluate('document.getElementById("password").value === ""',url)
        click('Array.from(document.querySelectorAll(".credential-autofill button[data-credential-id]")).find(e=>e.textContent==="alice")')
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            if evaluate('document.getElementById("username").value === "alice" && document.getElementById("password").value === "synthetic-password-only"',url):break
            time.sleep(.1)
        else:raise AssertionError('Selected imported login did not fill the form')
        screenshot('04-filled')
        assert not evaluate('!!document.querySelector(".credential-autofill")')
        field_click('outside');field_click('password')
        until('!!document.querySelector(".credential-autofill")');assert_anchor('password');screenshot('05-password-focus')
        field_click('outside');until('!document.querySelector(".credential-autofill")')
        evaluate('document.getElementById("password").autocomplete="new-password"; true',url)
        field_click('password');time.sleep(.5)
        assert not evaluate('!!document.querySelector(".credential-autofill")')
        screenshot('06-no-registration-autofill')
        field_click('outside')
        evaluate('document.getElementById("password").remove();document.getElementById("username").value=""; true',url)
        field_click('username');until('!!document.querySelector(".credential-autofill")')
        click('Array.from(document.querySelectorAll(".credential-autofill button[data-credential-id]")).find(e=>e.textContent==="bob")')
        time.sleep(.5)
        assert evaluate('document.getElementById("username").value === "bob"',url)
        screenshot('07-username-first-step')
        field_click('username');until('!!document.querySelector(".credential-autofill")')
        click('document.querySelector(".credential-autofill header button")')
        until('!document.querySelector(".credential-autofill")')
        field_click('username');until('!!document.querySelector(".credential-autofill")')
        screenshot('08-reopen-same-field')
        other=url.replace('127.0.0.1','localhost')
        evaluate('location.href='+json.dumps(other)+'; true',url)
        until('!document.querySelector(".credential-autofill")')
        time.sleep(.5)
        evaluate('document.getElementById("username").focus(); true',other)
        time.sleep(.5)
        assert not evaluate('!!document.querySelector(".credential-autofill")')
        screenshot('09-other-origin')


        (a.output/'results.json').write_text(json.dumps({'csv_keyring_import':True,'focus_offer':True,'explicit_selection_fills':True,'multiple_accounts':True,'password_focus':True,'dismiss_on_outside':True,'no_registration_autofill':True,'username_only':True,'field_anchor':True,'reopen_same_field':True,'no_other_origin':True},indent=2))
        print('CSV → keyring → focus → selection → form fill passed')
    finally:
        if browser.poll() is None:screenshot('99-final-state')
        stop(browser);server.shutdown()

if __name__=='__main__':main()
