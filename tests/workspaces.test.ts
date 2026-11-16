import { expect, test } from 'bun:test';
import { decodeWorkspaces } from '../src/browser/workspaces';
import { createController } from '../src/browser/controller';
import { createBirdFixture } from '../demos/derpdesign/fixture';
import { canDropTab } from '../src/browser/tab-tree';
test('workspace snapshots reject invalid identities and selections',()=>{
 const state={active:'one',items:[{id:'one',name:'Work',icon:'code',color:'sage'}]};
 expect(decodeWorkspaces(state)?.active).toBe('one');
 for(const invalid of [{...state,active:'missing'},{...state,items:[...state.items,...state.items]},{...state,items:[{...state.items[0],name:'  '}]},{...state,items:[{...state.items[0],icon:'<script>'}]}]) expect(()=>decodeWorkspaces(invalid)).toThrow();
});
test('production controller uses workspace commands and preserves tabs between spaces',async()=>{
 const fixture=createBirdFixture('vertical',canDropTab);const controller=createController(fixture.port);await controller.ready;
 controller.openWorkspaceEditor();controller.editWorkspace({name:'Project',icon:'code',color:'lilac'});controller.saveWorkspace();
 await new Promise(resolve=>setTimeout(resolve,10));
 const id=controller.state().browser.workspaces!.active;
 expect(controller.state().browser.workspaces!.items).toHaveLength(2);
 expect(controller.state().browser.tabs).toHaveLength(1);
 controller.switchWorkspace('default');await new Promise(resolve=>setTimeout(resolve,10));
 expect(controller.state().browser.tabs).toHaveLength(3);
 controller.openWorkspaceEditor(id);controller.editWorkspace({name:'Renamed'});controller.saveWorkspace();await new Promise(resolve=>setTimeout(resolve,10));
 expect(controller.state().browser.workspaces!.items.find(w=>w.id===id)?.name).toBe('Renamed');
 expect(controller.state().browser.workspaces!.active).toBe('default');
 await controller.close();fixture.dispose();
});
