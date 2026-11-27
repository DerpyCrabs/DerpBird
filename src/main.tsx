import { createWebUIPort } from './browser/webui-port';
import { connectDevTools } from './devtools/native-port';
import './style.css';
import './ui/workspaces.css';

// Both windows use the same trusted about: document; the native owner determines its role.
async function start() {
  if (location.href === 'about:derpbird') {
    const transport = createWebUIPort(document, () => window.ladybird);
    try {
      let downloadsMounted = false;
      const port = await connectDevTools(transport, async () => {
        const { mountAppDownloads } = await import("./ui/AppDownloads");
        const dispose = await mountAppDownloads(document.getElementById("app")!, transport);
        window.addEventListener("pagehide", () => { dispose(); transport.close(); }, { once: true });
        downloadsMounted = true;
      });
      if (downloadsMounted) return;
      if (port) {
        const { mountDevTools } = await import('./devtools/DevTools');
        const ui = mountDevTools(document.getElementById('app')!, port, 'Elements');
        window.addEventListener('pagehide', () => { ui.dispose(); port.dispose(); transport.close(); }, {once:true});
        return;
      }
    } catch (error) {
      transport.close();
      document.getElementById('app')!.textContent = `Unable to start browser UI: ${String(error)}`;
      return;
    }
    transport.close();
  }
  await import('./shell-main');
}
void start();
