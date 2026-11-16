import type { ShellController } from '@bird/browser/controller';
import { layoutFromSettings, layoutToSettings } from '@bird/browser/chrome-layout';
import settingsHTML from '@bird/../vendor/ladybird/Base/res/ladybird/about-pages/settings.html?raw';
import settingsURL from '@bird/../vendor/ladybird/Base/res/ladybird/about-pages/settings.html?url';
import pageCSS from '@bird/../vendor/ladybird/Base/res/ladybird/ladybird.css?raw';
import settingsEntry from '@bird/settings-layout.tsx?url';

/** Only the native WebUI transport is substituted; Settings renders the shipped entry. */
export function mountLayoutSettings(surface: Element, controller: ShellController) {
 const frame = document.createElement('iframe');
 frame.title = 'Settings';
 frame.style.cssText = 'width:100%;height:100%;border:0;display:block;';
 const resourceRoot = settingsURL.slice(0, settingsURL.indexOf('/ladybird/about-pages/')) + '/';
 let resolveReady!:()=>void;
 const ready=new Promise<void>(resolve=>{resolveReady=resolve;});
 const publish=()=>frame.contentDocument?.dispatchEvent(new CustomEvent('WebUIMessage',{detail:{name:'loadSettings',data:{tabs:layoutToSettings(controller.state().chromeLayout!),content:{defaultZoomLevelFactor:1,enableForceDark:false},appearance:{interfaceTheme:'dark',websiteColorScheme:'system',colorTheme:'neutral'}}}}));
 frame.addEventListener('load',()=>{
  (frame.contentWindow as any).ladybird={sendMessage(name:string,value:any){
   if(name==='setTabSettings'){controller.setChromeLayout(layoutFromSettings(value));return;}
   if(name==='loadCurrentSettings'){publish();return;}
   if(name==='loadFeatures'){frame.contentDocument!.dispatchEvent(new CustomEvent('WebUIMessage',{detail:{name:'loadFeatures',data:{verticalTabs:true,menuBar:false}}}));return;}
   throw Error('Native settings command outside layout demo: '+name);
  }};
  publish();
  frame.contentDocument!.dispatchEvent(new Event('WebUILoaded'));
  requestAnimationFrame(()=>{frame.contentDocument!.querySelector('#tab-layout-group')!.scrollIntoView({block:'center'});resolveReady();});
 });
 const themedCSS=pageCSS.replaceAll('@media (prefers-color-scheme: dark)', '@media all').replaceAll('@media (prefers-color-scheme: light)', '@media not all');
 frame.srcdoc = settingsHTML.replace('<link rel="stylesheet" type="text/css" href="resource://ladybird/ladybird.css" />', `<style>${themedCSS}</style>`).replace('resource://ladybird/about-pages/derpbird-assets/settings-layout.js',settingsEntry).replaceAll('resource://', resourceRoot);
 surface.append(frame);
 return {frame,ready,publish,dispose(){frame.remove();}};
}
