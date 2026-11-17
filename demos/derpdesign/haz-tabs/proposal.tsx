import {mountSplitDemo} from '../split-demo';
import type {ShellController} from '@bird/browser/controller';
import type {createBirdFixture} from '../fixture';
import {mountBrowserChrome} from '@bird/ui/design/chrome';
import {mountBrowserPages} from '@bird/ui/design/BrowserPages';
import {splitArticles} from './split-pages';
import './articles.css';

/** Scenarios supply native page data; all browser visuals come from product UI. */
export function mountProposal(controller:ShellController,conditions:Record<string,unknown>,fixture:ReturnType<typeof createBirdFixture>){
 const stopChrome=mountBrowserChrome(controller);
 const stopPages=conditions.hazSplit?mountSplitDemo(controller,conditions,fixture,splitArticles):mountBrowserPages(controller,{initialPage:conditions.hazModal?'workspaces':conditions.hazSettings?'appearance':'start',initialModal:conditions.hazModal===true,standalone:conditions.hazStandalone===true});
 return()=>{stopPages();stopChrome();};
}
