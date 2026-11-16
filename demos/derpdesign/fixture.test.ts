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
