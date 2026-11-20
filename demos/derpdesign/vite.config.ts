import {studyDocument} from './settings-study/document';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const source=resolve(import.meta.dirname,'../..');
const require=createRequire(resolve(source,'package.json'));
const {effectweb}=await import(resolve(source,'node_modules/@effectweb/compiler/dist/vite.js'));
const {default:tailwindcss}=await import(require.resolve('@tailwindcss/vite'));
export default {root:import.meta.dirname,plugins:[studyDocument(source),{name:'derpdesign-project-document',transformIndexHtml:{order:'pre',async handler(){
// Use the real document shell, including theme classes and data attributes.
const html=await readFile(resolve(source,'index.html'),'utf8');
if(!html.includes('src="/src/main.tsx"'))throw Error('DerpBird entry changed; update the external harness document adapter');
return html.replace('src="/src/main.tsx"','src="/main.ts"').replace('</body>','<div id="style-manager-host"></div></body>');
}}},effectweb(),tailwindcss()],optimizeDeps:{noDiscovery:true,include:['usercss-meta']},resolve:{alias:[{find:'@bird',replacement:resolve(source,'src')},{find:/^(effectweb|effect|@effectweb\/[^/]+)(.*)$/,replacement:'$1$2',customResolver:function(id:string){return this.resolve(id,resolve(source,'src/main.ts'),{skipSelf:true})}}]},server:{host:'127.0.0.1',port:47921,strictPort:true,fs:{allow:[source,resolve(import.meta.dirname,'../..')]}}};
