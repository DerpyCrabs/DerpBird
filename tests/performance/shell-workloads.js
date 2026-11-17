window.runPerf = async function(config) {
    const assert=(ok,message)=>{if(!ok)throw Error(message);};
    const pause=ms=>new Promise(r=>setTimeout(r,ms));
    const frame=()=>new Promise(r=>requestAnimationFrame(r));
    const settle=async()=>{await frame();await frame();};
    const count=config.count;
    const tab=i=>({id:'perf-'+i,url:'https://example.test/',title:'Performance tab '+i,loading:false,canGoBack:false,canGoForward:false,pinned:false,private:false,audible:false,muted:false});
    const tabs=Array.from({length:count},(_,i)=>tab(i));
    let revision=100;
    const emit=(active=0)=>document.dispatchEvent(new CustomEvent('WebUIMessage',{detail:{name:'derpbird.snapshot',data:{version:1,revision:++revision,tabs,activeTabId:'perf-'+active,preferences:{layout:config.layout||'vertical',compact:false}}}}));
    for(let i=0;i<100&&!document.querySelector('[role=tab]');i++) await pause(10);
    assert(document.querySelector('[role=tab]'),'shell did not mount');
    emit();await settle();
    assert(document.querySelectorAll('[role=tab]').length===count,'shell tab count');
    let geometryReads=0, createdElements=0;
    const originalRect=Element.prototype.getBoundingClientRect;
    const originalCreateNS=Document.prototype.createElementNS;
    Element.prototype.getBoundingClientRect=function(...args){geometryReads++;return originalRect.apply(this,args);};
    Document.prototype.createElementNS=function(...args){createdElements++;return originalCreateNS.apply(this,args);};
    const times=[],started=performance.now();
    if(config.workload==='shell-idle') await pause(1500);
    else if(config.workload==='shell-ipc') {
        for(let i=0;i<100;i++) {
            const start=performance.now(),requestId=10000+i;
            await new Promise((resolve,reject)=>{
                const timeout=setTimeout(()=>{document.removeEventListener('WebUIMessage',listener);reject(Error('IPC timeout'));},2000);
                const listener=event=>{if(event.detail.name==='derpbird.response'&&event.detail.data.requestId===requestId){
                    clearTimeout(timeout);document.removeEventListener('WebUIMessage',listener);
                    if(event.detail.data.ok)resolve();else reject(Error('IPC failed'));
                }};
                document.addEventListener('WebUIMessage',listener);
                ladybird.sendMessage('derpbird.request',{requestId,payload:{type:'snapshot'}});
            });
            times.push(performance.now()-start);
        }
    }
    else {
        for(let i=0;i<(config.workload==='shell-pin'?6:30);i++) {
            const start=performance.now();
            if(config.workload==='shell-snapshot') {
                tabs[i%count]={...tabs[i%count],title:'Updated '+i};emit(i%count);
            } else if(config.workload==='shell-resize') {
                document.documentElement.style.width=(1000+(i%2)*200)+'px';window.dispatchEvent(new Event('resize'));
            } else if(config.workload==='shell-scroll') {
                const list=document.querySelector('.tab-list');
                list.scrollLeft=(i%2)*400; list.dispatchEvent(new Event('scroll'));
                assert(list.scrollLeft===(i%2)*400,'tab list did not scroll');
            } else if(config.workload==='shell-pin') {
                tabs[0]={...tabs[0],pinned:i%2===0};emit();
            } else throw Error('Unknown shell workload');
            await settle();
            if(config.workload==='shell-pin') {
                const deadline=performance.now()+2000;
                while(document.querySelector('.tab-list').dataset.tabLayoutAnimating==='true'&&performance.now()<deadline) await frame();
                assert(document.querySelector('.tab-list').dataset.tabLayoutAnimating!=='true','pin animation did not finish');
                assert(!!document.querySelector('[data-tab-id="perf-0"]').closest('.pinned-tabs')===tabs[0].pinned,'pin placement');
            }
            times.push(performance.now()-start);
        }
    }
    Element.prototype.getBoundingClientRect=originalRect;
    Document.prototype.createElementNS=originalCreateNS;
    assert(document.querySelectorAll('[role=tab]').length===count,'shell lost tabs');
    const rect=document.querySelector('#content-surface').getBoundingClientRect();
    assert(rect.width>0&&rect.height>0,'shell viewport collapsed');
    if(config.workload==='shell-snapshot') assert(document.querySelector('[data-tab-id="perf-'+(29%count)+'"]').textContent.includes('Updated 29'),'snapshot not rendered');
    times.sort((a,b)=>a-b);
    return {ok:true,metrics:{geometryReads,createdElements,elapsedMs:performance.now()-started,updateP95Ms:times[Math.max(0,Math.ceil(times.length*.95)-1)]||0,updates:times.length,domNodes:document.querySelectorAll('*').length}};
};
