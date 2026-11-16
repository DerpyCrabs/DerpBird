import {decodeProxySnapshot, domainRulesKey, type ProxyPort, type ProxySnapshot} from '@bird/browser/proxy-protocol';
// Native boundary fixture only. The popup, controls and settings are production UI.
export function createProxyFixture(conditions:any) {
 let state:ProxySnapshot={revision:1,active:'direct',options:{schemaVersion:2,'+Proxy':{name:'Proxy',profileType:'FixedProfile',color:'#6b94c4',fallbackProxy:{scheme:'http',host:'127.0.0.1',port:1080},bypassList:[]},[domainRulesKey]:conditions.proxyState==='off'?{}:{'example.test':'Proxy'}}};
 let failures=[{host:'cdn.example.test',count:4,error:'Connection timed out'},{host:'fonts.example.net',count:2,error:'Connection reset'},{host:'api.example.test',count:1,error:'Connection timed out'}];
 const route=(host:string)=>{
  const selected=(state.options[domainRulesKey] as Record<string,string> | undefined)?.[host]??state.active;
  if(selected==='direct'||selected==='system')return {profile:'direct',proxied:false};
  const profile=state.options['+'+selected] as any;
  if(!profile)throw Error('Unknown fixture proxy profile: '+selected);
  if(profile.profileType!=='FixedProfile')throw Error('Fixture does not evaluate '+profile.profileType);
  return {profile:selected,proxied:true};
 };
 const port:ProxyPort={get:async()=>structuredClone(state),replace:async(next,url)=>{if(url&&url!=='https://example.test/0')throw Error('The active page changed');if(next.revision!==state.revision)throw Error('Proxy settings changed in another window');state={...decodeProxySnapshot(structuredClone(next)),revision:state.revision+1};return structuredClone(state)},site:async(url)=>{if(url!=='https://example.test/0')throw Error('The active page changed');return {url,host:'example.test',...route('example.test'),failures:failures.map(f=>({...f,...route(f.host)}))}}};
 return {port,reload(){failures=failures.filter(f=>!route(f.host).proxied)}};
}
