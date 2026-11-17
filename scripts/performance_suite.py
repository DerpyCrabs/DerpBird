"""Offline native performance fixtures, statistics and baseline validation."""
import hashlib
import http.server
import json
import math
import platform
import statistics
import struct
import threading
import urllib.parse
import zlib
from collections import Counter
from pathlib import Path
from build_config import ROOT

SCHEMA = 1

def scenarios():
    rows = []
    def add(id, workload, count=2000, **options):
        rows.append(dict(id=id, kind='page', workload=workload, count=count, mode='off', **options))
    for count in (0, 2000, 10000):
        add(f'navigation-{count}', 'navigation', count)
    add('navigation-churn', 'navigation', cycles=20)
    add('capture-viewport', 'navigation', capture=True)
    for workload in ('insert-remove', 'attributes', 'text', 'classes', 'layout', 'animation', 'scroll', 'images', 'canvas', 'fetch', 'cache', 'history', 'javascript', 'storage', 'shadow-dom', 'iframe', 'worker'):
        add(workload, workload)
    for mode, rules in [('cosmetic', 1), ('procedural', 1), ('procedural', 20)]:
        for workload in ('attributes', 'text', 'classes'):
            row=dict(id=f'{mode}-{rules}-{workload}',kind='page',workload=workload,count=2000,mode=mode,rules=rules)
            rows.append(row)
    for rules in (1000,10000):
        for workload in ('fetch','blocked-fetch'):
            rows.append(dict(id=f'network-{rules}-{workload}',kind='page',workload=workload,count=200,mode='network',rules=rules))
    for count in (100,1000):
        add(f'user-styles-{count}', 'navigation', styles=count)
    add('styles-history-1000', 'history', styles=1000)
    for count in (10,50):
        add(f'user-scripts-{count}', 'navigation', scripts=count)
    for count in (1,8):
        add(f'idle-tabs-{count}', 'idle', tabs=count)
    for layout in ('vertical','horizontal'):
        for count in (10,100,500):
            rows.append(dict(id=f'shell-{layout}-{count}',kind='shell',workload='shell-snapshot',count=count,layout=layout,mode='off'))
    for workload in ('shell-idle','shell-resize','shell-ipc'):
        rows.append(dict(id=workload,kind='shell',workload=workload,count=100,mode='off'))
    for workload in ('shell-scroll','shell-pin'):
        rows.append(dict(id=workload,kind='shell',workload=workload,count=500,layout='horizontal',mode='off',capture=True))
    return rows


def stats(values):
    if not values or any(not isinstance(v,(int,float)) or isinstance(v,bool) or not math.isfinite(v) or v<0 for v in values):
        raise ValueError('Metrics must be nonempty, finite, nonnegative numbers')
    ordered=sorted(values)
    median=statistics.median(ordered)
    return dict(n=len(values),median=median,p95=ordered[max(0,math.ceil(.95*len(values))-1)],
                minimum=ordered[0],maximum=ordered[-1],mad=statistics.median(abs(v-median) for v in ordered))


def summarize(rows, scenario, samples, warmups):
    if len(rows)!=samples+warmups:
        raise ValueError(f'Expected {samples+warmups} samples, received {len(rows)}')
    for index,row in enumerate(rows):
        if row.get('id')!=scenario['id'] or row.get('sample')!=index or row.get('warmup')!=(index<warmups) or row.get('ok') is not True:
            raise ValueError(f'Invalid/failed sample {index}: {row}')
    measured=rows[warmups:]
    keys=set(measured[0]['metrics'])
    if not keys or any(set(row['metrics'])!=keys for row in rows):
        raise ValueError('Missing/inconsistent metrics')
    return {key:stats([row['metrics'][key] for row in measured]) for key in sorted(keys)}


# Responsiveness guardrails, not a claim of physical frame presentation.
# Use medians across repeated runs to avoid failing on one scheduling outlier.
def check_budgets(name, summary):
    budgets = {}
    if name == 'styles-history-1000': budgets = {'elapsedMs': 100, 'heartbeatMaxMs': 100}
    elif name.startswith('procedural-'): budgets = {'heartbeatMaxMs': 50}
    elif name.startswith(('shell-horizontal-', 'shell-vertical-')):
        budgets = {'updateP95Ms': 100 if name.endswith('-500') else 50}
    elif name == 'desktop-urlbar':
        budgets = {scenario + '.nextRafMs': 50 for scenario in ('first-character', 'multiple-results')}
    for metric, limit in budgets.items():
        value = summary[metric]['median']
        stats([value])
        if value > limit:
            raise ValueError(f'{name}: median {metric} {value:.2f} ms exceeds {limit} ms responsiveness budget')
    return budgets


