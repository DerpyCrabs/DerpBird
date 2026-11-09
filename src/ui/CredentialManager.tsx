import { mount, view, list } from 'effectweb';
import { Input } from '@effectweb/shadcn/input';
import { Button } from './button';
import { createCredentialController, type CredentialModel } from '../browser/credential-controller';
import type { CapturedCredential, CredentialPort } from '../browser/credential-protocol';
export function openCredentialManager(host: HTMLElement, port: CredentialPort, onClosed: () => void, proposal?: CapturedCredential) {
  const controller = createCredentialController(port);
  const close = () => {
    if (controller.state().confirmingRemoval) { controller.cancelRemove(); return; }
    if (!controller.canLeave()) return;
    dispose(); onClosed();
  };
  const manager = view<CredentialModel>(model => {
    const query = model.query.toLocaleLowerCase();
    const exceptions = model.exceptions.filter(origin => origin.toLocaleLowerCase().includes(query));
    const matches = (model.items ?? []).filter(item => `${item.origin} ${item.username}`.toLocaleLowerCase().includes(query));
    return <section class="style-manager credential-manager" role="dialog" aria-modal="true" aria-label="Passwords">
      <header><h2>Passwords</h2><Button variant="ghost" disabled={model.busy} onClick={close}>Close</Button></header>
      <div class="style-manager-body">
        <aside aria-label="Saved passwords">
          <Input aria-label="Search passwords" placeholder="Site or username" value={model.query} onInput={event => controller.search(event.currentTarget.value)}/>
          <Button disabled={model.busy || !model.items} onClick={() => controller.create()}>Add password</Button>
          {port.capture ? <Button disabled={model.busy || model.dirty || !!model.proposal || !model.items} onClick={() => controller.capture()}>Save from tab</Button> : null}
          {list(matches.slice(0, 100), item => item.id, item => <Button variant="ghost" disabled={model.busy} aria-pressed={model.draft?.id === item.id} onClick={() => controller.select(item.id)}><span class="credential-label"><strong>{item.origin}</strong><span>{item.username || 'No username'}</span></span></Button>)}
          {matches.length > 100 ? <p>Showing the first 100 entries. Refine your search.</p> : null}
          <Button variant="ghost" disabled={model.busy} onClick={() => controller.load()}>Reload</Button>
          {port.exceptions ? <details class="credential-exceptions"><summary>Never save ({model.exceptions.length})</summary>
            <p class="subtle">Exceptions preserve saved passwords and manual filling.</p>
            {list(exceptions.slice(0, 100), origin => origin, origin => <div><p>{origin}</p><Button variant="ghost" aria-label={`Allow prompts for ${origin}`} disabled={model.busy || model.dirty || !!model.proposal} onClick={() => controller.allowOrigin(origin)}>Allow</Button></div>)}
            {exceptions.length > 100 ? <p>Showing the first 100 sites. Refine your search.</p> : null}
          </details> : null}
        </aside>
        <div class="style-editor">
          {model.proposal ? <section aria-label="Save login confirmation">
            <h3>Save this login?</h3>
            <p>Site: <strong>{model.proposal.origin}</strong></p>
            <p>Username: <strong>{model.proposal.username || 'No username'}</strong></p>
            <p class="subtle">Confirm within two minutes. Switching tabs cancels this prompt. Check the site before saving.</p>
            <Button disabled={model.busy || !model.items} onClick={() => controller.saveCapture(null)}>Save new login</Button>
            {list((model.items ?? []).filter(item => item.origin === model.proposal!.origin && item.username === model.proposal!.username), item => item.id, item => <Button disabled={model.busy} onClick={() => controller.saveCapture(item.id)}>Update password for {item.username || 'unnamed login'}</Button>)}
            <Button variant="ghost" disabled={model.busy} onClick={() => controller.discardCapture()}>Don’t save</Button>
            {port.exceptions ? <Button variant="ghost" disabled={model.busy} onClick={() => controller.neverCapture()}>Never for this site</Button> : null}
          </section> : model.draft ? <>
            <label>Site<Input aria-label="Site" autocomplete="off" spellcheck={false} value={model.draft.origin} placeholder="https://example.com" disabled={model.busy || !!model.draft.id} maxLength={2048} onInput={event => controller.change({ origin: event.currentTarget.value })}/></label>
            <label>Username<Input aria-label="Username" autocomplete="off" value={model.draft.username} disabled={model.busy} maxLength={1024} onInput={event => controller.change({ username: event.currentTarget.value })}/></label>
            {model.draft.id ? <div class="credential-reveal">
              <Button variant="ghost" disabled={model.busy || model.dirty} onClick={() => model.revealed === null ? controller.reveal() : controller.hide()}>{model.revealed === null ? 'Show saved password' : 'Hide password'}</Button>
              <Button variant="ghost" disabled={model.busy || model.dirty} onClick={() => controller.copy()}>Copy password</Button>
              {port.fill ? <><Button variant="ghost" disabled={model.busy || model.dirty} onClick={() => controller.fill()}>Fill login</Button><p class="subtle">Focus the site’s password field before opening this list. The site must match the login.</p></> : null}
              {model.filled ? <p role="status">Login filled. Close this window to continue.</p> : null}
              {model.copied ? <p role="status">Password copied. Clipboard clears after 30 seconds unless replaced.</p> : null}
              {model.revealed !== null ? <label>Saved password<Input aria-label="Saved password" readonly autocomplete="off" spellcheck={false} value={model.revealed}/><span class="subtle">Hidden after 30 seconds or when the window loses focus.</span></label> : null}
            </div> : null}
            <label>{model.draft.id ? 'New password'  : 'Password'}<Input aria-label="Password" type="password" autocomplete="new-password" spellcheck={false} value={model.draft.password} disabled={model.busy} maxLength={65536} onInput={event => controller.change({ password: event.currentTarget.value })}/></label>
            <div><Button variant="ghost" disabled={model.busy} onClick={() => controller.generate()}>Generate password</Button><span class="subtle">24 characters</span></div>
            <p class="subtle">{model.draft.id ? 'Enter a new password to replace this login.' : 'Stored in the system keyring.'}</p>
            <footer>
              <Button disabled={model.busy || !model.dirty} onClick={() => controller.save()}>{model.busy ? 'Please wait…' : 'Save'}</Button>
              <Button variant="ghost" disabled={model.busy || !model.dirty} onClick={() => controller.discard()}>Discard changes</Button>
              <Button variant="ghost" disabled={model.busy || model.dirty || !model.draft.id} onClick={() => controller.requestRemove()}>Delete</Button>
            </footer>
            {model.confirmingRemoval ? <div role="group" aria-label="Delete password confirmation"><p>Delete login for {model.draft.origin}?</p><Button disabled={model.busy} onClick={() => controller.remove()}>Delete permanently</Button><Button variant="ghost" disabled={model.busy} onClick={() => controller.cancelRemove()}>Keep login</Button></div> : null}
          </> : <p>{model.busy ? 'Loading…' : 'Select a login or add a password.'}</p>}
          {model.error ? <p role="alert">{model.error}</p> : null}
        </div>
      </div>
    </section>;
  });
  const mounted = mount(host, manager, controller.source);
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); if (controller.state().revealed !== null) controller.hide(); else if (controller.state().proposal) controller.discardCapture(); else close(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); controller.save(); }
    if (event.key === 'Tab') {
      const elements = Array.from(host.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));
      const first = elements[0], last = elements.at(-1);
      if (!host.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  document.addEventListener('keydown', onKey);
  const onHidden = () => { if (document.hidden) controller.hide(); };
  window.addEventListener('blur', controller.hide);
  document.addEventListener('visibilitychange', onHidden);
  let disposed = false;
  const dispose = () => { if (disposed) return; disposed = true; document.removeEventListener('keydown', onKey); window.removeEventListener('blur', controller.hide); document.removeEventListener('visibilitychange', onHidden); mounted.dispose(); void controller.close(); };
  controller.load(proposal);
  window.requestAnimationFrame(() => { if (!disposed) host.querySelector<HTMLElement>('input')?.focus(); });
  return { dispose };
}
