#!/usr/bin/env python3
"""Benchmark the complete native browser using OS input and displayed pixels."""
import argparse
from collections import Counter
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
import platform
from pathlib import Path
import subprocess
import threading
import time
import traceback
from urllib.parse import urlparse
from build_config import ROOT, engine_build
from browser_metrics import process_tree
from desktop_perf_harness import Desktop, wait_for
from performance_suite import stats

SCENARIOS = ('startup-fresh-profile', 'navigation', 'history', 'reload', 'autocomplete', 'menu', 'tabs-10', 'tabs-50', 'tab-lifecycle', 'settings', 'sidebar-resize', 'scroll',
             'animation', 'video', 'mouse-animation', 'mouse-video',
             'mouse-video-full-log', 'blocked-request-burst', 'title-full-log', 'devtools-dom-mutations', 'idle')


class Fixtures:
    def __init__(self, output):
        self.output = output
        self.hits = Counter()

    def __enter__(self):
        # A frame-varying full-field image makes frozen presentation observable
        # anywhere inside the video. No external media, audio device or account.
        self.video = self.output / 'motion.webm'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i',
                        "nullsrc=s=320x180:r=60,geq=r='mod(N*7,200)+20':g='mod(N*13,200)+20':b='mod(N*19,200)+20'",
                        '-t', '8', '-an', '-c:v', 'libvpx', '-b:v', '400k', '-threads', '2', str(self.video)],
                       check=True, timeout=60)
        fixture = (ROOT / 'tests/performance/desktop.html').read_bytes()
        video = self.video.read_bytes()
        hits = self.hits
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                path = urlparse(self.path).path
                hits[path] += 1
                body, mime = (video, 'video/webm') if path == '/motion.webm' else (fixture, 'text/html')
                if path == '/page':
                    body = fixture.replace(b'<script>', ('<script>window.fixtureNavigation='+str(hits[path])+';</script><script>').encode(), 1)
                if path.startswith('/blocked/'):

                    body, mime = b'UNEXPECTED: blocker did not intercept request', 'text/plain'
                self.send_response(200)
                self.send_header('Content-Type', mime)
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass
            def log_message(self, *_):
                pass
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}'
        return self

    def __exit__(self, *_):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()


def resources(desktop):
    return {p['pid']: p for p in process_tree(desktop.browser.pid)}


def resource_delta(before, after, duration):
    ticks = os.sysconf('SC_CLK_TCK')
    def cpu(name=None):
        return sum(max(0, p['cpu_ticks'] - before.get(pid, {}).get('cpu_ticks', p['cpu_ticks']))
                   for pid, p in after.items() if name is None or p['name'] == name) / ticks
    return {'cpuPercentOneCore': 100 * cpu() / duration,
            'hubCpuPercentOneCore': 100 * cpu('Hub') / duration,
            'rssMiB': sum(p['rss_bytes'] for p in after.values()) / 1024**2}


def visible_progress(samples, duration):
    """Conservative upper bound on visible stalls, including first/last gaps."""
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('Invalid capture duration')
    previous = -1
    for row in samples:
        timestamp = row['seconds']
        if not math.isfinite(timestamp) or not previous < timestamp <= duration or not row.get('digest'):
            raise ValueError('Invalid compositor capture')
        previous = timestamp
    if len(samples) < 10:
        raise ValueError('Too few compositor captures')
    changed = [samples[0]['seconds']]
    for previous, current in zip(samples, samples[1:]):
        if current['digest'] != previous['digest']:
            changed.append(current['seconds'])
    gaps = [b-a for a,b in zip([0, *changed], [*changed, duration])]
    capture_gaps = [samples[0]['seconds'], *[b['seconds']-a['seconds'] for a,b in zip(samples, samples[1:])], duration-samples[-1]['seconds']]
    return {'visibleUpdatesPerSecond': (len(changed)-1)/duration,
            'maxVisibleStallMs': max(gaps)*1000,
            'maxCaptureGapMs': max(capture_gaps)*1000,
            'captures': len(samples)}