def compare(current, baseline, relative=.20, absolute_ms=2):
    for key in ('schema','compatibility'):
        if current.get(key)!=baseline.get(key):
            raise ValueError(f'Incompatible baseline: {key}')
    if not baseline.get('passed'):
        raise ValueError('Baseline is not a successful complete run')
    changes=[]
    for group in ('results','components'):
        left=current.get(group,{ });right=baseline.get(group,{ })
        if set(left)!=set(right):raise ValueError(f'Baseline {group} set differs')
        for name,result in left.items():
            prior=right[name]
            if result.get('passed') is not True or prior.get('passed') is not True:
                raise ValueError(f'Failed scenario: {name}')
            if set(result['summary'])!=set(prior['summary']):raise ValueError(f'Baseline metrics differ: {name}')
            for metric, values in result['summary'].items():
                floor=(max(absolute_ms,20) if name=='full-browser' else absolute_ms) if metric.endswith('Ms') else 16 if metric.endswith('MiB') else (10 if name=='full-browser' else 2) if metric.endswith('PercentOneCore') else None
                if floor is None and not metric.endswith('visibleUpdatesPerSecond'):continue
                old=prior['summary'][metric]['median'];new=values['median'];stats([old,new])
                regressed = (new < old*(1-relative) and old-new > 2) if metric.endswith('visibleUpdatesPerSecond') else (new>old*(1+relative) and new-old>floor)
                if regressed:
                    changes.append(dict(scenario=name,metric=metric,before=old,after=new,percent=100*(new-old)/old if old else None))
    return changes


def fixture_hash():
    paths=list((ROOT/'tests/performance').glob('*.js'))+[ROOT/path for path in ('native/Tests/TestDerpBirdPerformance.cpp','scripts/performance_suite.py','scripts/benchmark-performance.py','scripts/benchmark-desktop.py','scripts/benchmark-urlbar.py','scripts/benchmark-browser.py','scripts/desktop_perf_harness.py','tests/performance/desktop.html','scripts/test-shell-surface-transitions.py','scripts/benchmark-page-filtering.ts','tests/helpers/procedural-performance.ts','tests/native/style-benchmark.cpp','tests/native/script-values-benchmark.cpp')]
    digest=hashlib.sha256()
    for path in sorted(p for p in paths if p.is_file()):
        digest.update(str(path.relative_to(ROOT)).encode());digest.update(path.read_bytes())
    return digest.hexdigest()


def png():
    def chunk(kind, data):
        return struct.pack('!I',len(data))+kind+data+struct.pack('!I',zlib.crc32(kind+data)&0xffffffff)
    raw=b''.join(b'\x00'+bytes([x%256,y%256,128])*128 for y,x in enumerate(range(128)))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',128,128,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')


class FixtureServer:
    def __enter__(self):
        counts=Counter();lock=threading.Lock();image=png()
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self,*args): pass
            def do_GET(self):
                parsed=urllib.parse.urlparse(self.path);query=urllib.parse.parse_qs(parsed.query)
                with lock: counts[parsed.path]+=1
                cache=False;mime='text/html';status=200
                if parsed.path=='/stats':
                    prefix=query.get('prefix',[''])[0]
                    with lock: body=json.dumps(sum(n for path,n in counts.items() if path.startswith(prefix))).encode()
                    mime='application/json'
                elif parsed.path.startswith(('/payload/','/blocked/')):
                    body=b'payload-ok';mime='text/plain';cache=True
                elif parsed.path=='/workload.js':
                    body=(ROOT/'tests/performance/page-workloads.js').read_bytes();mime='text/javascript'
                elif parsed.path=='/image.png': body=image;mime='image/png'
                elif parsed.path=='/page':
                    count=int(query.get('count',['0'])[0]);assert 0<=count<=10000
                    cards=''.join(f'<div class="card">Sponsored {i}<span> article text</span></div>' for i in range(count))
                    body=('''<!doctype html><meta charset=utf-8><title>Performance fixture</title>
                    <style>body{margin:0;font:16px sans-serif}#cards{display:grid;grid-template-columns:repeat(4,1fr);gap:2px;width:900px}.card{min-height:24px;padding:2px}img{width:128px;height:128px}</style>
                    <output id=probe>Probe</output><main id=cards>'''+cards+'</main><section id=work></section><script src=/workload.js></script>').encode()
                else: status=404;body=b'not-found'
                self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(body)))
                self.send_header('Cache-Control','public, max-age=3600' if cache else 'no-store');self.end_headers()
                try:self.wfile.write(body)
                except (BrokenPipeError,ConnectionResetError): pass
        self.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.endpoint=f'http://127.0.0.1:{self.server.server_port}'
        return self
    def __exit__(self,*args):
        self.server.shutdown();self.server.server_close();self.thread.join()


def component_summary(runs, warmups):
    if len(runs)<=warmups or not runs[0]:raise ValueError('Missing component samples')
    first=runs[0]
    if any(len(run)!=len(first) for run in runs):raise ValueError('Component row count changed')
    result={}
    for index,row in enumerate(first):
        identity={k:v for k,v in row.items() if not isinstance(v,(int,float))}
        for run in runs:
            if set(run[index])!=set(row) or {k:v for k,v in run[index].items() if not isinstance(v,(int,float))}!=identity:
                raise ValueError('Component identity/metric schema changed')
        for key,value in row.items():
            if not isinstance(value,(int,float)):continue
            metric=key[:-3]+'Ms' if key.endswith('_us') else key
            # Happy DOM wall time is diagnostic, never a native timing gate.
            if key=='harnessMs':metric='harnessDiagnostic'
            result[f'{index}.{metric}']=stats([run[index][key]/(1000 if key.endswith('_us') else 1) for run in runs[warmups:]])
    return result
