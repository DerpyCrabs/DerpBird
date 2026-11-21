#!/usr/bin/env python3
"""Close an actual DerpBird window while another site's unsaved draft is open."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
from threading import Thread
import time

from desktop_perf_harness import Desktop, wait_for


class Page(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/ordinary-became-visible':
            self.server.activations.append(self.path)
        body = b"""<!doctype html><title>Draft</title><body style="background:rgb(93,137,171)">
          <textarea aria-label="Draft"></textarea><script>
          window.desktopPerf = true;
          if (location.pathname === '/ordinary') {
            onbeforeunload = () => {};
            document.onvisibilitychange = () => {
              if (!document.hidden) fetch('/ordinary-became-visible');
            };
          }
          </script>"""
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


def run(browser, output, server):
    origin = f'http://127.0.0.1:{server.server_port}'
    with Desktop(output, browser, origin) as desktop:
        def open_tab(url):
            desktop.command(type='tab.create', url=url, private=False)
            tab = wait_for(lambda: next((t for t in desktop.windows()[0]['tabs']
                                          if t['active'] and t['url'] == url), None))
            wait_for(lambda: desktop.connection.evaluate(tab['context'], 'document.readyState === "complete"'))
            return tab

        def close_window():
            subprocess.run(['swaymsg', '-s', str(next(desktop.runtime.glob('sway-ipc*'))), 'kill'],
                           env=desktop.env, stdout=subprocess.DEVNULL, check=True)

        def prompt():
            return desktop.shell('document.querySelector(".shell-dialog[open] h2")?.textContent')

        first = desktop.tab
        open_tab(origin + '/ordinary')
        draft = open_tab(f'http://localhost:{server.server_port}/guard')
        desktop.pointer.move(800, 550)
        desktop.pointer.button(True)
        desktop.pointer.button(False)
        wait_for(lambda: desktop.connection.evaluate(draft['context'], 'navigator.userActivation.hasBeenActive'))
        desktop.connection.evaluate(draft['context'], '(onbeforeunload = event => event.preventDefault(), true)')
        open_tab(origin + '/active')
        server.activations.clear()

        close_window()
        wait_for(lambda: prompt() == 'Close this window?')
        assert desktop.active_tab()['id'] == draft['id']
        desktop.connection.evaluate(first['context'], '(location.href = "/reloaded", true)')
        wait_for(lambda: any(tab['url'].endswith('/reloaded') for tab in desktop.windows()[0]['tabs']))
        # Wait for the compositor to present the shell before using the real pointer.
        time.sleep(.2)
        desktop.click('.shell-dialog [data-cancel]')
        wait_for(lambda: not prompt())
        assert desktop.active_tab()['id'] == draft['id']
        assert desktop.browser.poll() is None

        close_window()
        wait_for(lambda: prompt() == 'Close this window?')
        time.sleep(.2)
        desktop.click('.shell-dialog [type=submit]')
        assert desktop.browser.wait(timeout=5) == 0
        assert not server.activations, 'Closing the window activated an unrelated background tab'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    with ThreadingHTTPServer(('127.0.0.1', 0), Page) as server:
        server.activations = []
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            run(args.browser, args.output, server)
        finally:
            server.shutdown()
            thread.join()
