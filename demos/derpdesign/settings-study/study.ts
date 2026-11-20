import { createController, type ShellController } from '@bird/browser/controller';
import { canDropTab } from '@bird/browser/tab-tree';
import { createBirdFixture } from '../fixture';

export type StudyFrame = HTMLIFrameElement & { studyController: ShellController };

export async function mountStudy(root: HTMLElement, initial: string, browser?: ShellController) {
  const fixture = browser ? undefined : createBirdFixture('vertical', canDropTab);
  fixture?.enableWorkspaces();
  const controller = browser ?? createController(fixture!.port);
  await controller.ready;
  const frame = document.createElement('iframe') as StudyFrame;
  frame.studyController = controller;
  frame.title = 'Unified settings';
  frame.style.cssText = 'position:absolute;inset:0;border:0;width:100%;height:100%';
  const ready = new Promise<void>((resolve) =>
    frame.addEventListener(
      'load',
      () => {
        frame.contentDocument!.dispatchEvent(new Event('WebUILoaded'));
        resolve();
      },
      { once: true },
    ),
  );
  frame.src = '/settings-study/preferences.html#' + (initial === 'startup' ? 'browsing' : initial);
  root.append(frame);
  await ready;
  return () => {
    frame.remove();
    if (fixture) {
      void controller.close();
      fixture.dispose();
    }
  };
}

/** Use the same settings page when reached from the real browser menu. */
export function connectSettingsTab(controller: ShellController) {
  const surface = document.querySelector<HTMLElement>('#content-surface')!;
  const page = document.createElement('div');
  page.style.cssText = 'position:absolute;inset:0;z-index:1';
  page.hidden = true;
  surface.append(page);
  let mounted: ReturnType<typeof mountStudy> | undefined;
  let currentURL: string | undefined;
  function sync() {
    const { tabs, activeTabId } = controller.state().browser;
    const url = tabs.find((tab) => tab.id === activeTabId)?.url;
    if (url === currentURL) return;
    currentURL = url;
    const [address, section] = (url ?? '').split('#');
    page.hidden = address !== 'about:settings';
    if (page.hidden) return;
    if (!mounted) {
      mounted = mountStudy(page, section || 'appearance', controller);
    } else if (section) {
      void mounted.then(() => {
        if (currentURL !== url) return;
        const frame = page.querySelector('iframe');
        if (!frame?.contentDocument || !frame.isConnected) return;
        const tab = frame.contentDocument.getElementById('tab-button-' + section);
        if (tab) tab.click();
        else frame.contentWindow!.location.hash = section;
      });
    }
  }
  sync();
  const stop = controller.source.subscribe(sync);
  return () => {
    stop();
    page.remove();
    void mounted?.then((dispose) => dispose());
  };
}
