import { exportSource } from '../browser/source-files';
import { mount, view, list } from 'effectweb';
import { Input } from '@effectweb/shadcn/input';
import { Textarea } from '@effectweb/shadcn/textarea';
import { Button } from './button';
import { createScriptController, type ScriptModel } from '../browser/script-controller';
import { scriptExecutionNotice } from '../browser/script-protocol';
import type { UserScriptPort } from '../browser/script-protocol';

export function openScriptManager(host: HTMLElement, port: UserScriptPort, onClosed: () => void) {
  const controller = createScriptController(port);
  const close = () => {
    if (controller.state().busy) return;
    if (controller.state().confirmingRemoval) { controller.cancelRemove(); return; }
    if (controller.state().dirty) {
      if (port.folders) controller.folders(); else controller.load(); // Reports the unsaved draft without discarding it.
      return;
    }
    dispose();
    onClosed();
  };
  const manager = view<ScriptModel>(model => <section class="style-manager" role="dialog" aria-modal="true" aria-label="Userscripts">
    <header><h2>Userscripts</h2><Button variant="ghost" disabled={model.busy} onClick={close}>Close</Button></header>
    {model.downloading ? <Button variant="ghost" onClick={() => controller.cancelDownload()}>Cancel download</Button> : null}
    <div class="style-manager-body">
      <aside aria-label="Installed scripts">
        <Button disabled={model.busy || !model.snapshot} onClick={() => controller.create()}>New script</Button>
        <details class="source-import"><summary>Install from URL or file</summary>
        {port.fetchSource ? <form class="source-url-import" onSubmit={event => { event.preventDefault(); const input = event.currentTarget.elements.namedItem('sourceURL') as HTMLInputElement; controller.importURL(input.value); }}>
          <input name="sourceURL" type="url" aria-label="URL source file" placeholder="https://…" required disabled={model.busy || model.dirty}/>
          <Button type="submit" disabled={model.busy || model.dirty || !model.snapshot}>Install from URL</Button>
        </form> : null}
        <label class="source-file-import">Import file<input type="file" aria-label="Import script" accept=".js" disabled={model.busy || model.dirty || !model.snapshot} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) controller.importFile(file); event.currentTarget.value = ''; }}/></label>
        </details>
        {port.folders ? <details class="source-folders"><summary>Folders</summary>
          <Button variant="ghost" disabled={model.busy || model.dirty} onClick={() => controller.folders('add')}>Add folder</Button>
          <Button variant="ghost" disabled={model.busy || model.dirty} onClick={() => controller.folders()}>Refresh folders</Button>
          {list(model.directories, path => path, path => <div><small title={path}>{path}</small><Button variant="ghost" disabled={model.busy || model.dirty} onClick={() => controller.folders('remove', path)}>Disconnect folder</Button></div>)}
        </details> : null}
        {list(model.snapshot?.items ?? [], item => item.id, item => <Button variant="ghost" disabled={model.busy} aria-pressed={model.draft?.id === item.id} onClick={() => controller.select(item.id)}>{item.name}{item.pendingUpdate ? ' · update' : ''}{item.enabled ? '' : ' · disabled'}</Button>)}
        <Button variant="ghost" disabled={model.busy} onClick={() => controller.load()}>Reload</Button>
      </aside>
      <div class="style-editor">
        {model.draft ? <>
          <label>Name<Input aria-label="Script name" value={model.draft.name} maxLength={1024} disabled={model.busy} onInput={event => controller.change({ name: event.currentTarget.value })}/></label>
          {model.draft.sourceURL ? <label class="style-enabled"><input type="checkbox" checked={model.draft.checkUpdates ?? false} disabled={model.busy} onChange={event => controller.change({ checkUpdates: event.currentTarget.checked })}/>Check for updates daily</label> : null}
          {model.draft.pendingUpdate ? <Button disabled={model.busy || model.dirty} onClick={() => controller.reviewUpdate()}>Review update</Button> : null}
          {model.draft.updateError ? <p role="status">Update check: {model.draft.updateError}</p> : null}
          {model.conflict ? <div role="alert" class="source-conflict">
            <p>Source changed. Your draft is preserved and can be exported.</p>
            <Button variant="ghost" disabled={model.busy} onClick={() => controller.reloadLatest()}>Load current version</Button>
            <Button variant="ghost" disabled={model.busy} onClick={() => controller.continueDraft()}>Keep my changes</Button>
          </div> : null}
          {model.updateReview ? <p class="update-review" role="status">{model.updateReview}</p> : null}
          <label class="style-enabled"><input type="checkbox" checked={model.draft.enabled} disabled={model.busy} onChange={event => controller.change({ enabled: event.currentTarget.checked })}/>Enabled</label>
          {port.setFileAccess && model.snapshot?.items.some(item => item.id === model.draft?.id) ? <label class="style-enabled"><input type="checkbox" checked={model.snapshot.items.find(item => item.id === model.draft?.id)?.fileAccessGranted ?? false} disabled={model.busy || model.dirty} onChange={event => controller.setFileAccess(event.currentTarget.checked)}/>Allow on local files (file://)</label> : null}
          <label class="style-source">JavaScript · Tampermonkey metadata<Textarea aria-label="Script source" spellcheck={false} value={model.draft.source} maxLength={2 * 1024 * 1024} disabled={model.busy} onInput={event => controller.change({ source: event.currentTarget.value })}/></label>
          <p>Changes apply after reloading the page.</p>
          {model.snapshot?.items.find(item => item.id === model.draft?.id) && !model.dirty ? <p role="status">{scriptExecutionNotice(model.snapshot.items.find(item => item.id === model.draft?.id)!)}</p> : null}
          {model.draft.id.startsWith('folder_') ? <p>Source folder changes replace local edits on refresh.</p> : null}
          {model.draft.sourceURL ? <p class="source-origin">Source: <span>{model.draft.sourceURL}</span><Button variant="ghost" disabled={model.busy || model.dirty} onClick={() => controller.importURL(model.draft!.sourceURL!, true)}>Check for updates</Button></p> : null}
          <footer>
            <Button variant="ghost" disabled={model.busy} onClick={() => exportSource(model.draft!.name, model.draft!.source, '.user.js')}>Export</Button>
            <Button disabled={model.busy || !model.dirty || model.conflict} onClick={() => controller.save()}>{model.busy ? 'Saving…' : 'Save'}</Button>
            <Button variant="ghost" disabled={model.busy || !model.dirty || model.conflict} onClick={() => controller.discard()}>Discard changes</Button>
            <Button variant="ghost" disabled={model.busy || model.dirty || model.draft.id.startsWith('folder_')} title="Disable the item or disconnect its source folder" onClick={() => controller.requestRemove()}>Delete</Button>
          </footer>
          {model.confirmingRemoval ? <div role="group" aria-label="Delete script confirmation">
            <p>Delete «{model.draft.name}»?</p>
            <Button disabled={model.busy} onClick={() => controller.remove()}>Delete permanently</Button>
            <Button variant="ghost" disabled={model.busy} onClick={() => controller.cancelRemove()}>Keep script</Button>
          </div> : null}
        </> : <p>{model.busy ? 'Loading…' : 'No scripts installed.'}</p>}
        {model.error ? <p role="alert">{model.error}</p> : null}
      </div>
    </div>
  </section>);
  const mounted = mount(host, manager, controller.source);
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); controller.save(); }
    if (event.key === 'Tab') {
      const focusable = Array.from(host.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)'));
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  host.addEventListener('keydown', onKey);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    host.removeEventListener('keydown', onKey);
    mounted.dispose();
    void controller.close();
  };
  if (port.folders) controller.folders(); else controller.load();
  window.requestAnimationFrame(() => host.querySelector<HTMLElement>('button')?.focus());
  return { dispose };
}
