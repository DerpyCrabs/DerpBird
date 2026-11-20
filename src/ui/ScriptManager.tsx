import { createScriptController } from '../browser/script-controller';
import type { UserScriptPort } from '../browser/script-protocol';
import { mountLibrary } from './preferences/library';

export function openScriptManager(host: HTMLElement, port: UserScriptPort, onClosed: () => void) {
  const controller = createScriptController(port);
  return mountLibrary(host, 'scripts', controller, 'library', onClosed, !!port.folders);
}