def stream(desktop, duration, motion=None):
    stop = threading.Event()
    moves = [0]
    errors = []
    before = resources(desktop)
    # No automation requests or activity overlay during the measurement.
    start = time.monotonic()
    def drive():
        try:
            tick = start
            while not stop.is_set():
                elapsed = time.monotonic()-start
                if motion == 'pointer':
                    desktop.pointer.move(660+120*math.sin(elapsed*9), 400+90*math.cos(elapsed*11))
                elif motion == 'scroll':
                    desktop.pointer.send(5, 3, int(time.monotonic()*1000)&0xffffffff, 0, 3*256)
                    desktop.pointer.send(5, 4)
                moves[0] += 1
                tick += 1/(500 if motion == 'pointer' else 30)
                stop.wait(max(0, tick-time.monotonic()))
        except Exception as error:
            errors.append(str(error))
    driver = threading.Thread(target=drive, daemon=True) if motion else None
    if driver:
        driver.start()
    captures = []
    try:
        next_capture = start
        while time.monotonic()-start < duration:
            pixels = desktop.pixels()
            captures.append({'seconds': time.monotonic()-start, 'digest': hashlib.sha256(pixels.tobytes()).hexdigest()})
            next_capture += .05
            time.sleep(max(0, next_capture-time.monotonic()))
    finally:
        stop.set()
        if driver:
            driver.join(timeout=5)
    elapsed = time.monotonic()-start
    if errors:
        raise RuntimeError(errors)
    metrics = visible_progress(captures, elapsed)
    metrics.update(resource_delta(before, resources(desktop), elapsed), inputEventsSent=moves[0])
    return metrics, captures


