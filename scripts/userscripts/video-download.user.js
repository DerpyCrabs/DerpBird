// ==UserScript==
// @name         DerpBird video download
// @namespace    derpbird
// @version      1.1
// @description  Download a video from players with site-provided controls.
// @match        http://*/*
// @match        https://*/*
// @grant        GM.download
// @connect      *
// @run-at       document-end
// ==/UserScript==
(() => {
    const players = new Map();
    const started = new WeakSet();
    const ownButtons = new WeakSet();
    const controls = 'button,[role="button"],[aria-label],[title]';
    const dirty = new Set();
    const sizes = new ResizeObserver(entries => entries.forEach(entry => schedule(entry.target)));
    let frame = 0;
    let tipId = 0;

    function source(video) {
        if (video.srcObject || video.mediaKeys) return null;
        const src = video.currentSrc || video.src || video.querySelector('source[src]')?.src;
        if (!src) return null;
        const url = new URL(src, document.baseURI);
        if (!['http:', 'https:'].includes(url.protocol) || /\.(m3u8|mpd)$/i.test(url.pathname)) return null;
        return url;
    }

    function controlRow(video) {
        for (let root = video.parentElement, depth = 0; root && root !== document.body && depth < 7; root = root.parentElement, depth++) {
            if (root.querySelectorAll('video').length !== 1) break;
            const items = [...root.querySelectorAll(controls)];
            const label = el => [el.getAttribute('aria-label'), el.title, el.className].filter(x => typeof x === 'string').join(' ');
            const full = items.find(el => /full[\s_-]*screen|полноэкран/i.test(label(el)));
            const volume = items.find(el => /volume|mute|громк|звук/i.test(label(el)));
            if (!full || !volume || full.contains(volume)) continue;
            let slot = full;
            while (slot.parentElement && slot.parentElement !== root && !slot.parentElement.contains(volume))
                slot = slot.parentElement;
            if (slot.parentElement?.contains(volume) && !slot.contains(video)) return slot;
        }
        return null;
    }

    function matchIconColor(button, reference) {
        if (location.hostname === 'discord.com' || location.hostname.endsWith('.discord.com')) {
            button.style.color = button.matches(':hover')
                ? 'var(--white, white)' : 'var(--interactive-text-active, #dcdcdf)';
            return;
        }
        const shape = reference?.querySelector('svg path, svg use');
        const paint = shape && getComputedStyle(shape);
        button.style.color = paint && paint.fill !== 'none' ? paint.fill
            : paint && paint.stroke !== 'none' ? paint.stroke
            : reference ? getComputedStyle(reference).color : 'inherit';
    }

    function createButton(video) {
        const button = document.createElement('button');
        button.type = 'button';
        const label = document.documentElement.lang.startsWith('ru') ? 'Скачать видео' : 'Download video';
        button.setAttribute('aria-label', label);
        let tip;
        function hideTip() {
            tip?.remove();
            tip = null;
            button.removeAttribute('aria-describedby');
        }
        function showTip() {
            if (tip || !button.isConnected) return;
            tip = document.createElement('div');
            tip.id = 'derpbird-tip-' + (++tipId);
            tip.setAttribute('role', 'tooltip');
            tip.textContent = label;
            tip.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;white-space:nowrap;background:var(--background-surface-high,#29292e);color:var(--text-default,#eee);border-radius:var(--radius-sm,6px);padding:var(--space-8,8px) var(--space-12,12px);box-shadow:inset 0 0 0 1px var(--border-subtle,transparent),var(--shadow-high,0 2px 8px #0005);font:500 14px/18px var(--font-primary,sans-serif)';
            (document.fullscreenElement || document.body).append(tip);
            const rect = button.getBoundingClientRect();
            tip.style.left = Math.max(4, Math.min(innerWidth-tip.offsetWidth-4, rect.left+(rect.width-tip.offsetWidth)/2))+'px';
            tip.style.top = (rect.top >= tip.offsetHeight+8 ? rect.top-tip.offsetHeight-8 : rect.bottom+8)+'px';
            button.setAttribute('aria-describedby', tip.id);
        }
        for (const event of ['pointerenter', 'focus']) button.addEventListener(event, showTip);
        for (const event of ['pointerleave', 'blur', 'click']) button.addEventListener(event, hideTip);
        button.addEventListener('keydown', event => { if (event.key === 'Escape') hideTip(); });
        button.style.cssText = 'box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:4px;border:0;border-radius:4px;cursor:pointer;flex:none';
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('width', '20');
        icon.setAttribute('height', '20');
        const path = document.createElementNS(icon.namespaceURI, 'path');
        path.setAttribute('fill', 'currentColor');
        path.setAttribute('d', 'M11 3h2v10l4-4 1.4 1.4L12 17l-6.4-6.6L7 9l4 4zM4 18h2v2h12v-2h2v4H4z');
        icon.append(path);
        button.append(icon);
        button.addEventListener('click', async event => {
            event.preventDefault();
            event.stopPropagation();
            const url = source(video);
            if (!event.isTrusted || !url || button.disabled) return;
            button.disabled = true;
            try {
                let path = url.pathname;
                for (let i = 0; i < 2; i++) {
                    try { path = decodeURIComponent(path); } catch { break; }
                }
                const name = path.match(/([^/?#]+\.(?:mp4|webm|mov|m4v|ogv))(?=[/?#]|$)/i)?.[1] || 'video';
                await GM.download({url: url.href, name: name.replace(/[<>:"|*\\]/g, '_')});
            } catch {
                button.title = 'Download failed — retry';
            } finally {
                button.disabled = false;
            }
        });
        for (const event of ['pointerenter', 'pointerleave'])
            button.addEventListener(event, () => matchIconColor(button, controlRow(video)));
        ownButtons.add(button);
        return button;
    }

    function place(video) {
        let button = players.get(video);
        const hasStarted = started.has(video) || !video.paused || video.played.length > 0;
        if (!hasStarted || !video.isConnected || video.controls || !source(video)) {
            const tipId = button?.getAttribute('aria-describedby');
            if (tipId) document.getElementById(tipId)?.remove();
            button?.remove();
            if (button) sizes.unobserve(video);
            players.delete(video);
            return;
        }
        if (!button) {
            button = createButton(video);
            players.set(video, button);
            sizes.observe(video);
        }
        const row = controlRow(video);
        matchIconColor(button, row);
        const slot = row;
        if (slot) {
            button.style.position = 'static';
            button.style.visibility = 'visible';
            button.style.background = 'transparent';
            if (button.nextElementSibling !== slot) slot.before(button);
            return;
        }
        if (button.parentElement !== video.parentElement) video.after(button);
        button.style.position = 'absolute';
        button.style.zIndex = '2';
        button.style.background = 'rgb(0 0 0 / 65%)';
        const rect = video.getBoundingClientRect();
        const parent = button.offsetParent;
        const origin = parent?.getBoundingClientRect();
        button.style.left = (rect.right - 36 - (origin?.left || 0) + (parent?.scrollLeft || 0) - (parent?.clientLeft || 0)) + 'px';
        button.style.top = (rect.top + 8 - (origin?.top || 0) + (parent?.scrollTop || 0) - (parent?.clientTop || 0)) + 'px';
        button.style.visibility = rect.width >= 40 && rect.height >= 40 ? 'visible' : 'hidden';
    }

    function schedule(video) {
        dirty.add(video);
        if (frame) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            dirty.forEach(place);
            dirty.clear();
        });
    }
    for (const type of ['loadstart', 'loadedmetadata', 'playing', 'emptied', 'resize']) {
        document.addEventListener(type, event => {
            if (event.target.localName !== 'video') return;
            if (type === 'playing') started.add(event.target);
            if (type === 'emptied') started.delete(event.target);
            schedule(event.target);
        }, true);
    }
    function visitVideos(node) {
        if (node.nodeType !== 1 || ownButtons.has(node)) return;
        if (node.matches('video')) schedule(node);
        else node.querySelectorAll('video').forEach(schedule);
    }
    new MutationObserver(records => {
        for (const record of records) {
            if (record.type === 'attributes') {
                const video = record.target.closest('video');
                if (video) schedule(video);
                continue;
            }
            record.addedNodes.forEach(visitVideos);
            record.removedNodes.forEach(visitVideos);
            for (const [video, button] of players) {
                if (!button.isConnected || (record.target !== button && video.parentElement?.contains(record.target)
                    && [...record.addedNodes, ...record.removedNodes].some(n => n.nodeType === 1 && !ownButtons.has(n))))
                    schedule(video);
            }
        }
    }).observe(document.documentElement, {subtree:true, childList:true, attributes:true, attributeFilter:['src','controls']});
    const reposition = () => players.forEach((_, video) => schedule(video));
    window.addEventListener('resize', reposition);
    document.addEventListener('fullscreenchange', reposition);
    document.querySelectorAll('video').forEach(schedule);
})();
