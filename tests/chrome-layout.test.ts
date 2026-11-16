import {expect,test} from 'bun:test';
import {decodeChromeLayout,layoutFromSettings,layoutToSettings,verticalLayout,type ChromeLayout} from '../src/browser/chrome-layout';
import {createController} from '../src/browser/controller';
import {decodeSnapshot,type NativePort,type Command} from '../src/browser/protocol';
import {paletteItems} from '../src/browser/address-palette';
const tab=(id:string,privateTab=false)=>({id,url:`https://${id}.test/`,title:id,private:privateTab,loading:false,canGoBack:false,canGoForward:false,pinned:false,audible:false,muted:false});
const arrangements:ChromeLayout[]=[{preset:'classic',side:'left',address:'top'},{preset:'bottom',side:'left',address:'bottom'},...(['left','right'] as const).flatMap(side=>[{preset:'compact',side,address:'top'} as ChromeLayout,...(['top','bottom'] as const).map(address=>({preset:'sidebar',side,address} as ChromeLayout))])];
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
function fixture(layout:ChromeLayout=arrangements[0]!) {
 let revision=0, listener:((value:unknown)=>void)|undefined;
 let chromeLayout=layout;
 const commands:Command[]=[];
 const snapshot=()=>({version:1,revision:++revision,preferences:{layout:verticalLayout(chromeLayout)?'vertical':'horizontal',chromeLayout},tabs:[tab('a'),{...tab('b'),parentId:'a'},tab('private',true)],activeTabId:'a'});
 const port:NativePort={version:1,snapshot:async()=>snapshot(),subscribe:cb=>{listener=cb;return()=>{listener=undefined}},request:async c=>{commands.push(c)}};
 return {port,commands,snapshot,emit:(patch:any={})=>listener?.({...snapshot(),...patch}),setLayout:(layout:ChromeLayout)=>{chromeLayout=layout;listener?.(snapshot())}};
}
for(const layout of arrangements) test(`saved ${layout.preset}/${layout.side}/${layout.address} restores atomically and retains groups`,async()=>{
 expect(layoutFromSettings(layoutToSettings(layout))).toEqual(layout);
 const f=fixture(),c=createController(f.port);await c.ready;
 const tabs=c.state().browser.tabs;
 c.setChromeLayout(layout);await tick();
 expect(f.commands.at(-1)).toEqual({type:'shell.set-chrome-layout',layout});
 expect(c.state().chromeLayout).toEqual(arrangements[0]);
 f.setLayout(layout);
 expect(c.state().chromeLayout).toEqual(layout);
 expect(c.state().layout).toBe(verticalLayout(layout)?'vertical':'horizontal');
 expect(c.state().browser.tabs[0]).toBe(tabs[0]);
 await c.close();
 const restored=createController({...f.port,snapshot:async()=>({...f.snapshot(),preferences:{layout:verticalLayout(layout)?'vertical':'horizontal',chromeLayout:layout}})});await restored.ready;
 expect(restored.state().chromeLayout).toEqual(layout);await restored.close();
});
test('legacy tab settings migrate without losing side or compact mode',()=>{
 expect(layoutFromSettings({})).toEqual(arrangements[0]);
 expect(layoutFromSettings({verticalTabsEnabled:true,everythingInSidebar:true,verticalTabsPosition:'right'})).toEqual({preset:'compact',side:'right',address:'top'});
 for(const malformed of [null,{}, {preset:'sidebar',side:'middle',address:'top'}, {preset:'other',side:'left',address:'top'}])expect(()=>decodeChromeLayout(malformed)).toThrow();
 const f=fixture();expect(()=>decodeSnapshot({...f.snapshot(),preferences:{layout:'vertical',chromeLayout:{preset:'sidebar'}}})).toThrow();
});
test('palette keeps query and selection through native refreshes; ignores stale responses and closes on layout change',async()=>{
 const f=fixture({preset:'compact',side:'left',address:'top'}),c=createController(f.port);await c.ready;
 c.openAddressPalette();expect(c.state().addressInput).toBe('https://a.test/');
 expect(paletteItems(c.state()).map(i=>i.id)).toEqual(['b']);
 c.editAddress('b');const query=c.state().addressQuery;
 f.emit({addressSuggestions:{query,items:[{title:'Bookmark',text:'https://b.test/bookmark',source:'bookmark'}]}});
 c.selectPaletteItem(1);expect(c.state().addressSelection).toBe(0);
 f.emit();expect(c.state().addressSelection).toBe(0);expect(c.state().addressInput).toBe('b');
 c.editAddress('new');f.emit({addressSuggestions:{query,items:[{title:'Stale',text:'https://stale.test/'}]}});
 expect(paletteItems(c.state()).some(i=>i.title==='Stale')).toBe(false);
 f.setLayout({preset:'sidebar',side:'right',address:'bottom'});
 expect(c.state().addressPaletteOpen).toBe(false);expect(c.state().addressInput).toBeNull();await c.close();
});
test('palette switch, navigation, Escape and late replies never reopen it',async()=>{
 const f=fixture({preset:'compact',side:'left',address:'top'}),c=createController(f.port);await c.ready;
 c.openAddressPalette();c.selectPaletteItem(1);c.choosePaletteItem(c.state().addressSelection);await tick();
 expect(f.commands.at(-1)).toEqual({type:'tab.activate',tabId:'b'});expect(c.state().addressPaletteOpen).toBe(false);
 c.openAddressPalette();c.editAddress('example.org');c.choosePaletteItem(-1);await tick();
 expect(f.commands.at(-1)).toEqual({type:'tab.navigate-input',tabId:'a',url:'example.org'});expect(c.state().addressPaletteOpen).toBe(false);
 c.openAddressPalette();c.editAddress('test');const query=c.state().addressQuery;c.dismissAddress();f.emit({addressSuggestions:{query,items:[{title:'Late',text:'https://late.test'}]}});
 expect(c.state().addressPaletteOpen).toBe(false);expect(c.state().addressSuggestionsOpen).toBe(false);await c.close();
});