def measure(desktop, fixture, scenario, duration):
    if scenario in ('blocked-request-burst', 'title-full-log', 'devtools-dom-mutations'):
        desktop.navigate('video')
        wait_for(lambda: desktop.evaluate('document.querySelector("video").readyState >= 3'))
        tools_context = None
        if scenario == 'devtools-dom-mutations':
            desktop.evaluate('(()=>{const root=document.createElement("section");root.style.cssText="position:absolute;top:2000px";root.innerHTML="<div><span>item</span></div>".repeat(5000);document.body.append(root);window.perfNode=root.firstChild.firstChild;return true})()')
            desktop.connection.request('derpbird.request', windowId=desktop.windows()[0]['windowId'], payload={
                'type':'automation.devtools','tabId':desktop.tab['id'],'request':{'type':'devtools.refresh'}})
            def ready_tools():
                contexts = desktop.connection.request('browsingContext.getTree')['contexts']
                for context in contexts:
                    if context['url'] == 'about:derpbird' and desktop.connection.evaluate(context['context'], '!!document.querySelector(".dt")'):
                        return context['context']
            tools_context = wait_for(ready_tools)
            desktop.connection.evaluate(tools_context, '(()=>{document.querySelector("[role=tab]").click();return true})()')
            wait_for(lambda: desktop.connection.evaluate(tools_context, 'document.querySelectorAll(".dt-dom-row").length > 10'))
            action = 'perfNode.textContent=String(++window.perfChanges)'
            interval = 100
        else:
            assert desktop.evaluate('fillBlockingLog()') == 128
            time.sleep(.3)
            action = ('for(let i=0;i<4;i++)fetch("/blocked/live-"+(++window.perfChanges)+"?q="+"x".repeat(1800)).catch(()=>{})'
                      if scenario == 'blocked-request-burst' else 'document.title="Counter "+(++window.perfChanges)')
            interval = 8 if scenario == 'blocked-request-burst' else 33
        desktop.evaluate('(()=>{window.perfChanges=0;window.perfTimer=setInterval(()=>{'+action+'},'+str(interval)+');return true})()')
        # The DevTools dock occupies the right side; always sample the video itself.
        original_pixels = desktop.pixels
        desktop.pixels = lambda box='200,180 64x64': original_pixels(box)
        try:
            metrics, captures = stream(desktop, duration)
        finally:
            desktop.pixels = original_pixels
            desktop.evaluate('clearInterval(window.perfTimer)')
        count = desktop.evaluate('window.perfChanges')
        if count < duration * (200 if scenario == 'blocked-request-burst' else 5):
            raise AssertionError('Fixture did not sustain its update load')
        if scenario == 'blocked-request-burst' and any(v for k,v in fixture.hits.items() if k.startswith('/blocked/')):
            raise AssertionError('Blocked request reached HTTP server')
        metrics['fixtureChanges'] = count
        if tools_context:
            rendered = desktop.connection.evaluate(tools_context, 'document.querySelectorAll(".dt-dom-row").length')
            if not 0 < rendered < 100: raise AssertionError('DOM rows are not virtualized')
            metrics['renderedDOMRows'] = rendered
        return metrics, {'captures':captures}
    if scenario in ('animation','video','mouse-animation','mouse-video','mouse-video-full-log','scroll','idle'):
        scene = 'animation' if 'animation' in scenario else 'video' if 'video' in scenario else 'scroll' if scenario == 'scroll' else 'static'
        desktop.navigate(scene)
        if scene == 'video':
            wait_for(lambda: desktop.evaluate('!!document.querySelector("video") && !document.querySelector("video").paused && document.querySelector("video").readyState >= 3'), 20)
        if scenario.endswith('full-log'):
            if desktop.evaluate('fillBlockingLog()') != 128:
                raise AssertionError('Full blocking-log fixture was not populated')
            if any(v for k,v in fixture.hits.items() if k.startswith('/blocked/')):
                raise AssertionError('Blocked request reached HTTP server')
            # Wait for setup state publishing to finish before applying pressure.
            time.sleep(1)
        desktop.pointer.move(650, 400)
        initial = desktop.evaluate('({moves:desktopPerf.moves,scrolls:desktopPerf.scrolls})')
        metrics, captures = stream(desktop, duration, 'pointer' if scenario.startswith('mouse-') else 'scroll' if scenario == 'scroll' else None)
        actual = desktop.evaluate('({moves:desktopPerf.moves,scrolls:desktopPerf.scrolls,video:document.querySelector("video")?{time:document.querySelector("video").currentTime,paused:document.querySelector("video").paused,dropped:document.querySelector("video").getVideoPlaybackQuality().droppedVideoFrames}:null})')
        metrics['trustedMouseEvents'] = actual['moves']-initial['moves']
        metrics['scrollEvents'] = actual['scrolls']-initial['scrolls']
        if scenario.startswith('mouse-') and metrics['trustedMouseEvents'] < 100:
            raise AssertionError('Native mouse input did not reach fixture')
        if scenario == 'scroll' and metrics['scrollEvents'] < 5:
            raise AssertionError('Native wheel input did not scroll fixture')
        return metrics, {'captures': captures, 'page': actual}
    if scenario == 'sidebar-resize':
        desktop.navigate(color=1)
        desktop.command(type='shell.set-chrome-layout',layout={'preset':'sidebar','side':'left','address':'top'})
        desktop.command(type='shell.set-sidebar-width',width=196)
        wait_for(lambda: desktop.shell_rect('#sidebar-resize')['width'] > 0)
        time.sleep(.2)
        rect = desktop.shell_rect('#sidebar-resize')
        x,y=rect['x']+rect['width']/2,400
        box=f'{round(x+60)},400 16x16'
        reference=desktop.pixels(box).tobytes()
        desktop.pointer.move(x,y)
        start=time.monotonic();desktop.pointer.button(True)
        try:
            for step in range(1,13):
                desktop.pointer.move(x+step*10,y);time.sleep(.008)
        finally:
            desktop.pointer.button(False)
        wait_for(lambda: desktop.pixels(box).tobytes()!=reference)
        elapsed=(time.monotonic()-start)*1000
        wait_for(lambda: desktop.shell_rect('#sidebar-resize')['x'] > rect['x']+80)
        return {'inputToVisibleMs':elapsed}, {}
    if scenario == 'settings':
        desktop.navigate(color=1)
        desktop.type_url('about:settings')
        reference = desktop.pixels().tobytes()
        start = time.monotonic();desktop.keys('-k','Return')
        wait_for(lambda: desktop.pixels().tobytes() != reference)
        elapsed = (time.monotonic()-start)*1000
        wait_for(lambda: desktop.active_tab()['url'].startswith('about:settings'))
        desktop.tab = desktop.active_tab()
        wait_for(lambda: desktop.evaluate('document.readyState === "complete" && document.body.textContent.includes("Settings")'))
        desktop.screenshot('settings-open')
        return {'inputToVisibleMs':elapsed}, {}
    if scenario in ('autocomplete', 'menu'):
        desktop.navigate(color=1)
        if scenario == 'autocomplete':
            desktop.shortcut('l')
            # Start from a settled focused address field; measure typing -> popup pixels.
            desktop.keys('-k','BackSpace')
            wait_for(lambda: desktop.shell('!document.querySelector("#address-suggestions")'))
            location = desktop.shell_rect('#location')
            box = f"{round(location['x']+30)},{round(location['bottom']+12)} 160x48"
            reference = desktop.pixels(box).tobytes()
            start = time.monotonic(); desktop.keys('about:')
            wait_for(lambda: desktop.pixels(box).tobytes() != reference)
            elapsed = (time.monotonic()-start)*1000
            wait_for(lambda: desktop.shell('document.querySelectorAll("#address-suggestions [role=option]").length >= 2'),3)
            elapsed = (time.monotonic()-start)*1000
            desktop.keys('-k','Down')
            wait_for(lambda: desktop.shell('!!document.querySelector("#address-suggestions [aria-selected=true]")'))
            desktop.screenshot('autocomplete-open')
            desktop.keys('-k','Escape')
            wait_for(lambda: desktop.shell('!document.querySelector("#address-suggestions")'))
        else:
            rect = desktop.shell_rect('[aria-label="Menu"]')
            box = f"{max(0,round(rect['right']-160))},{round(rect['bottom']+16)} 120x48"
            reference = desktop.pixels(box).tobytes()
            desktop.pointer.move(rect['x']+rect['width']/2,rect['y']+rect['height']/2)
            start = time.monotonic(); desktop.pointer.button(True); desktop.pointer.button(False)
            wait_for(lambda: desktop.pixels(box).tobytes() != reference)
            elapsed = (time.monotonic()-start)*1000
            if not desktop.shell('!!document.querySelector(".browser-menu")'):
                raise AssertionError('Menu did not open')
            desktop.screenshot('menu-open')
            desktop.keys('-k','Escape')
            wait_for(lambda: desktop.shell('!document.querySelector(".browser-menu")'))
        return {'inputToVisibleMs':elapsed}, {}
    if scenario.startswith('tabs-'):
        count = int(scenario.split('-')[1])
        desktop.navigate(color=1)
        original = desktop.active_tab()['id']
        created = []
        try:
            # Setup may use native commands. The timed switch uses Ctrl+PageUp.
            for index in range(1,count):
                desktop.command(type='tab.create',private=False,url=fixture.url+f'/page?scene=static&color={index+1}')
                created.append(desktop.active_tab()['id'])
            desktop.tab = desktop.active_tab()
            desktop.wait_color(count,30)
            wait_for(lambda: all(t['title'].startswith('Perf ') for t in desktop.windows()[0]['tabs']),30)
            time.sleep(.3)
            start = time.monotonic();desktop.shortcut('Page_Up');desktop.wait_color(count-1)
            elapsed = (time.monotonic()-start)*1000
            if len(desktop.windows()[0]['tabs']) != count:
                raise AssertionError('Tab count mismatch')
            desktop.screenshot(scenario+'-switched')
            return {'inputToVisibleMs':elapsed,'tabCount':count,'loadedTabsRssMiB':sum(p['rss_bytes'] for p in resources(desktop).values())/1024**2}, {}
        finally:
            desktop.command(type='tab.activate',tabId=original)
            for tab in created:
                desktop.command(type='tab.close',tabId=tab)
            desktop.tab = desktop.active_tab()
            desktop.wait_color(1)
    if scenario == 'tab-lifecycle':
        desktop.navigate(color=1)
        original = desktop.active_tab()['id']
        reference=desktop.pixels().tobytes()
        start = time.monotonic();desktop.shortcut('t')
        wait_for(lambda: desktop.pixels().tobytes()!=reference)
        create_ms = (time.monotonic()-start)*1000
        wait_for(lambda: desktop.active_tab()['id'] != original)
        desktop.tab = desktop.active_tab()
        desktop.navigate(color=2)
        start = time.monotonic();desktop.shortcut('w');desktop.wait_color(1)
        close_ms = (time.monotonic()-start)*1000
        if desktop.active_tab()['id'] != original:
            raise AssertionError('Closing tab did not restore original tab')
        desktop.tab = desktop.active_tab()
        return {'createToVisibleMs':create_ms,'inputToVisibleMs':close_ms}, {}
    # Discrete interactions use the native keyboard, not synthetic DOM events.
    if scenario in ('navigation','history','reload'):
        desktop.navigate(color=1)
        desktop.navigate(color=2)
        if scenario == 'navigation':
            desktop.type_url(fixture.url+'/page?scene=static&color=3')
            start = time.monotonic(); desktop.keys('-k','Return'); desktop.wait_color(3)
        elif scenario == 'history':
            rect = desktop.shell_rect('[aria-label="Back"]')
            desktop.pointer.move(rect['x']+rect['width']/2,rect['y']+rect['height']/2)
            start = time.monotonic(); desktop.pointer.button(True); desktop.pointer.button(False); desktop.wait_color(1)
        else:
            desktop.type_url(fixture.url+'/page?scene=static&reload=1')
            desktop.keys('-k','Return')
            wait_for(lambda: desktop.active_tab()['url'].endswith('reload=1'))
            desktop.tab = desktop.active_tab()
            wait_for(lambda: desktop.evaluate('!!window.desktopPerf && new URLSearchParams(location.search).has("reload")'))
            count = fixture.hits['/page']
            desktop.wait_color(count)
            start = time.monotonic(); desktop.shortcut('r')
            wait_for(lambda: fixture.hits['/page'] > count)
            desktop.wait_color(count+1)
        elapsed = (time.monotonic()-start)*1000
        desktop.tab = desktop.active_tab()
        return {'inputToVisibleMs': elapsed}, {}
    raise ValueError('Scenario not implemented: '+scenario)


