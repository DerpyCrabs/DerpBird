import {test,expect} from 'bun:test';
import {createBirdFixture} from './fixture';
import {resolve} from 'node:path';
const source=process.env.DERPBIRD_SOURCE_ROOT??resolve(import.meta.dir,'../..');
const {canDropTab}=await import(resolve(source,'src/browser/tab-tree.ts'));
const {decodeSnapshot}=await import(resolve(source,'src/browser/protocol.ts'));

test('group, reorder, ungroup, close and reopen preserve valid native snapshots',async()=>{
 const f=createBirdFixture('vertical',canDropTab);
 const send=async(c:any)=>{await f.port.request(c);return decodeSnapshot(f.snapshot());};
 let s=await send({type:'tab.tree-move',tabId:'release',targetId:'research',placement:'inside'});expect(s.tabs.map((t:any)=>t.id)).toEqual(['research','release','accessibility']);expect(s.tabs[1].parentId).toBe('research');
 s=await send({type:'tab.tree-move',tabId:'research',targetId:'accessibility',placement:'after'});expect(s.tabs.map((t:any)=>t.id)).toEqual(['accessibility','research','release']);
 s=await send({type:'tab.new-child',tabId:'release'});expect(s.tabs.at(-1).parentId).toBe('research');
 s=await send({type:'tab.ungroup',tabId:'release'});expect(s.tabs.at(-1).id).toBe('release');expect(s.tabs.at(-1).parentId).toBeUndefined();
 await send({type:'tab.close-group',tabId:'research'});s=await send({type:'tab.reopen'});expect(s.tabs.some((t:any)=>t.parentId==='research')).toBe(true);
 await send({type:'tab.pin',tabId:'research',value:true});
 await send({type:'tab.close-others',tabId:'release'});s=await send({type:'tab.close',tabId:'release'});expect(s.activeTabId).toBe('research');
 await send({type:'tab.close',tabId:'research'});expect(f.snapshot().activeTabId).toBeNull();
});
test('unsupported commands fail without claiming a new revision',async()=>{
 const f=createBirdFixture('horizontal',canDropTab),before=f.snapshot();
 await expect(f.port.request({type:'window.new',private:false})).rejects.toThrow('does not implement window.new');expect(f.snapshot()).toEqual(before);
});
test('subscribers receive isolated snapshots and unsubscribe cleanly',async()=>{
 const f=createBirdFixture('vertical',canDropTab);let calls=0;const off=f.port.subscribe((s:any)=>{calls++;s.tabs.length=0;});
 await f.port.request({type:'tab.mute',tabId:'research',value:true});expect(f.snapshot().tabs).toHaveLength(3);off();await f.port.request({type:'tab.close',tabId:'research'});expect(calls).toBe(1);
});

test('split state drives direction, ratio, children and closing either member',async()=>{
 for(const closeId of ['research','accessibility']){
  const f=createBirdFixture('horizontal',canDropTab);
  const send=async(c:any)=>{await f.port.request(c);return decodeSnapshot(f.snapshot());};
  let s=await send({type:'tab.split',tabId:'accessibility',targetId:'research',edge:'right'});
  expect(s.splits).toHaveLength(1);expect(s.splits[0].axis).toBe('horizontal');
  s=await send({type:'split.switch',tabId:'accessibility'});expect(s.splits[0].axis).toBe('vertical');
  s=await send({type:'split.resize',tabId:'research',ratio:.65});expect(s.splits[0].ratio).toBe(.65);
  s=await send({type:'tab.new-child',tabId:'accessibility'});expect(s.tabs.find((t:any)=>t.id===s.activeTabId).parentId).toBe('research');
  s=await send({type:'tab.close',tabId:closeId});expect(s.splits).toHaveLength(0);
  expect(s.tabs.some((t:any)=>t.id===(closeId==='research'?'accessibility':'research'))).toBe(true);
 }
});

