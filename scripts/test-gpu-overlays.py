#!/usr/bin/env python3
"""Verify floating widgets preserve GPU page presentation in an owned Wayland desktop.

Requires a DRM render node, GLES-capable sway, perf and passwordless sudo for
uprobes. Instruments only this test browser; always removes its named probes.
"""
import importlib.util
import json
import math
import os
from pathlib import Path
import subprocess
import threading
import time
from desktop_perf_harness import Desktop, NativeConnection
from build_config import ROOT, engine_build

spec = importlib.util.spec_from_file_location('browser_benchmark', ROOT/'scripts/benchmark-browser.py')
bench = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bench)

class GPUDesktop(Desktop):
    def launch(self, args, name, env):
        if name == 'compositor.log':
            args = [*args, '--unsupported-gpu']
            env = dict(env, WLR_RENDERER='gles2')
        return super().launch(args, name, env)


def main():
    out = ROOT/'artifacts'/('gpu-overlay-'+time.strftime('%Y%m%d-%H%M%S'))
    out.mkdir()
    binary = engine_build()/'bin/Ladybird'
    group = 'derpbird_overlay_'+str(os.getpid())
    symbols = {
        'readback': (engine_build()/'lib/liblagom-gfx.so', '_ZN3Gfx29read_linux_dmabuf_into_bitmapERKNS_13VulkanContextERKNS_17LinuxDmaBufHandleE'),
        'present': (binary, '_ZN8Ladybird18WaylandPageSurface7presentER7QWindowRKNS0_5FrameE'),
        'overlay': (binary, '_ZN8Ladybird18WaylandPageSurface12show_overlayER7QWindowRK6QImage6QPoint'),
    }
    installed = []
    results = {}
    try:
        for name, (file, symbol) in symbols.items():
            subprocess.run(['sudo','-n','perf','probe','-x',str(file),'--add',f'{group}:{name}={symbol}'],check=True,stdout=subprocess.DEVNULL)
            installed.append(name)
        with bench.Fixtures(out) as fixture, GPUDesktop(out/'desktop',binary,fixture.url) as desktop:
            desktop.connection.request('browsingContext.navigate',context=desktop.tab['context'],url=fixture.url+'/page?scene=video&color=1',wait='complete')
            bench.wait_for(lambda: desktop.evaluate('document.querySelector("video").readyState>=3'))
            window = desktop.windows()[0]['windowId']
            def activity(connection, kind, **extra):
                return connection.request('derpbird.request',windowId=window,payload={'type':'automation.activity','tabId':desktop.tab['id'],'kind':kind,**extra})
            for case in ('baseline','activity','find-bar'):
                stop = threading.Event()
                errors = []
                def animate():
                    connection = None
                    try:
                        connection = NativeConnection(next(desktop.runtime.glob("derpbird-automation-*.sock")))
                        while not stop.is_set():
                            x = 300+80*math.sin(time.monotonic()*3)
                            activity(connection,'drag',point={'x':x,'y':200},**{'from':{'x':x-20,'y':200}})
                            stop.wait(.1)
                    except Exception as error: errors.append(str(error))
                    finally:
                        if connection: connection.close()
                thread = threading.Thread(target=animate) if case == 'activity' else None
                log = out/(case+'-perf.csv')
                recorder = subprocess.Popen(['sudo','-n','perf','stat','-x',';','-o',str(log),'-e',','.join(f'{group}:{name}' for name in symbols),'-p',str(desktop.browser.pid),'--','sleep','5'])
                try:
                    time.sleep(.2) # Allow perf to attach before the one-shot find-bar update.
                    if thread: thread.start()
                    if case == 'find-bar': desktop.shortcut('f'); desktop.keys('fixture')
                    metrics, captures = bench.stream(desktop,4)
                    desktop.screenshot(case)
                    assert recorder.wait(timeout=10) == 0
                finally:
                    stop.set()
                    if thread: thread.join(timeout=5)
                    if recorder.poll() is None: recorder.terminate(); recorder.wait(timeout=5)
                assert not errors, errors
                counts = {}
                for line in log.read_text().splitlines():
                    fields=line.split(';')
                    if len(fields)>2 and fields[2].startswith(group+':'):
                        counts[fields[2].split(':')[1]]=int(fields[0].strip().replace(',',''))
                results[case] = {'metrics':metrics,'probes':counts,'captures':captures}
                (out/'results.json').write_text(json.dumps(results,indent=2))
                print(case,counts,flush=True)
                assert counts['present']>100, 'GPU page surface was not exercised'
                assert counts['readback']==0, 'Floating UI forced page GPU readback'
                if case!='baseline': assert counts['overlay']>0, 'Overlay was not composited above page'
                bench.check_sample('video',metrics)
                if case == 'activity': time.sleep(1.6)
                if case == 'find-bar': desktop.keys('-k','Escape')
        print('PASS:',out)
    finally:
        for name in installed:
            subprocess.run(['sudo','-n','perf','probe','--del',f'{group}:{name}'],check=True,stdout=subprocess.DEVNULL)

if __name__ == '__main__': main()
