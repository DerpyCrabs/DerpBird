#!/usr/bin/env python3
"""Build and run the offline performance suite, preserving every sample and failure."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import tempfile
import math
import threading
import time
from build_config import ROOT, engine_build, native_build, build_jobs
from build_tasks import suites_build
from browser_metrics import BrowserMetrics, process_tree
from performance_report import write_html
from performance_suite import SCHEMA, FixtureServer, scenarios, summarize, compare, fixture_hash, stats, component_summary, check_budgets


def execute(command, directory, environment, timeout, sample_processes=False):
    directory.mkdir(parents=True,exist_ok=True)
    records=[];phases=[];ends={};started=time.monotonic()
    process=subprocess.Popen(list(map(str,command)),cwd=ROOT,env=environment,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
                             text=True,start_new_session=True)
    monitor=BrowserMetrics(process.pid,directory/'processes.json',interval=.25) if sample_processes else None
    def terminate():
        try:os.killpg(process.pid,signal.SIGKILL)
        except ProcessLookupError:pass
    deadline=threading.Timer(timeout,terminate);deadline.start()
    try:
        with (directory/'output.log').open('w') as log:
            for line in process.stdout:
                log.write(line);log.flush()
                if line.startswith('PERF_SAMPLE '):
                    row=json.loads(line[12:]);records.append(row);ends[row['sample']]=time.monotonic()-started
                if line.startswith('PERF_PHASE '):
                    processes=process_tree(process.pid)
                    phases.append(dict(seconds=time.monotonic()-started,rssBytes=sum(p['rss_bytes'] for p in processes),**json.loads(line[11:])))
        code=process.wait()
    finally:
        deadline.cancel();terminate();process.wait();process.stdout.close()
        if monitor:monitor.close()
        (directory/'phases.json').write_text(json.dumps(phases,indent=2)+'\n')
    if code:raise RuntimeError(f'Command exited {code}; inspect {directory / "output.log"}')
    for row in records:
        phase=next((p for p in phases if p['sample']==row['sample']),None)
        if phase and row.get('ok'):
            row['metrics']['postLoadRssMiB']=phase['rssBytes']/1024**2
            if 'idle' in row['id'] and monitor:
                offset=monitor.started-started
                windows=[s for s in monitor.samples if s['seconds']+offset-s['interval_seconds']>=phase['seconds'] and s['seconds']+offset<=ends[row['sample']]]
                if not windows:raise ValueError('No complete idle CPU measurement interval')
                row['metrics']['idleCpuPercentOneCore']=100*sum(s['cpu_seconds'] for s in windows)/sum(s['interval_seconds'] for s in windows)
    return records


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path)
    parser.add_argument('--samples',type=int,default=5)
    parser.add_argument('--warmups',type=int,default=1)
    parser.add_argument('--scenario',action='append',help='Exact scenario id; marks the run as partial')
    parser.add_argument('--list',action='store_true')
    parser.add_argument('--no-build',action='store_true',help='Diagnostic only; report cannot be used as a baseline')
    parser.add_argument('--compare',type=Path,help='A previous complete report.json')
    parser.add_argument('--relative-threshold',type=float,default=.20)
    parser.add_argument('--absolute-threshold-ms',type=float,default=2)
    args=parser.parse_args()
    if args.list:
        for row in scenarios():print(row['id'])
        return 0
    if not 2<=args.samples<=50 or not 1<=args.warmups<=10:parser.error('Use 2–50 samples and 1–10 warmups')
    if not all(math.isfinite(v) and v>=0 for v in (args.relative_threshold,args.absolute_threshold_ms)):parser.error('Thresholds must be nonnegative')
    selected=scenarios()
    if args.scenario:
        unknown=set(args.scenario)-{r['id'] for r in selected}
        if unknown:parser.error(f'Unknown scenarios: {sorted(unknown)}')
        selected=[r for r in selected if r['id'] in args.scenario]
    (ROOT/'artifacts').mkdir(exist_ok=True)
    output=args.output.resolve() if args.output else Path(tempfile.mkdtemp(prefix='performance-',dir=ROOT/'artifacts'))
    output.mkdir(parents=True,exist_ok=True)
    if (output/'report.json').exists():parser.error('Output already has a report; choose a new directory')
    env=dict(os.environ,LADYBIRD_SOURCE_DIR=str(ROOT/'vendor/ladybird'))
    # Avoid routing offline fixtures through an inherited HTTP proxy.
    for key in ('http_proxy','https_proxy','all_proxy','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY'):env.pop(key,None)
    env.update(NO_PROXY='127.0.0.1,localhost',no_proxy='127.0.0.1,localhost')
    cpu=next((line.split(':',1)[1].strip() for line in Path('/proc/cpuinfo').read_text().splitlines() if line.startswith('model name')),platform.machine())
    compatibility=dict(schema=SCHEMA,fixtureHash=fixture_hash(),cpu=cpu,machine=platform.machine(),kernel=platform.release(),
                       affinity=sorted(os.sched_getaffinity(0)),engineBuild=str(engine_build()),samples=args.samples,warmups=args.warmups)
    cache=(engine_build()/'CMakeCache.txt').read_text() if (engine_build()/'CMakeCache.txt').exists() else ''
    compatibility['buildConfig']=[line for line in cache.splitlines() if line.startswith(('CMAKE_BUILD_TYPE:','CMAKE_CXX_COMPILER:','CMAKE_CXX_FLAGS:','CMAKE_CXX_FLAGS_RELEASE:'))]
    compatibility['desktopCompositor']=os.environ.get('DERPBIRD_TEST_SWAY','sway')
    report=dict(schema=SCHEMA,compatibility=compatibility,started=time.time(),passed=False,complete=not args.scenario and not args.no_build,
                revisions={name:subprocess.check_output(['git','-C',str(path),'rev-parse','HEAD'],text=True).strip() for name,path in [('browser',ROOT),('engine',ROOT/'vendor/ladybird')]},
                dirty=subprocess.check_output(['git','status','--short'],cwd=ROOT,text=True).splitlines(),results={},components={},errors=[])
    def save(): (output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    save()
    try:
        if not args.no_build:
            # Build once, before measurements. Never benchmark concurrently.
            with (output/'build.log').open('w') as log:
                build=subprocess.run([sys.executable,'-c',"from build_tasks import build_suites,configure_tests; from build_config import native_build; build_suites(['TestDerpBirdPerformance']); configure_tests('tests/native',native_build(True),True)"],
                    cwd=ROOT/'scripts',stdout=log,stderr=subprocess.STDOUT,timeout=1800)
                if build.returncode:raise RuntimeError('Build failed; inspect build.log')
                subprocess.run(['cmake','--build',str(native_build(True)),'--parallel',str(build_jobs()),'--target','benchmark-user-styles','benchmark-script-values'],stdout=log,stderr=subprocess.STDOUT,check=True,timeout=600)
        report['binaryHashes']={}
        for binary in (suites_build()/'TestDerpBirdPerformance',engine_build()/'bin/Ladybird',engine_build()/'lib/liblagom-web.so'):
            with binary.open('rb') as stream:report['binaryHashes'][str(binary)]=hashlib.file_digest(stream,'sha256').hexdigest()
        with FixtureServer() as server:
            for index,scenario in enumerate(selected):
                name=scenario['id'];directory=output/name
                print(f'[{index+1}/{len(selected)}] {name}',flush=True)
                result=dict(config=scenario,passed=False)
                report['results'][name]=result
                try:
                    config=dict(scenario,samples=args.samples,warmups=args.warmups)
                    rows=execute([suites_build()/'TestDerpBirdPerformance','--suite','TestDerpBirdPerformance'],directory,
                                 dict(env,DERPBIRD_PERF_ENDPOINT=server.endpoint,DERPBIRD_PERF_CONFIG=json.dumps(config),DERPBIRD_PERF_OUTPUT=str(directory),DERPBIRD_PERF_TIMEOUT=str(max(180,(args.samples+args.warmups)*30))),max(180,(args.samples+args.warmups)*30)+5,True)
                    result.update(samples=rows,summary=summarize(rows,scenario,args.samples,args.warmups),passed=True)
                    result['budgetsMs']=check_budgets(name,result['summary'])
                    memory=json.loads((directory/'processes.json').read_text())
                    if memory['error']:raise RuntimeError(memory['error'])
                    result['resources']=dict(peakAggregateRssBytes=max((s['aggregate_rss_bytes'] for s in memory['samples']),default=0),
                                             sampledCpuSeconds=sum(s['cpu_seconds'] for s in memory['samples']),samples=len(memory['samples']))
                except Exception as error:
                    result['passed']=False;result['error']=str(error);print(f'FAIL: {error}',flush=True)
                save()
        if not args.scenario:
            for name,command in [('filter-work-counts',['bun','scripts/benchmark-page-filtering.ts']),
                                 ('style-matching',[native_build(True)/'benchmark-user-styles']),
                                 ('script-storage',[native_build(True)/'benchmark-script-values'])]:
                component=dict(passed=False);report['components'][name]=component
                try:
                    runs=[]
                    expected={'filter-work-counts':4,'style-matching':7,'script-storage':4}[name]
                    for iteration in range(args.samples+args.warmups):
                        directory=output/name/str(iteration)
                        execute(command,directory,env,120)
                        rows=[json.loads(line) for line in (directory/'output.log').read_text().splitlines() if line.startswith('{')]
                        if len(rows)!=expected:raise ValueError(f'Expected {expected} component rows, got {len(rows)}')
                        runs.append(rows)
                    component.update(passed=True,runs=runs,summary=component_summary(runs,args.warmups))
                except Exception as error:component['error']=str(error)
                save()
        if not args.scenario:
            print('Full browser: native input, Hub and displayed pixels',flush=True)
            desktop=dict(passed=False);report['components']['full-browser']=desktop
            try:
                execute([sys.executable,'scripts/benchmark-browser.py','--output',output/'browser','--samples',args.samples,'--warmups',args.warmups],output/'browser-runner',env,max(1800,(args.samples+args.warmups)*120))
                data=json.loads((output/'browser/report.json').read_text())
                if not data['passed']:raise ValueError('Full-browser correctness or presentation budget failed')
                desktop.update(passed=True,summary={name+'.'+metric:values for name,result in data['scenarios'].items() for metric,values in result['summary'].items()},results=data)
            except Exception as error:
                desktop['error']=str(error)
                saved=output/'browser/report.json'
                if saved.exists():desktop['results']=json.loads(saved.read_text())
            save()
        report['passed']=all(r['passed'] for r in report['results'].values()) and all(r['passed'] for r in report['components'].values())
        if args.compare:
            if not report['complete']:raise ValueError('Baseline comparison requires a complete rebuilt run')
            baseline=json.loads(args.compare.read_text())
            if not baseline.get('complete'):raise ValueError('Baseline is partial or used --no-build')
            report['regressions']=compare(report,baseline,args.relative_threshold,args.absolute_threshold_ms)
            if report['regressions']:report['passed']=False
    except Exception as error:
        report['errors'].append(str(error));report['passed']=False;print(str(error),file=sys.stderr)
    report['limitations']=['Offline synthetic workloads; no public-site load-time claim.', 'Headless compositor/RAF and capture, not physical display presentation or GPU FPS.', 'Aggregate RSS double-counts shared pages; sampled CPU can miss short-lived children.', 'Five-run p95 is descriptive, not a statistically stable tail estimate; use --samples 30 for release baselines.', 'Headless page/shell scenarios are component diagnostics. The full-browser group covers Qt, Hub, native input and compositor pixel sampling on an isolated software-rendered desktop.', 'Component microbenchmarks do not measure renderer IPC cost.']
    report['durationSeconds']=time.time()-report['started'];save()
    write_html(report,output/'report.html')
    print(f'{"PASS" if report["passed"] else "FAIL"}: {output / "report.json"}',flush=True)
    return 0 if report['passed'] else 1

if __name__=='__main__':raise SystemExit(main())
