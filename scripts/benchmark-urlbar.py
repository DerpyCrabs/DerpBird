#!/usr/bin/env python3
"""Benchmark input-event -> suggestion DOM -> next RAF in native Ladybird.

Includes EffectWeb updates and native autocomplete IPC. Excludes OS input
transport and physical display presentation. Uses a fresh isolated profile,
local autocomplete (remote suggestions disabled), and no external network.
"""
import argparse, importlib.util, json, os, signal, subprocess, time
from pathlib import Path


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('browser','environment','settings','output'):p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--samples',type=int,default=30)
    p.add_argument('--max-p95-ms',type=float)
    a=p.parse_args();assert 5<=a.samples<=100
    env=dict(os.environ,**json.loads(a.environment.read_text()));assert 'artifacts' in env['XDG_RUNTIME_DIR']
    capture=dict(os.environ,XDG_RUNTIME_DIR=env['XDG_RUNTIME_DIR'],WAYLAND_DISPLAY=env['WAYLAND_DISPLAY'])
    a.output.mkdir(parents=True,exist_ok=True);profile=a.output/'profile';assert not profile.exists()
    (profile/'config').mkdir(parents=True);settings=json.loads(a.settings.read_text());settings['restorePreviousSession']=False;settings['derpbirdSessionRestoreInitialized']=True;settings.setdefault('searchEngine',{})['suggestions']=False
    (profile/'config/Settings.json').write_text(json.dumps(settings))
    helper=Path(__file__).with_name('ladybird-devtools-eval.py')
    def evaluate(code):
        f=a.output/'evaluate.js';f.write_text(code)
        r=subprocess.run(['python3',str(helper),'--port','18993','--url','about:derpbird','--script',str(f)],capture_output=True,text=True,timeout=15,check=True)
        return json.loads(r.stdout).get('result')
    def until(code,timeout=20):
        end=time.monotonic()+timeout
        while time.monotonic()<end:
            try:
                v=evaluate(code)
                if v:return v
            except subprocess.CalledProcessError:pass
            time.sleep(.1)
        raise AssertionError(code)
    def shot(name):
        time.sleep(.2);subprocess.run(['grim','-o','WAYLAND-1',str(a.output/(name+'.png'))],env=capture,check=True,timeout=10)
    with (a.output/'browser.log').open('w') as log:
        browser=subprocess.Popen([str(a.browser),'--profile-path',str(profile.resolve()),'--devtools=18993','about:blank'],env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    spec=importlib.util.spec_from_file_location('pointer',Path(__file__).with_name('test-shell-surface-transitions.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);pointer=m.Pointer(capture,[1280,720])
    try:
        until('!!document.querySelector("[role=tab]")')
        evaluate('''window.urlbarBench={done:false};(async()=>{
          const input=document.getElementById('location'), samples=[];
          const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
          const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
          const rect=()=>JSON.stringify(input.getBoundingClientRect().toJSON());
          const original=rect();
          for(const scenario of ['first-character','multiple-results']) {
            for(let i=0;i<SAMPLES+3;i++) {
              input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
              await frame(); await frame();
              input.focus(); input.value=scenario==='first-character'?'e':'about:';
              let resolve,domMs;const ready=new Promise(r=>resolve=r);
              const started=performance.now();
              const observer=new MutationObserver(()=>{
                if(document.querySelector('#address-suggestions [role=option]')){domMs=performance.now()-started;observer.disconnect();resolve();}
              });observer.observe(document.getElementById('app'),{subtree:true,childList:true});
              input.dispatchEvent(new Event('input',{bubbles:true}));
              await Promise.race([ready,pause(2000).then(()=>{if(domMs===undefined)throw Error('No popup')})]);
              await frame();
              const row={scenario,domMs,nextRafMs:performance.now()-started,rows:document.querySelectorAll('#address-suggestions [role=option]').length};
              if(rect()!==original)throw Error('Address input moved');
              if(i>=3)samples.push(row);
            }
          }
          window.urlbarBench={done:true,samples,geometryStable:true,dpr:devicePixelRatio};
        })().catch(e=>window.urlbarBench={done:true,error:String(e)});true'''.replace('SAMPLES',str(a.samples)))
        result=json.loads(until('window.urlbarBench.done&&JSON.stringify(window.urlbarBench)',90));assert not result.get('error'),result
        def stats(values):
            v=sorted(values);return {'p50':v[len(v)//2],'p95':v[min(len(v)-1,int(len(v)*.95))],'max':max(v)}
        result['scope']=__doc__;result['summary']={s:{metric:stats([v[metric] for v in result['samples'] if v['scenario']==s]) for metric in ['domMs','nextRafMs']} for s in ['first-character','multiple-results']}
        shot('01-open')
        r=json.loads(evaluate('JSON.stringify({r:document.querySelectorAll("#address-suggestions button")[1].getBoundingClientRect().toJSON(),dpr:devicePixelRatio})'))
        pointer.move((r['r']['left']+30)*r['dpr'],(r['r']['top']+r['r']['height']/2)*r['dpr']);shot('02-hover')
        pointer.move(1200,600)
        evaluate('document.getElementById("location").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true,cancelable:true}));true');shot('03-keyboard')
        result['keyboardSelection']=evaluate('document.querySelector("#address-suggestions [aria-selected=true]")?.id===document.getElementById("location").getAttribute("aria-activedescendant")')
        pointer.button(True);pointer.button(False);until('!document.getElementById("address-suggestions")');shot('04-page-dismiss')
        result['pageDismiss']=True
        (a.output/'results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result['summary']))
        assert result['keyboardSelection']
        if a.max_p95_ms is not None:assert all(s['nextRafMs']['p95']<=a.max_p95_ms for s in result['summary'].values()),result['summary']
    finally:
        pointer.close()
        if browser.poll() is None:
            os.killpg(browser.pid,signal.SIGTERM)
            try:browser.wait(timeout=5)
            except subprocess.TimeoutExpired:os.killpg(browser.pid,signal.SIGKILL);browser.wait()

if __name__=='__main__':main()
