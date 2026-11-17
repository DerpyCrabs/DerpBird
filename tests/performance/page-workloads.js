/* Shared deterministic fixtures, executed by the native LibWeb renderer. */
window.runPerf = async function(config) {
    const assert = (condition, message) => { if (!condition) throw Error(message); };
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const quantile = (values, q) => [...values].sort((a,b) => a-b)[Math.max(0, Math.ceil(values.length*q)-1)] || 0;
    const cards = [...document.querySelectorAll('.card')];
    const count = config.count;
    assert(cards.length === count, 'fixture card count');
    assert(document.querySelector('#probe'), 'fixture loaded');
    if (config.styles) assert(getComputedStyle(document.querySelector('#probe')).color === 'rgb(12, 34, 56)', 'user style missing');
    assert(Number(document.documentElement.dataset.userScripts || 0) === (config.scripts || 0), 'userscript execution count');
    if (config.mode === 'procedural' || config.mode === 'cosmetic') {
        for (let i=0;i<100 && getComputedStyle(cards[0]).display !== 'none';i++) await pause(10);
        assert(cards.every(n => getComputedStyle(n).display === 'none'), 'filter failed to hide fixture');
    }
    const metrics = {}, gaps = [];
    let previous = performance.now();
    const heartbeat = setInterval(() => { const now=performance.now(); gaps.push(now-previous); previous=now; }, 5);
    const started = performance.now();
    try {
        switch (config.workload) {
        case 'navigation':
            assert(document.readyState === 'complete', 'navigation incomplete');
            metrics.domNodes = document.querySelectorAll('*').length;
            break;
        case 'insert-remove': {
            for (let turn=0;turn<10;turn++) {
                const fragment=document.createDocumentFragment();
                for(let i=0;i<count;i++){const n=document.createElement('div');n.className='added';n.textContent='Inserted '+i;fragment.appendChild(n);}
                document.querySelector('#work').append(fragment);
                assert(document.querySelectorAll('.added').length===count,'insert count');
                document.querySelector('#work').replaceChildren();
                await pause(0);
            }
            assert(document.querySelectorAll('.added').length===0,'remove count');
            metrics.operations=count*20;
            break;
        }
        case 'attributes':
        case 'text':
        case 'classes':
            for(let turn=0;turn<30;turn++) {
                if(config.workload==='attributes') document.querySelector('#probe').setAttribute('data-clock',String(turn));
                if(config.workload==='text') cards[turn%count].textContent='Sponsored changed '+turn;
                if(config.workload==='classes') cards[turn%count].className='card state'+turn;
                await pause(20);
            }
            if(config.workload==='attributes') assert(document.querySelector('#probe').dataset.clock==='29','attribute result');
            if(config.workload==='text') assert(cards[29%count].textContent==='Sponsored changed 29','text result');
            if(config.workload==='classes') assert(cards[29%count].classList.contains('state29'),'class result');
            metrics.operations=30;
            break;
        case 'layout': {
            let total=0;
            for(let turn=0;turn<20;turn++) {
                document.querySelector('#cards').style.width=(700+turn)+'px';
                for(const node of cards) total+=node.getBoundingClientRect().width;
            }
            assert(total>0,'layout has no geometry'); metrics.operations=count*20; metrics.geometryChecksum=total;
            break;
        }
        case 'animation':
        case 'scroll': {
            const intervals=[];let last=performance.now();
            for(let i=0;i<30;i++) {
                if(config.workload==='scroll') scrollTo(0,i*20);
                else document.querySelector('#cards').style.transform=`translateX(${i}px)`;
                await frame(); const now=performance.now(); intervals.push(now-last);last=now;
            }
            if(config.workload==='scroll') assert(scrollY>0,'scroll did not move');
            else assert(document.querySelector('#cards').style.transform==='translateX(29px)','animation result');
            metrics.frameP95Ms=quantile(intervals,.95);metrics.frameMaxMs=Math.max(...intervals);metrics.frames=intervals.length;
            break;
        }
        case 'fetch':
        case 'cache': {
            const prefix='/payload/'+config.token+'/';
            const urls=Array.from({length:32},(_,i)=>prefix+i);
            const request = async () => {
                const values=await Promise.all(urls.map(url=>fetch(url).then(r=>{assert(r.ok,'HTTP error');return r.text();})));
                assert(values.every(v=>v==='payload-ok'),'payload integrity');
            };
            const cold=performance.now();await request();metrics.coldBatchMs=performance.now()-cold;
            const before=await fetch('/stats?prefix='+encodeURIComponent(prefix)).then(r=>r.json());
            assert(before===32,'cold requests did not reach server');
            if(config.workload==='cache') {
                const warm=performance.now();await request();metrics.warmBatchMs=performance.now()-warm;
                const after=await fetch('/stats?prefix='+encodeURIComponent(prefix)).then(r=>r.json());
                assert(after===before,'warm cache reached server');
            }
            metrics.requests=32;
            break;
        }
        case 'blocked-fetch': {
            const prefix='/blocked/'+config.token+'/';
            const responses=await Promise.all(Array.from({length:32},(_,i)=>fetch(prefix+i).then(()=>false,()=>true)));
            assert(responses.every(Boolean),'request escaped blocker');
            assert(await fetch('/stats?prefix='+encodeURIComponent(prefix)).then(r=>r.json())===0,'blocked request reached server');
            metrics.requests=32;break;
        }
        case 'images': {
            const images=Array.from({length:32},(_,i)=>{const img=new Image();img.src='/image.png?'+config.token+'-'+i;return img;});
            await Promise.all(images.map(img=>new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('image load'));})));
            for(const img of images){assert(img.naturalWidth===128,'image dimensions');document.querySelector('#work').append(img);}
            await frame();await frame();metrics.images=images.length;break;
        }
        case 'canvas': {
            const canvas=document.createElement('canvas');canvas.width=800;canvas.height=600;document.querySelector('#work').append(canvas);
            const context=canvas.getContext('2d');assert(context,'canvas context');
            for(let i=0;i<10000;i++){context.fillStyle=i%2?'#123456':'#abcdef';context.fillRect(i%800,i%600,20,20);}
            context.fillStyle='#123456';context.fillRect(0,0,1,1);
            const pixel=context.getImageData(0,0,1,1).data;
            assert(pixel[0]===18&&pixel[1]===52&&pixel[2]===86,'canvas pixels');metrics.operations=10000;break;
        }
        case 'javascript': {
            const input=Array.from({length:20000},(_,i)=>({id:i,value:'row '+i,enabled:i%2===0}));
            let checksum=0;
            for(let i=0;i<10;i++) checksum+=JSON.parse(JSON.stringify(input)).filter(row=>row.enabled).reduce((sum,row)=>sum+row.id,0);
            assert(checksum===999900000,'JS checksum');metrics.operations=200000;break;
        }
        case 'storage':
            for(let i=0;i<500;i++) localStorage.setItem('perf-'+i,'x'.repeat(1024));
            for(let i=0;i<500;i++) assert(localStorage.getItem('perf-'+i).length===1024,'storage value');
            for(let i=0;i<500;i++) localStorage.removeItem('perf-'+i);
            assert(localStorage.getItem('perf-0')===null,'storage cleanup');metrics.operations=1500;break;
        case 'shadow-dom': {
            const hosts=[];
            for(let i=0;i<200;i++) {
                const host=document.createElement('div');document.querySelector('#work').append(host);
                host.attachShadow({mode:'open'}).innerHTML='<style>span{display:block}</style><span>Shadow</span>';hosts.push(host);
            }
            assert(hosts.every(host=>host.shadowRoot.querySelector('span').getBoundingClientRect().height>0),'shadow layout');
            metrics.operations=hosts.length;break;
        }
        case 'iframe': {
            const frames=Array.from({length:8},()=>document.createElement('iframe'));
            await Promise.all(frames.map((frame,i)=>new Promise((resolve,reject)=>{
                frame.onload=resolve;frame.onerror=()=>reject(Error('frame load'));
                frame.src='/page?count=200&token='+config.token+'-frame-'+i;document.querySelector('#work').append(frame);
            })));
            assert(frames.every(frame=>frame.contentDocument.querySelectorAll('.card').length===200),'iframe DOM');
            metrics.frames=frames.length;break;
        }
        case 'worker': {
            const url=URL.createObjectURL(new Blob(['onmessage=e=>postMessage(e.data.map(x=>x*2))'],{type:'text/javascript'}));
            const worker=new Worker(url);
            try {
                const result=await new Promise((resolve,reject)=>{worker.onmessage=e=>resolve(e.data);worker.onerror=()=>reject(Error('worker error'));worker.postMessage(Array.from({length:10000},(_,i)=>i));});
                assert(result.length===10000&&result[9999]===19998,'worker data');metrics.operations=10000;
            } finally {worker.terminate();URL.revokeObjectURL(url);}
            break;
        }
        case 'idle':
            await pause(1500);assert(cards.length===count,'idle DOM');break;
        case 'history':
            for(let i=0;i<100;i++) history.replaceState({i},'', '?route='+i);
            assert(history.state.i===99&&location.search==='?route=99','history updates');metrics.operations=100;break;
        default: throw Error('Unknown workload '+config.workload);
        }
        metrics.elapsedMs=performance.now()-started;
        // Let pending work and the heartbeat run before reading final state.
        await pause(40);
        if(config.mode==='procedural'||config.mode==='cosmetic') assert(cards.every(n=>getComputedStyle(n).display==='none'),'filter lost matches');
        metrics.heartbeatP95Ms=quantile(gaps,.95);metrics.heartbeatMaxMs=Math.max(0,...gaps);metrics.heartbeatSamples=gaps.length;
        assert(gaps.length>0,'heartbeat absent');
        return {ok:true,metrics};
    } finally {clearInterval(heartbeat);}
};
