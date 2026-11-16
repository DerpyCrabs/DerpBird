import type { DevToolsPort, RequestRecord } from '@bird/devtools/model';
export function devToolsFixture(large = false): DevToolsPort {
 const names=['projects?limit=50','workspace','app.js','styles.css','Inter.woff2','avatar.svg','session','notifications','preferences','activity?page=1','search?q=design','events'];
 const requests: RequestRecord[]=Array.from({length:large?10000:48},(_,i)=>{
   const name=names[i%names.length]!, type=i%12===2?'JS':i%12===3?'CSS':i%12===4?'Font':i%12===5?'Img':'Fetch/XHR';
   return {id:String(i),url:`https://workspace.local/${type==='Fetch/XHR'?'api/':''}${name}${i>=12?`${name.includes('?')?'&':'?'}batch=${Math.floor(i/12)}`:''}`,method:i%12===11?'POST':'GET',status:i%12===10?404:200,type,bytes:i===0?18342:650+(i*791)%41000,start:i<12?i*37:440+(i%29)*19,duration:35+(i*41)%370,initiator:i%12===2?'index.html:12':'client.js:48',headers:{'content-type':type==='Fetch/XHR'?'application/json; charset=utf-8':type==='JS'?'text/javascript':'text/plain','cache-control':'no-cache','x-request-id':`req_${String(i+1).padStart(5,'0')}`},requestHeaders:{accept:'application/json',':authority':'workspace.local'},payload:i%12===11?'{"event":"workspace.opened","project":"derpbird"}':undefined};
 });
 const projectData={data:{projects:Array.from({length:large?12000:6},(_,i)=>({id:`project_${String(i+1).padStart(3,'0')}`,name:['DerpBird','EffectWeb','DerpDesign','AluminOS','LocalChat','Ecosystem'][i%6],status:'active',owner:{name:'Alex Morgan',email:'alex@workspace.local'},settings:{theme:'dark',preview:{engine:'ladybird',searchEnabled:true}},updatedAt:'2026-11-15T09:42:00Z'})),pagination:{page:1,total:large?12000:6,hasMore:false}},meta:{requestId:'req_00001',duration:35}};
 const sources=[{name:'client.js',text:`import { createClient } from './transport.js';\n\nconst client = createClient({\n  baseURL: '/api',\n  timeout: 10_000,\n});\n\nexport async function loadProjects() {\n  const response = await client.get('/projects', {\n    limit: 50,\n  });\n\n  if (!response.ok) {\n    throw new Error('Unable to load projects');\n  }\n\n  const { data } = await response.json();\n  return data.projects;\n}\n\nexport function openProject(project) {\n  document.title = project.name;\n  history.pushState({}, '', '/projects/' + project.id);\n}\n`},{name:'styles.css',text:':root {\n  color-scheme: dark;\n  --background: #202224;\n  --accent: #9cbaad;\n}\n\n.workspace {\n  display: grid;\n  grid-template-columns: 220px 1fr;\n  min-height: 100vh;\n}\n\n.project-card {\n  padding: 16px;\n  border: 1px solid #383c40;\n}'},{name:'index.html',text:'<!doctype html>\n<html lang="en">\n  <head>\n    <title>Workspace</title>\n    <link rel="stylesheet" href="/styles.css">\n  </head>\n  <body>\n    <main class="workspace">\n      <nav class="sidebar">Projects</nav>\n      <section class="project-list"></section>\n    </main>\n    <script type="module" src="/client.js"></script>\n  </body>\n</html>'}];
 return {requests,sources,elements:[
  {id:'html',depth:0,text:'▾ <html lang="en">',styles:{'color-scheme':'dark','font-family':'Inter, sans-serif'}},
  {id:'head',depth:1,text:'▸ <head>…</head>',styles:{display:'none'}},
  {id:'body',depth:1,text:'▾ <body>',styles:{margin:'0',background:'#202224'}},
  {id:'main',depth:2,text:'▾ <main class="workspace">',styles:{display:'grid','grid-template-columns':'220px 1fr','min-height':'100vh'}},
  {id:'nav',depth:3,text:'<nav class="sidebar">Projects</nav>',styles:{padding:'16px',width:'220px'}},
  {id:'section',depth:3,text:'▾ <section class="project-list">',styles:{display:'grid',gap:'12px',padding:'24px'}},
  {id:'article',depth:4,text:'<article class="project-card">DerpBird</article>',styles:{padding:'16px',border:'1px solid #383c40','border-radius':'6px'}},
  {id:'section-end',depth:3,text:'</section>',styles:{}},{id:'main-end',depth:2,text:'</main>',styles:{}},{id:'body-end',depth:1,text:'</body>',styles:{}},{id:'html-end',depth:0,text:'</html>',styles:{}}
 ],messages:[{level:'info',text:'Workspace connected',source:'client.js:6'},{level:'info',text:'Loaded 6 projects in 35 ms',source:'client.js:18'},{level:'warning',text:'Font fallback used while Inter.woff2 was loading.',source:'styles.css:2'},{level:'error',text:'GET /api/search?q=design 404 (Not Found)',source:'client.js:48'}],
 async response(id){const r=requests.find(r=>r.id===id)!;if(id==='0')return JSON.stringify(projectData,null,2);if(r.type==='JS')return sources[0]!.text;if(r.type==='CSS')return sources[1]!.text;return JSON.stringify(r.status===404?{error:{code:'NOT_FOUND',message:'Search endpoint not found'}}:{data:{id:r.id,name:r.url.split('/').pop(),enabled:true},meta:{requestId:r.headers['x-request-id']}},null,2);},
 async evaluate(expression){const values:Record<string,string>={'document.title':'"Workspace"','location.href':'"https://workspace.local/projects"','1 + 1':'2','1+1':'2','Object.keys(window)':'["document", "location", "history", "navigator"]'};if(expression in values)return values[expression]!;throw Error('Expression unavailable in the design fixture. Try document.title, location.href, or 1 + 1.');}
 };
}