def check_sample(scenario, metrics):
    if 'maxCaptureGapMs' in metrics and metrics['maxCaptureGapMs'] > 250:
        raise ValueError('Capture sampler stalled; result is inconclusive')
    if scenario != 'idle' and 'visibleUpdatesPerSecond' in metrics:
        if metrics['visibleUpdatesPerSecond'] < 10 or metrics['maxVisibleStallMs'] > 350:
            raise ValueError(f'Visible presentation stalled: {metrics["visibleUpdatesPerSecond"]:.1f} updates/s, {metrics["maxVisibleStallMs"]:.0f} ms gap')
    if scenario in ('blocked-request-burst','title-full-log') and metrics.get('hubCpuPercentOneCore',0) > 30:
        raise ValueError('Hub state publishing exceeded 30% of one core')
    if scenario == 'devtools-dom-mutations' and metrics.get('cpuPercentOneCore',0) > 150:
        raise ValueError('Live DOM inspection exceeded 150% of one core')
    if metrics.get('processToVisibleMs',0) > 5000:
        raise ValueError('Fresh-profile startup exceeded 5000 ms')
    limit = 1000 if scenario in ('navigation','history','reload','settings') else 500 if scenario == 'sidebar-resize' else 250
    if metrics.get('inputToVisibleMs',0) > limit:
        raise ValueError(f'Native interaction exceeded {limit} ms')
    if metrics.get('createToVisibleMs',0) > 500:
        raise ValueError('Tab creation exceeded 500 ms')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'artifacts'/('browser-perf-'+time.strftime('%Y%m%d-%H%M%S')))
    parser.add_argument('--browser', type=Path, default=engine_build()/'bin/Ladybird')
    parser.add_argument('--scenario', action='append', choices=SCENARIOS)
    parser.add_argument('--list', action='store_true', help='List full-browser scenarios without launching a browser')
    parser.add_argument('--compare', type=Path, help='Successful report from the same fixture/machine/configuration')
    parser.add_argument('--samples', type=int, default=3)
    parser.add_argument('--warmups', type=int, default=1)
    parser.add_argument('--duration', type=float, default=5)
    args = parser.parse_args()
    if args.list:
        print('\n'.join(SCENARIOS))
        return 0
    if args.samples < 1 or args.warmups < 0 or not 2 <= args.duration <= 30:
        parser.error('Require samples >= 1, warmups >= 0, duration 2..30 seconds')
    out = args.output.resolve(); out.mkdir(parents=True, exist_ok=True)
    if (out/'report.json').exists():
        parser.error('Refusing to overwrite report.json')
    report = {'schema':1,'passed':False,'scenarios':{},'errors':[], 'browser':str(args.browser.resolve()),
              'scope':'Full browser and Hub; native Wayland input, compositor pixel sampling at 20 Hz; isolated software-rendered desktop, not hardware FPS.',
              'samples':args.samples,'warmups':args.warmups,'duration':args.duration}
    inputs = [ROOT/'scripts/benchmark-browser.py', ROOT/'scripts/desktop_perf_harness.py', ROOT/'tests/performance/desktop.html', ROOT/'scripts/test-shell-surface-transitions.py']
    report['compatibility'] = {'fixtureHash':hashlib.sha256(b''.join(p.read_bytes() for p in inputs)).hexdigest(),
        'machine':platform.machine(),'kernel':platform.release(), 'cpu':next((line for line in Path('/proc/cpuinfo').read_text().splitlines() if line.startswith('model name')), ''),
        'affinity':sorted(os.sched_getaffinity(0)), 'samples':args.samples,'warmups':args.warmups,'duration':args.duration,
        'captureHz':20,'pointerHz':500,'renderer':'headless sway/pixman','scenarios':args.scenario or list(SCENARIOS)}
    report['revisions'] = {name:subprocess.check_output(['git','-C',str(path),'rev-parse','HEAD'],text=True).strip() for name,path in [('browser',ROOT),('engine',ROOT/'vendor/ladybird')]}
    def save():
        (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
        write_report(report,out/'report.html')
    save()
    try:
        report['binaryHash'] = hashlib.sha256(args.browser.read_bytes()).hexdigest()
        report['compatibility']['ffmpeg'] = subprocess.check_output(['ffmpeg','-version'],text=True).splitlines()[0]
        with Fixtures(out) as fixture:
            report['mediaHash'] = hashlib.sha256(fixture.video.read_bytes()).hexdigest()
            for scenario in args.scenario or SCENARIOS:
                result = {'passed':True,'samples':[]}; report['scenarios'][scenario] = result
                try:
                    with Desktop(out/scenario, args.browser, fixture.url) as desktop:
                        for index in range(args.samples+args.warmups):
                            print(f'{scenario} sample {index}',flush=True)
                            row = {'sample':index,'warmup':index<args.warmups,'ok':False}
                            result['samples'].append(row)
                            try:
                                if scenario == 'startup-fresh-profile':
                                    with Desktop(out/scenario/f'startup-{index}', args.browser, fixture.url) as fresh:
                                        metrics, evidence = {'processToVisibleMs':fresh.startup_ms}, {}
                                else:
                                    metrics, evidence = measure(desktop,fixture,scenario,args.duration)
                                metrics.setdefault('rssMiB',sum(p['rss_bytes'] for p in resources(desktop).values())/1024**2)
                                row.update(metrics=metrics,evidence=evidence)
                                check_sample(scenario,metrics)
                                row['ok'] = True
                            except Exception as error:
                                row['error'] = type(error).__name__+': '+str(error)
                                row['traceback'] = traceback.format_exc()
                                result['passed'] = False
                                # A browser crash must remain the primary failure even if
                                # collecting its final state also loses the connection.
                                try:
                                    row['windows'] = desktop.windows()
                                except Exception as diagnostic_error:
                                    row['diagnosticError'] = str(diagnostic_error)
                                row['browserExitCode'] = desktop.browser.poll()
                                print('FAIL:',error,flush=True)
                            desktop.screenshot(f'{scenario}-{index}')
                            save()
                except Exception as error:
                    result['passed'] = False;result['error'] = type(error).__name__+': '+str(error); result['traceback'] = traceback.format_exc()
                    print('ERROR:',scenario,error,flush=True)
                measured=[row['metrics'] for row in result['samples'] if not row['warmup'] and 'metrics' in row]
                if len(measured)==args.samples:
                    result['summary']={key:stats([r[key] for r in measured]) for key in measured[0]}
                else:
                    result['passed'] = False
                save()
            report['passed'] = all(r['passed'] for r in report['scenarios'].values())
            if args.compare:
                report['regressions'] = compare_reports(report,json.loads(args.compare.read_text()))
                if report['regressions']: report['passed'] = False
    except Exception as error:
        report['errors'].append(str(error));report['passed'] = False;print('ERROR:',error,flush=True)
    finally:
        save()
    print(('PASS' if report['passed'] else 'FAIL')+': '+str(out/'report.json'))
    return 0 if report['passed'] else 1


def compare_reports(current, baseline):
    if baseline.get('schema') != current['schema'] or baseline.get('compatibility') != current['compatibility']:
        raise ValueError('Incompatible full-browser baseline')
    if not baseline.get('passed') or set(baseline['scenarios']) != set(current['scenarios']):
        raise ValueError('Baseline must contain the same successful scenarios')
    regressions=[]
    for scenario, result in current['scenarios'].items():
        prior=baseline['scenarios'][scenario]
        if not result['passed'] or not prior['passed']:
            raise ValueError('Cannot compare failed scenario '+scenario)
        if set(result['summary']) != set(prior['summary']):
            raise ValueError('Baseline metric set differs')
        for metric, summary in result['summary'].items():
            old,new=prior['summary'][metric]['median'],summary['median']
            stats([old,new])
            floor=20 if metric.endswith('Ms') else 16 if metric.endswith('RssMiB') or metric=='rssMiB' else 10 if 'PercentOneCore' in metric else None
            slower = floor is not None and new > old*1.2 and new-old > floor
            if metric=='visibleUpdatesPerSecond': slower=new < old*.8 and old-new > 2
            if slower: regressions.append(dict(scenario=scenario,metric=metric,before=old,after=new))
    return regressions


def write_report(report, path):
    from html import escape
    rows=[]
    for name,result in report['scenarios'].items():
        summary=result.get('summary',{})
        metric=next((m for m in ('maxVisibleStallMs','inputToVisibleMs','processToVisibleMs') if m in summary),None)
        value=summary.get(metric,{})
        errors=[r['error'] for r in result['samples'] if 'error' in r]+([result['error']] if 'error' in result else [])
        rows.append('<tr><td>'+escape(name)+'</td><td>'+('PASS' if result['passed'] else 'FAIL')+'</td><td>'+escape(metric or 'incomplete')+'</td><td>'+str(round(value.get('median',0),2))+'</td><td>'+str(round(value.get('p95',0),2))+'</td><td>'+escape('; '.join(errors))+'</td></tr>')
    path.write_text('<!doctype html><meta charset="utf-8"><title>Full-browser performance</title><style>body{font:14px system-ui;max-width:1200px;margin:24px auto;padding:0 16px}td,th{padding:8px;border-bottom:1px solid #ccc;text-align:left}table{border-collapse:collapse}p{line-height:1.5}</style><h1>Full-browser performance: '+('PASS' if report['passed'] else 'FAIL')+'</h1><p>'+escape(report['scope'])+'</p><p>Measured samples: '+str(report['samples'])+'; warmups: '+str(report['warmups'])+'. Startup uses fresh profiles with warm OS caches. Capture cadence limits visible-stall resolution to roughly 50 ms. CPU and memory include the browser process tree; RSS double-counts shared pages.</p><table><tr><th>Scenario</th><th>Status</th><th>Metric</th><th>Median</th><th>p95</th><th>Failures</th></tr>'+''.join(rows)+'</table><p>'+escape('; '.join(report['errors']))+'</p><p>Raw samples, pixel hashes, native input counts and resource metrics: report.json. Screenshots and browser/compositor logs are in scenario directories.</p>')


if __name__ == '__main__':
    raise SystemExit(main())
