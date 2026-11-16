/** Native capture regression: run on the configured desktop in a disposable agent profile. */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { AgentSessions } from '../src/automation/sessions';

const out = process.env.AGENT_OUTPUT ?? await mkdtemp(join(process.cwd(), 'artifacts/agent-captures-'));
const sessions = new AgentSessions();
const save = async (name: string, result: { data: string }) => {
  const path = join(out, `${name}.png`);
  await Bun.write(path, Buffer.from(result.data, 'base64'));
  return path;
};
try {
  await sessions.launch();
  const browser = sessions.browser;
  await browser.navigate('data:text/html,<title>Capture regression</title><body></body>');
  const readyDeadline = Date.now() + 15000;
  while (!(await browser.evaluate('() => innerWidth > 300 && innerHeight > 200'))) {
    assert(Date.now() < readyDeadline, 'Browser shell did not finish laying out its viewport');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await browser.evaluate(`() => {
    document.body.innerHTML = '<div id="top">TOP</div><div id="middle">MIDDLE</div><div id="bottom">BOTTOM</div><div id="right">RIGHT</div><div id="fixed">FIXED</div><div id="sticky">STICKY</div><iframe srcdoc="<body style=background:orange>FRAME</body>"></iframe>';
    const style = document.createElement('style');
    style.textContent = 'html,body{margin:0;background:white}body{height:2400px;width:2200px}#top,#middle,#bottom,#right{position:absolute;left:40px;width:300px;height:100px;color:white;font:32px sans-serif}#top{top:0;background:red}#middle{top:1100px;background:green}#bottom{top:2250px;background:blue}#right{top:800px;left:1900px;background:cyan}#fixed{position:fixed;right:0;top:0;background:purple;color:white}#sticky{position:sticky;top:0;margin-top:200px;background:yellow;width:100px}iframe{position:absolute;top:1600px;left:40px;width:300px;height:150px}';
    document.head.append(style);
    window.captureScrollEvents = 0;
    addEventListener('scroll', () => window.captureScrollEvents++);
    scrollTo(500,1000);
  }`);
  await browser.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const readState = '() => ({ x:scrollX, y:scrollY, width:innerWidth, height:innerHeight, events:window.captureScrollEvents, dpr:devicePixelRatio })';
  const before = await browser.evaluate(readState);
  const documentPath = await save('document', await browser.screenshot(true));
  assert.deepEqual(await browser.evaluate(readState), before, 'Capture must not scroll or resize the page');
  const markers = await browser.evaluate(`() => Object.fromEntries(['top','middle','bottom','right'].map(id => {
    const rect = document.getElementById(id).getBoundingClientRect();
    return [id, { x:rect.x + scrollX, y:rect.y + scrollY }];
  }))`);
  await save('viewport', await browser.screenshot());
  // Inspect actual pixels, not just the dimensions of a potentially blank padded bitmap.
  execFileSync('python3', ['-c', `
import json,sys
from PIL import Image
info=json.load(sys.stdin)
im=Image.open(info['path']).convert('RGB')
colors={'top':(255,0,0),'middle':(0,128,0),'bottom':(0,0,255),'right':(0,255,255)}
for key,expected in colors.items():
 p=info['markers'][key]
 point=(round((p['x']+250)*info['dpr']),round((p['y']+70)*info['dpr']))
 assert im.getpixel(point)==expected,(key,point,im.getpixel(point),expected)
point=(round(150*info['dpr']),round(1700*info['dpr']))
assert im.getpixel(point)==(255,165,0),('offscreen iframe',im.getpixel(point))
`], { input: JSON.stringify({ path: documentPath, markers, dpr: before.dpr }) });

  await browser.evaluate(`() => { document.head.querySelector('style').remove(); document.body.innerHTML='<h1>SPLIT A RED</h1>'; document.body.style='margin:0;background:rgb(180,20,30);color:white'; scrollTo(0,0); }`);
  const first = (await browser.tabs()).find(tab => tab.context === browser.context)!;
  await browser.newTab();
  await browser.navigate('data:text/html,<body style="background:rgb(20,30,180);color:white"><h1>SPLIT B BLUE</h1></body>');
  const second = (await browser.tabs()).find(tab => tab.context === browser.context)!;
  await browser.currentShell({ type:'command', command:{ type:'tab.split', tabId:second.id, targetId:first.id, edge:'right' } });
  // Have both page surfaces commit their resized frame before capturing the whole window.
  await browser.screenshot();
  await browser.select((await browser.tabs()).findIndex(tab => tab.id === first.id));
  await browser.screenshot();
  await browser.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const windowPath = await save('window', await browser.windowScreenshot());
  execFileSync('python3', ['-c', `
from collections import Counter
from PIL import Image
import sys
im=Image.open(sys.argv[1]).convert('RGB')
colors=Counter(im.getdata())
for color in [(180,20,30),(20,30,180)]:
 assert colors[color]>10000,(color,colors[color])
` , windowPath]);
  await Bun.write(join(out, 'report.json'), JSON.stringify({ passed:true, before, markers, documentPath, windowPath }, null, 2));
  console.log(out);
} catch (error) {
  console.error(JSON.stringify(sessions.diagnostics()));
  throw error;
} finally {
  await sessions.closeAll();
}
