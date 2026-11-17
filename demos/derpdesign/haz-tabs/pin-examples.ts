import {mount} from 'effectweb';
import {shellView} from '@bird/ui/Shell';
import {createController} from '@bird/browser/controller';
import {canDropTab} from '@bird/browser/tab-tree';
import {createBirdFixture} from '../fixture';
import {observePinLayout} from './pin-layout';
import '@bird/ui/preferences-primitives.css';
import './tabs.css';
import './pin-examples.css';
export async function mountPinExamples(root:HTMLElement){
 document.body.classList.add('haz-proposal','preferences-theme');
 const gallery=document.createElement('main');gallery.className='haz-pin-examples';root.append(gallery);
 const cleanups:Array<()=>void>=[];
 for(let count=1;count<=10;count++){
  const card=document.createElement('section');card.dataset.pinCount=String(count);const title=document.createElement('h2');title.textContent=`${count} ${count===1?'pin':'pins'}`;card.append(title);
  const host=document.createElement('div');card.append(host);gallery.append(card);
  const fixture=createBirdFixture('vertical',canDropTab);fixture.enableWorkspaces(true,count);await fixture.port.request({type:'tab.activate',tabId:'handbook'});
  const controller=createController(fixture.port),ui=mount(host,shellView(controller),controller.source);await controller.ready;
  controller.setChromeLayout({preset:'sidebar',side:'left',address:'top'});
  const stop=observePinLayout(host.querySelector<HTMLElement>('.shell')!);
  cleanups.push(()=>{stop();ui.dispose();void controller.close();fixture.dispose();});
 }
 return()=>{cleanups.forEach(stop=>stop());gallery.remove();document.body.classList.remove('haz-proposal','preferences-theme');};
}
