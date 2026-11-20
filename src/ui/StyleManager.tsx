import { createStyleController } from '../browser/style-controller';
import type { UserStylePort } from '../browser/style-protocol';
import { mountLibrary } from './preferences/library';

export function openStyleManager(host: HTMLElement, port: UserStylePort, onClosed: () => void) {
  const controller = createStyleController(port);
  return mountLibrary(host, 'styles', controller, 'library', onClosed, !!port.folders);
}