test('workspace switching preserves pins and active tab; reopen follows native window history', async()=>{
 const f=createBirdFixture('vertical',canDropTab);f.enableWorkspaces();
 await f.port.request({type:'tab.pin',tabId:'research',value:true});
 await f.port.request({type:'tab.activate',tabId:'board'});
 await f.port.request({type:'tab.close',tabId:'release'});
 f.switchWorkspace('personal-space');
 expect(f.snapshot().tabs.map(t=>t.id)).toEqual(['reading','weekend']);
 await f.port.request({type:'tab.reopen'});expect(f.snapshot().tabs.some(t=>t.id==='release')).toBe(true);
 f.switchWorkspace('research-space');expect(f.snapshot().activeTabId).toBe('board');
 expect(f.snapshot().tabs.find(t=>t.id==='research')?.pinned).toBe(true);
 await f.port.request({type:'tab.reopen'});expect(f.snapshot().tabs.some(t=>t.id==='release')).toBe(false);
 f.createWorkspace('Fresh');expect(f.snapshot().tabs).toHaveLength(1);
 await f.port.request({type:'tab.create',url:'about:blank',private:false});expect(f.snapshot().tabs).toHaveLength(2);
 f.switchWorkspace('personal-space');expect(f.snapshot().activeTabId).toBe('release');
});

test('Default-only workspace snapshots stay valid and creation retains original tabs',()=>{
 const f=createBirdFixture('vertical',canDropTab);f.enableWorkspaces(true);
 expect(f.workspaces().items.map(w=>w.name)).toEqual(['Default']);
 expect(decodeSnapshot(f.snapshot()).tabs).toHaveLength(6);
 f.createWorkspace('Project','code','lilac');
 expect(f.workspaces().items).toHaveLength(2);
 expect(decodeSnapshot(f.snapshot()).tabs).toHaveLength(1);
 f.switchWorkspace('research-space');
 expect(decodeSnapshot(f.snapshot()).tabs).toHaveLength(6);
});


test('split fixtures follow native detachment, regrouping and surviving-page selection',async()=>{
 for(const edge of ['left','right','top','bottom']){
  const f=createBirdFixture('vertical',canDropTab);f.enableWorkspaces();f.seedReadingTabs(['First child','Second child']);
  const send=async(c:any)=>{await f.port.request(c);return decodeSnapshot(f.snapshot());};
  await send({type:'tab.tree-move',tabId:'reading-1',targetId:'research',placement:'inside'});
  await send({type:'tab.tree-move',tabId:'reading-2',targetId:'accessibility',placement:'inside'});
  let s=await send({type:'tab.split',tabId:'accessibility',targetId:'research',edge});
  expect(s.tabs.slice(0,3).every((t:any)=>t.pinned)).toBe(true);
  const first=s.splits[0].firstTabId,second=s.splits[0].secondTabId;
  expect(s.tabs.filter((t:any)=>t.id.startsWith('reading-')).every((t:any)=>!t.parentId)).toBe(true);
  for(const tabId of ['reading-1','reading-2'])s=await send({type:'tab.tree-move',tabId,targetId:second,placement:'inside'});
  expect(s.tabs.filter((t:any)=>t.id.startsWith('reading-')).map((t:any)=>t.parentId)).toEqual([first,first]);
  await send({type:'tab.activate',tabId:second});
  s=await send({type:'tab.close',tabId:second});expect(s.activeTabId).toBe(first);
  s=await send({type:'tab.reopen'});expect(s.tabs.filter((t:any)=>t.id.startsWith('reading-'))).toHaveLength(2);
 }
});


test('detaching a child never inserts it inside the following group',async()=>{
 const f=createBirdFixture('vertical',canDropTab);f.seedReadingTabs(['One','Two','Three']);
 for(const [tabId,targetId] of [['reading-1','research'],['reading-2','research'],['reading-3','accessibility']])await f.port.request({type:'tab.tree-move',tabId,targetId,placement:'inside'});
 for(const tabId of ['reading-2','reading-1']){
  await f.port.request({type:'tab.ungroup',tabId});
  const s=decodeSnapshot(f.snapshot());expect(s.tabs.find((t:any)=>t.id===tabId)?.parentId).toBeUndefined();
  expect(s.tabs.find((t:any)=>t.id==='reading-3')?.parentId).toBe('accessibility');
 }
});

test('appearance changes survive subsequent native-shaped snapshot updates', async () => {
 const f=createBirdFixture('vertical',canDropTab);
 await f.port.request({type:'shell.set-appearance',theme:'light',alwaysClose:false});
 await f.port.request({type:'tab.activate',tabId:'accessibility'});
 const s=decodeSnapshot(f.snapshot());
 expect(s.preferences.theme).toBe('light');expect(s.preferences.alwaysClose).toBe(false);
});
