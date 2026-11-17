#!/usr/bin/env python3
"""Check journal deltas and virtualized live DOM correctness in the real browser."""
import importlib.util
import json
import time
from build_config import ROOT, engine_build
from desktop_perf_harness import Desktop, wait_for

spec=importlib.util.spec_from_file_location('benchmark_browser',ROOT/'scripts/benchmark-browser.py')
bench=importlib.util.module_from_spec(spec);spec.loader.exec_module(bench)

def main():
    out=ROOT/'artifacts'/('performance-updates-'+time.strftime('%Y%m%d-%H%M%S'));out.mkdir()
    with bench.Fixtures(out) as fixture, Desktop(out/'desktop',engine_build()/'bin/Ladybird',fixture.url) as desktop:
        window=desktop.windows()[0]['windowId']
        def rpc(payload):return desktop.connection.request('derpbird.request',windowId=window,payload=payload)
        def log():return rpc({'type':'snapshot'}).get('blockingLog',{}).get('entries',[])
        assert desktop.evaluate('fillBlockingLog()')==128
        assert not log(), 'Hidden log was included in the shell state'
        desktop.command(type='blocking.log',visible=True)
        wait_for(lambda:len(log())==128)
        before=log()[-1]['sequence']
        desktop.evaluate('Promise.all(Array.from({length:20},(_,i)=>fetch("/blocked/delta-"+i).catch(()=>{}))).then(()=>true)')
        wait_for(lambda:log()[-1]['sequence']>before)
        rows=log();sequences=[r['sequence'] for r in rows]
        assert len(rows)==128 and sequences==sorted(set(sequences))
        desktop.command(type='blocking.clear',tabId=desktop.tab['id'])
        wait_for(lambda:not log())
        desktop.command(type='blocking.log',visible=False)
        desktop.evaluate('fetch("/blocked/while-hidden").catch(()=>true)')
        assert not log()
        desktop.command(type='blocking.log',visible=True)
        wait_for(lambda:any('while-hidden' in row['url'] for row in log()))
        desktop.screenshot('journal-reopened')
        desktop.command(type='blocking.log',visible=False)
        desktop.evaluate('(()=>{const root=document.createElement("section");root.id="large-tree";root.innerHTML=Array.from({length:5000},(_,i)=>`<div><span id="row-${i}">item-${i}</span></div>`).join("");document.body.append(root);return true})()')
        rpc({'type':'automation.devtools','tabId':desktop.tab['id'],'request':{'type':'devtools.refresh'}})
        def tools_ready():
            for context in desktop.connection.request('browsingContext.getTree')['contexts']:
                if context['url']=='about:derpbird' and desktop.connection.evaluate(context['context'],'!!document.querySelector(".dt")'):
                    return context['context']
        tools=wait_for(tools_ready)
        def evaluate(code):return desktop.connection.evaluate(tools,code)
        def panel(name):evaluate('(()=>{Array.from(document.querySelectorAll("[role=tab]")).find(e=>e.textContent==='+json.dumps(name)+').click();return true})()')
        panel('Elements')
        wait_for(lambda:evaluate('document.querySelectorAll(".dt-dom-row").length>10'))
        assert evaluate('document.querySelectorAll(".dt-dom-row").length')<100
        evaluate('(()=>{document.querySelector(".dt-dom-scroll").scrollTop=1e9;return true})()')
        wait_for(lambda:evaluate('Array.from(document.querySelectorAll(".dt-dom-row")).some(e=>e.textContent.includes("row-4999"))'))
        rect=evaluate('Array.from(document.querySelectorAll(".dt-dom-row")).find(e=>e.textContent.includes("row-4999")).getBoundingClientRect().toJSON()')
        # The right-docked tools viewport's origin is the browser's right edge minus its width.
        origin=desktop.width-evaluate('innerWidth')
        desktop.pointer.move(origin+rect['x']+30,desktop.shell_rect('#content-surface')['y']+rect['y']+rect['height']/2)
        desktop.pointer.button(True);desktop.pointer.button(False)
        desktop.evaluate('(()=>{document.querySelector("#row-4999").setAttribute("data-live","yes");return true})()')
        wait_for(lambda:evaluate('Array.from(document.querySelectorAll(".dt-dom-row")).some(e=>e.textContent.includes("data-live"))'))
        desktop.screenshot('virtualized-tail-live')
        panel('Network')
        desktop.evaluate('(()=>{document.querySelector("#row-4999").textContent="updated-while-inactive";return true})()')
        panel('Elements')
        wait_for(lambda:evaluate('Array.from(document.querySelectorAll(".dt-dom-row")).some(e=>e.textContent.includes("updated-while-inactive"))'))
        desktop.screenshot('elements-resumed')
        # Detached construction must also stay responsive with an inspector attached.
        start=time.monotonic()
        desktop.evaluate('(()=>{const root=document.createElement("aside");root.innerHTML="<div><span>detached</span></div>".repeat(5000);document.body.append(root);return true})()')
        assert time.monotonic()-start<5, 'Detached DOM construction stalled under inspection'
        (out/'result.json').write_text(json.dumps({'passed':True,'logEntries':len(rows),'detachedConstructionMs':(time.monotonic()-start)*1000},indent=2))
    print('PASS:',out)

if __name__=='__main__':main()
