import { ShellDialog } from './Overlay';
import Palette from '@effectweb/lucide/icons/palette';
import Plus from '@effectweb/lucide/icons/plus';
import Upload from '@effectweb/lucide/icons/upload';
import X from '@effectweb/lucide/icons/x';
import { exportSource } from '../browser/source-files';
import { mount, view, list } from 'effectweb';
import { NativeSelect } from '@effectweb/shadcn/native-select';
import { Input } from '@effectweb/shadcn/input';
import { Textarea } from '@effectweb/shadcn/textarea';
import { Button } from './button';
import { createStyleController, type StyleModel } from '../browser/style-controller';
import type { UserStylePort } from '../browser/style-protocol';

export function openStyleManager(host: HTMLElement, port: UserStylePort, onClosed: () => void) {
  const controller = createStyleController(port);
  const close = () => {
    if (controller.state().busy) return;
    if (controller.state().confirmingRemoval) { controller.cancelRemove(); return; }
    if (controller.state().dirty) {
      controller.requestClose();
      return;
    }
    dispose();
    onClosed();
  };
  const manager = view<StyleModel>(model => <ShellDialog onDismiss={close} trigger={() => document.querySelector('button[aria-label="Menu"]')} class="style-manager source-manager styles-manager" aria-label="User styles">
    <header class="source-manager-header"><span class="source-heading-icon"><Palette size={20}/></span><div><h2>User styles</h2></div><button class="source-icon-button" aria-label="Close styles" disabled={model.busy} onClick={close}><X size={19}/></button></header>
    {model.confirmingClose ? <div class="source-close-confirm" role="alert"><span>Discard unsaved changes?</span><button onClick={() => controller.cancelClose()}>Keep editing</button><button onClick={() => { dispose(); onClosed(); }}>Discard and close</button></div> : null}
    {model.downloading ? <Button variant="ghost" onClick={() => controller.cancelDownload()}>Cancel download</Button> : null}
    <div class="style-manager-body">
      <aside aria-label="Installed styles"><div class="source-library-title"><span>Library</span><span>{model.snapshot?.items.length ?? 0}</span></div>
        <Button disabled={model.busy || !model.snapshot} class="source-new" onClick={() => controller.create()}><Plus size={15}/>New style</Button>
        <div class="source-library-list">        {list(model.snapshot?.items ?? [], item => item.id, item => <Button class="source-library-item" variant="ghost" disabled={model.busy} aria-pressed={model.draft?.id === item.id} onClick={() => controller.select(item.id)}><span class={`source-state-dot ${item.enabled ? 'enabled' : ''}`}/><span class="source-item-copy"><strong>{item.name}</strong>{item.pendingUpdate ? <small>Update available</small> : null}</span></Button>)}
        </div>
        <details class="source-import"><summary>Install from URL or file</summary>
        {port.fetchSource ? <form class="source-url-import" onSubmit={event => { event.preventDefault(); const input = event.currentTarget.elements.namedItem('sourceURL') as HTMLInputElement; controller.importURL(input.value); }}>
          <input name="sourceURL" type="url" aria-label="URL source file" placeholder="https://…" required disabled={model.busy || model.dirty}/>
          <Button type="submit" disabled={model.busy || model.dirty || !model.snapshot}>Install from URL</Button>
        </form> : null}
        <div class="source-file-import"><button type="button" disabled={model.busy || model.dirty || !model.snapshot} onClick={() => host.querySelector<HTMLInputElement>('[aria-label="Import style"]')?.click()}><Upload size={14}/>Import file</button><input hidden type="file" aria-label="Import style" accept=".css,.less,.styl" disabled={model.busy || model.dirty || !model.snapshot} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) controller.importFile(file); event.currentTarget.value = ''; }}/></div>
        </details>
        {port.folders ? <details class="source-folders"><summary>Folders</summary>
          <Button variant="ghost" disabled={model.busy || model.dirty} onClick={() => controller.folders('add')}>Add folder</Button>
          <Button variant="ghost" disabled={model.busy || model.dirty} onClick={() => controller.folders()}>Refresh folders</Button>
          {list(model.directories, path => path, path => <div><small title={path}>{path}</small><Button variant="ghost" disabled={model.busy || model.dirty} onClick={() => controller.folders('remove', path)}>Disconnect folder</Button></div>)}
        </details> : null}
        {model.error || model.conflict ? <Button variant="ghost" disabled={model.busy} onClick={() => controller.load()}>Reload</Button> : null}
        {port.status ? <details>
          <summary>Page matching</summary>
          <Button variant="ghost" disabled={model.busy || !model.snapshot} onClick={() => controller.refreshStatus()}>Refresh status</Button>
          {model.matchStatus ? <div role="status">
            <p>Last result for the main document: <span style={{ overflowWrap: 'anywhere' }}>{model.matchStatus.url}</span></p>
            <p>{!model.matchStatus.evaluated ? 'Styles have not been matched yet.'
              : model.matchStatus.skippedConditions ? `Regex conditions skipped at the execution limit: ${model.matchStatus.skippedConditions}. Other conditions remain active.`
              : 'Matching completed within the regex limit.'}</p>
          </div> : null}
        </details> : null}
      </aside>
      <div class="style-editor">
        {model.draft ? <>
          <div class="source-editor-heading"><label>Name<Input aria-label="Style name" value={model.draft.name} maxLength={512} disabled={model.busy} onInput={event => controller.change({ name: event.currentTarget.value })}/></label><label class="style-enabled"><input type="checkbox" role="switch" checked={model.draft.enabled} disabled={model.busy} onChange={event => controller.change({ enabled: event.currentTarget.checked })}/>Enabled</label></div>
          <details class="source-settings"><summary>Options & updates</summary><div>
          {model.matchStatus?.styleIds.includes(model.draft.id) ? <p role="status">Some regex conditions exceeded the execution limit.</p> : null}
          {model.draft.sourceURL ? <label class="style-enabled"><input type="checkbox" checked={model.draft.checkUpdates ?? false} disabled={model.busy} onChange={event => controller.change({ checkUpdates: event.currentTarget.checked })}/>Check for updates daily</label> : null}
          {model.draft.pendingUpdate ? <Button disabled={model.busy || model.dirty} onClick={() => controller.reviewUpdate()}>Review update</Button> : null}
          {model.draft.updateError ? <p role="status">Update check: {model.draft.updateError}</p> : null}
          {model.conflict ? <div role="alert" class="source-conflict">
            <p>Source changed. Your draft is preserved and can be exported.</p>
            <Button variant="ghost" disabled={model.busy} onClick={() => controller.reloadLatest()}>Load current version</Button>
            <Button variant="ghost" disabled={model.busy} onClick={() => controller.continueDraft()}>Keep my changes</Button>
          </div> : null}
          {model.updateReview ? <p class="update-review" role="status">{model.updateReview}</p> : null}

          {model.draft.source.includes('==UserStyle==') ? <div class="usercss-settings">
            <Button variant="ghost" disabled={model.busy} aria-expanded={!!model.configuration} onClick={() => controller.configure()}>Style options</Button>
            {model.configuration ? <div class="usercss-variables">
              <p>{model.configuration.name} · {model.configuration.version} · {model.configuration.preprocessor}</p>
              {list(Object.values(model.configuration.vars), variable => variable.name, variable => <label>
                <span>{variable.label}{variable.units ? ` (${variable.units})` : ''}</span>
                {variable.type === 'checkbox' ? <input type="checkbox" aria-label={variable.label}
                  disabled={model.busy} checked={Number(model.draft?.usercss?.values[variable.name] ?? variable.default) === 1}
                  onChange={event => controller.changeVariable(variable.name, event.currentTarget.checked ? 1 : 0)}/>
                : variable.options ? <NativeSelect aria-label={variable.label} disabled={model.busy}
                  value={String(model.draft?.usercss?.values[variable.name] ?? variable.default)}
                  onChange={event => controller.changeVariable(variable.name,event.currentTarget.value)}>
                  {list(variable.options, option => option.name, option => <option value={option.name}>{option.label}</option>)}
                </NativeSelect>
                : <Input aria-label={variable.label} disabled={model.busy}
                  type={['number','range'].includes(variable.type) ? 'number' : 'text'}
                  min={variable.min ?? undefined} max={variable.max ?? undefined} step={variable.step ?? 'any'}
                  value={String(model.draft?.usercss?.values[variable.name] ?? variable.default)}
                  onInput={event => controller.changeVariable(variable.name,event.currentTarget.value)}/>}
              </label>)}
              <Button variant="ghost" disabled={model.busy} onClick={() => controller.resetVariables()}>Reset options</Button>
            </div> : null}
          </div> : null}
          </div></details>
          <label class="style-source">CSS · Stylish / UserCSS<Textarea aria-label="CSS style" spellcheck={false} value={model.draft.source} maxLength={2 * 1024 * 1024} disabled={model.busy} onInput={event => controller.change({ source: event.currentTarget.value })}/></label>
          {model.draft.id.startsWith('folder_') ? <p>Source folder changes replace local edits on refresh.</p> : null}
          {model.draft.sourceURL ? <p class="source-origin">Source: <span>{model.draft.sourceURL}</span><Button variant="ghost" disabled={model.busy || model.dirty} onClick={() => controller.importURL(model.draft!.sourceURL!, true)}>Check for updates</Button></p> : null}
          <footer class="source-editor-footer"><span class="source-save-state">{model.dirty ? 'Unsaved changes' : 'Saved'}</span>
            <Button variant="ghost" disabled={model.busy} onClick={() => exportSource(model.draft!.name, model.draft!.source, '.user.css')}>Export</Button>
            {model.compiling ? <Button variant="ghost" onClick={() => controller.cancelCompilation()}>Cancel compilation</Button> : null}
            <Button class="primary" disabled={model.busy || !model.dirty || model.conflict} onClick={() => controller.save()}>{model.busy ? 'Saving…' : 'Save'}</Button>
            <Button variant="ghost" disabled={model.busy || !model.dirty || model.conflict} onClick={() => controller.discard()}>Discard changes</Button>
            <Button variant="ghost" disabled={model.busy || model.dirty || model.draft.id.startsWith('folder_')} title="Disable the item or disconnect its source folder" onClick={() => controller.requestRemove()}>Delete</Button>
          </footer>
          {model.confirmingRemoval ? <div role="group" aria-label="Delete style confirmation">
            <p>Delete «{model.draft.name}»?</p>
            <Button disabled={model.busy} onClick={() => controller.remove()}>Delete permanently</Button>
            <Button variant="ghost" disabled={model.busy} onClick={() => controller.cancelRemove()}>Keep style</Button>
          </div> : null}
        </> : <div class="source-empty"><span class="source-empty-icon"><Palette size={30}/></span><h3>{model.busy ? 'Loading…' : 'No styles yet'}</h3><div><Button class="primary" disabled={model.busy || !model.snapshot} onClick={() => host.querySelector<HTMLInputElement>('[aria-label="Import style"]')?.click()}><Upload size={16}/>Import style</Button><Button disabled={model.busy || !model.snapshot} onClick={() => controller.create()}><Plus size={16}/>New style</Button></div><small>.css · .user.css · .less · .styl</small></div>}
        {model.error ? <p role="alert">{model.error}</p> : null}
      </div>
    </div>
  </ShellDialog>);
  const mounted = mount(host, manager, controller.source);
  const onKey = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); controller.save(); }
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
  return { dispose };
}