/** Mock only the native boundary; use the shipping decoder and live UI subscription. */
export function devToolsTransport(large=false, controls?: {dock(position:string):void;dismiss():void;pick(done:()=>void):void}) {
 let dock="right", picking=false;
 const fixture=devToolsFixture(large);
 const listeners=new Set<(value:unknown)=>void>();
 const emit=(value:unknown)=>{for(const listener of listeners)listener(value);};
 const root:any={id:1,type:'document',name:'#document',children:[]};
 const stack:any[]=[root];
 fixture.elements.forEach((element,index)=>{
   if(element.text.startsWith('</'))return;
   const match=element.text.match(/<([\w-]+)(?: class="([^"]+)")?/);
   const node:any={id:index+2,type:'element',name:match?.[1]??'html',attributes:match?.[2]?{class:match[2]}:{},children:[]};
   const depth=Math.min(element.depth+1,stack.length);stack[depth-1].children.push(node);stack[depth]=node;stack.length=depth+1;
 });
 let requests=fixture.requests.map(r=>({...r,complete:true}));
 const sources=fixture.sources.map((s,i)=>({...s,id:String(i)}));
 return {
  onDevTools(listener:(value:unknown)=>void){listeners.add(listener);return()=>listeners.delete(listener);},
  async devtoolsRequest(payload:Record<string,unknown>):Promise<unknown>{
   switch(payload.type){
    case 'devtools.dock':if(!controls)throw Error('Dock controls unavailable');dock=String(payload.position);controls.dock(dock);emit({dock});return null;
    case 'devtools.dismiss':if(!controls)throw Error('Close unavailable');controls.dismiss();return null;
    case 'devtools.pick':if(!controls)throw Error('Picker unavailable');picking=!picking;emit({picking});controls.pick(()=>{picking=false;emit({revealElement:true,picking,nodeId:'5',styles:fixture.elements[3]?.styles??{}});});return null;
    case 'devtools.bootstrap':return {...(controls?{dock,picking}:{}),requests,dom:root,sources,messages:fixture.messages,nodeId:'5',styles:fixture.elements[3]?.styles??{}};
    case 'devtools.response':{
     const request=requests.find(r=>r.id===String(payload.id));
     if(request?.type==='Img'){
       const svg='<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" rx="20" fill="#34473f"/><circle cx="120" cy="60" r="30" fill="#9cbaad"/><path d="M60 145a60 60 0 01120 0" fill="#9cbaad"/></svg>';
       return {encoding:'base64',mimeType:'image/svg+xml',data:btoa(svg),bytes:svg.length};
     }
     return fixture.response(String(payload.id));
    }
    case 'devtools.evaluate':return fixture.evaluate(String(payload.expression));
    case 'devtools.source':{const source=sources.find(s=>s.id===payload.id);if(!source)throw Error('Unknown source');return source.text;}
    case 'devtools.select':emit({revealElement:true,nodeId:payload.id,styles:fixture.elements[Number(payload.id)-2]?.styles??{}});return null;
    case 'devtools.refresh':emit({dom:root});return null;
    case 'devtools.clear':requests=[];return null;
    default:throw Error(`Unsupported developer tools command: ${payload.type}`);
   }
  }
 };
}
