import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { useTestProfile } from './agent-test-profile';
import { AgentSessions } from '../src/automation/sessions';
import { AgentBrowser } from '../src/automation/browser';
import { NativeConnection } from '../src/automation/connection';
const profile = await useTestProfile();
const focus = () => { if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) return undefined; try { return JSON.parse(execFileSync('hyprctl', ['activewindow', '-j'], { encoding:'utf8' })).address; } catch { return undefined; } };
const beforeFocus = focus();
const fixture = Bun.serve({ port:0, fetch:()=>new Response('<title>Shared profile fixture</title><h1>Shared profile fixture</h1>',{headers:{'Content-Type':'text/html'}}) });
// Start a normal user-like window. Only the test process class routes it away from the user's desktop.
const env = {...process.env, DERPBIRD_AGENT:'1'};
if(process.env.SHARED_TEST_NORMAL_OWNER) delete env.DERPBIRD_AGENT;
delete env.DERPBIRD_AGENT_WINDOW; delete env.DERPBIRD_AUTOMATION_SOCKET;
const child = Bun.spawn(process.env.DERPBIRD_EXECUTABLE ? [process.env.DERPBIRD_EXECUTABLE, 'about:blank'] : ['python3','scripts/run.py','about:blank'], {env,stdout:'ignore',stderr:'ignore'});
const sessions = new AgentSessions();
let owner: AgentBrowser | undefined;
try {
  const deadline=Date.now()+30000;
  while(!owner) {
    const found=(await sessions.discover()).find((entry:any)=>entry.windows.some((w:any)=>w.profile===`${profile}/data`));
    if(found) owner=new AgentBrowser(await NativeConnection.connect(found.socket));
    else {assert(Date.now()<deadline,'User fixture startup');await Bun.sleep(100)}
  }
  await owner.select(0); await owner.navigate(fixture.url.href);
  await owner.evaluate('()=>{localStorage.shared="user";document.cookie="shared=user; path=/";return true}');
  const original=await owner.tabs();
  await sessions.launch(); const first=sessions.list().find(s=>s.selected)!;
  const firstWindow=sessions.browser.windowId;
  assert.notEqual(firstWindow,owner.windowId);
  await sessions.browser.navigate(fixture.url.href);
  assert.equal(await sessions.browser.evaluate('()=>localStorage.shared'),'user');
  assert.match(await sessions.browser.evaluate('()=>document.cookie'),/shared=user/);
  await sessions.browser.evaluate('()=>{localStorage.shared="agent";document.cookie="shared=agent; path=/";return true}');
  assert.equal(await owner.evaluate('()=>localStorage.shared'),'agent');
  assert.match(await owner.evaluate('()=>document.cookie'),/shared=agent/);
  assert.deepEqual((await owner.tabs()).filter(t=>t.windowId===owner!.windowId),original,'User tabs remain unchanged');
  await sessions.launch();
  assert.notEqual(sessions.browser.windowId,firstWindow);
  await sessions.browser.navigate(fixture.url.href);
  assert.equal(await sessions.browser.evaluate('()=>localStorage.shared'),'agent');
  const windows=await sessions.browser.windows();
  let desktopWindows:any[]=[];
  try {
    if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) throw new Error('Not on Hyprland');
    desktopWindows=JSON.parse(execFileSync('hyprctl',['clients','-j'],{encoding:'utf8'})).filter((w:any)=>w.pid===child.pid);
    assert.equal(desktopWindows.length,3);
    assert(desktopWindows.every((w:any)=>w.class==='org.derpbird.Agent' && w.workspace.id===5));
    assert(desktopWindows.every((w:any)=>!w.title.startsWith('[Agent]')),'No title-based routing');
  } catch(error) { if(process.env.HYPRLAND_INSTANCE_SIGNATURE) throw error; }

  if(process.env.SWAYSOCK) {
    const tree=JSON.parse(execFileSync('/tmp/derpbird-test-compositor/usr/bin/swaymsg',['-t','get_tree','-r'],{encoding:'utf8',env:{...process.env,LD_LIBRARY_PATH:'/tmp/derpbird-test-compositor/usr/lib'}}));
    const flatten=(node:any):any[]=>[node,...(node.nodes??[]).flatMap(flatten),...(node.floating_nodes??[]).flatMap(flatten)];
    desktopWindows=flatten(tree).filter((w:any)=>w.pid===child.pid&&w.app_id);
    assert.equal(desktopWindows.filter((w:any)=>w.app_id==='org.derpbird.Agent').length,2);
    assert.equal(desktopWindows.filter((w:any)=>w.app_id==='org.ladybird.Ladybird').length,1);
  }
  assert.equal(windows.length,3); assert.equal(windows.filter(w=>w.agentId).length,2);
  assert(windows.every(w=>w.profile===`${profile}/data`&&!w.private));
  const renderDeadline=Date.now()+15000;
  while(!(await sessions.browser.evaluate('()=>innerWidth>300&&innerHeight>200'))) {
    assert(Date.now()<renderDeadline,'Agent viewport layout'); await Bun.sleep(100);
  }
  await sessions.browser.screenshot();
  const png=await sessions.browser.windowScreenshot();
  await Bun.write('artifacts/shared-profile-window.png',Buffer.from(png.data,'base64'));
  await sessions.close(); sessions.select(first.id); await sessions.close();
  for(let i=0;i<50&&(await owner.windows()).length!==1;i++) await Bun.sleep(100);
  assert.equal((await owner.windows()).length,1);
  assert.equal(await owner.evaluate('()=>document.title'),'Shared profile fixture');
  assert.equal(focus(),beforeFocus,'Agent launch and cleanup preserve focus');
  await Bun.write('artifacts/shared-profile-report.json',JSON.stringify({passed:true,sharedCookie:true,sharedLocalStorage:true,distinctWindows:true,userTabsPreserved:true,closePreservesUserWindow:true,focusPreserved:true,desktopWindows:desktopWindows.map((w:any)=>({class:w.class,initialClass:w.initialClass,workspace:w.workspace?.id,app_id:w.app_id})),windows:windows.map(w=>({windowId:w.windowId,agentId:w.agentId,profile:w.profile}))},null,2));
  console.log('PASS: live cookies/storage shared; separate agent windows; user tabs, window and focus preserved');
} finally {await sessions.closeAll();owner?.close();child.kill();await child.exited;fixture.stop()}
