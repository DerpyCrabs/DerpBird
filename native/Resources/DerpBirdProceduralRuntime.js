    let pending = false;
    let frame, fallback;
    let filterer;
    let fullScan = true;
    let mutations = [];
    let pass = 0;
    const run = () => {
        if (!pending) return;
        pending = false;
        cancelAnimationFrame(frame);
        clearTimeout(fallback);
        frame = fallback = undefined;
        if (!enabled()) { mutations = []; fullScan = true; return; }
        try {
            pass++;
            filterer.commitNow();
        } catch (error) {
            console.warn('DerpBird procedural filter execution failed', error);
        } finally {
            fullScan = false;
            mutations = [];
        }
    };
    const schedule = (full = true) => {
        if (full) fullScan = true;
        if (pending) return;
        pending = true;
        // Apply before painting, rather than forcing an unfiltered paint followed
        // by a second style/layout pass. Hidden documents have a bounded fallback.
        frame = requestAnimationFrame(run);
        fallback = setTimeout(run, 1000);
    };
    const facade = {
        commit: schedule,
        hasListeners: () => false,
        addCSS: css => {
            if (!addCSS(css)) throw new Error('Procedural user stylesheet rejected');
        },
    };
    // Keep the upstream executor, but do not manufacture mutation records for
    // markers already present. Removal or modification still gets repaired.
    class Filterer extends vAPI.DOMProceduralFilterer {
        processNodes(nodes, action) {
            const op = action && action[0] || '';
            if (op !== '' && op !== 'style') return super.processNodes(nodes, action);
            const style = op === '' ? '' : action[1];
            const token = this.styleTokenFromStyle(style === '' ? vAPI.hideStyle : style);
            for (const node of nodes) {
                if (node.getAttribute(this.masterToken) !== '') node.setAttribute(this.masterToken, '');
                if (node.getAttribute(token) !== '') node.setAttribute(token, '');
                this.styledNodes.add(node);
            }
        }
    }
    filterer = new Filterer(facade);
    let watchAllAttributes = false;
    const relevantAttributes = new Set();
    const collectDependencies = rule => {
        // Deliberately narrow: no pseudo-classes, escapes, combinators or
        // attribute selectors. Unknown dependencies retain the full observer.
        for (const operator of rule.selector) {
            if (operator.type === 'has-text') continue;
            if (operator.type !== 'css-selector' || !operator.arg ||
                !/^(?:[a-zA-Z][\w-]*|\*)?(?:[.#][a-zA-Z_][\w-]*)*$/.test(operator.arg)) {
                watchAllAttributes = true;
                continue;
            }
            if (operator.arg.includes('.')) relevantAttributes.add('class');
            if (operator.arg.includes('#')) relevantAttributes.add('id');
        }
    };
    const makeIncremental = (compiled, rule) => {
        // Only simple subject selectors plus text predicates preserve their
        // subject and have local dependencies. Everything else stays upstream.
        if (compiled.action || rule.selector[0]?.type !== 'css-selector' ||
            !/^(?:[a-zA-Z][\w-]*|\*)?(?:[.#][a-zA-Z_][\w-]*)*$/.test(rule.selector[0].arg) ||
            !rule.selector[0].arg || rule.selector.slice(1).some(op => op.type !== 'has-text')) return;
        const selector = filterer.selectors.get(compiled.raw);
        if (!selector || selector.derpbirdIncremental) return;
        selector.derpbirdIncremental = true;
        const execute = selector.exec;
        const css = compiled.selector;
        const readsText = rule.selector.length > 1;
        let cached, lastPass = -1;
        selector.exec = function() {
            // Upstream can suspend costly rules. Missed mutation batches must
            // invalidate their cache when their execution budget recovers.
            const skipped = lastPass !== pass - 1;
            lastPass = pass;
            if (fullScan || skipped || !cached || mutations.length > 256) {
                cached = new Set(execute.call(this));
                return [...cached];
            }
            const candidates = new Set();
            const add = node => { if (node?.nodeType === 1) candidates.add(node); };
            const ancestors = node => {
                for (let parent = node?.nodeType === 1 ? node : node?.parentElement; parent; parent = parent.parentElement) add(parent);
            };
            for (const record of mutations) {
                if (record.type === 'attributes') {
                    if ((record.attributeName === 'class' && css.includes('.')) ||
                        (record.attributeName === 'id' && css.includes('#'))) add(record.target);
                } else if (record.type === 'characterData') {
                    if (readsText) ancestors(record.target);
                } else if (record.type === 'childList') {
                    if (readsText) ancestors(record.target);
                    for (const node of record.addedNodes) {
                        add(node);
                        if (node.nodeType === 1) for (const child of node.querySelectorAll('*')) add(child);
                    }
                }
            }
            if (candidates.size > 2048) {
                cached = new Set(execute.call(this));
                return [...cached];
            }
            for (const node of cached) if (!node.isConnected || node.ownerDocument !== document || candidates.has(node)) cached.delete(node);
            if (candidates.size) {
                // Use the pinned executor's predicates, supplying only affected
                // subjects. This avoids duplicating has-text/regex semantics.
                const root = { querySelectorAll: () => [...candidates].filter(node => node.isConnected && node.ownerDocument === document && node.matches(css)) };
                for (const node of execute.call(this, root)) cached.add(node);
            }
            return [...cached];
        };
    };
    derpbirdRegisterProceduralTasks(filterer);
    vAPI.domFilterer = { proceduralFilterer: filterer };
    for (const serialized of serializedRules) {
        try {
            const rule = JSON.parse(serialized);
            const compiled = derpbirdProceduralRule(rule);
            filterer.addProceduralSelectors([compiled]);
            collectDependencies(rule);
            makeIncremental(compiled, rule);
        } catch (error) {
            console.warn('DerpBird rejected procedural rule', error);
        }
    }
    if (filterer.selectors.size === 0) return;
    const observer = new MutationObserver(records => {
        for (const record of records) {
            // uBO writes its marker attributes on every pass. Ignore these
            // writes, but re-evaluate if a page removes a marker.
            if (record.type === 'attributes' &&
                record.attributeName.startsWith(prefix) &&
                record.target.getAttribute(record.attributeName) === '') continue;
            if (record.type === 'attributes' && !record.attributeName.startsWith(prefix) &&
                !watchAllAttributes && !relevantAttributes.has(record.attributeName)) continue;
            mutations.push(record);
            schedule(false);
        }
    });
    observer.observe(document, {
        childList: true, subtree: true, characterData: true, attributes: true,
    });
    window.addEventListener('resize', schedule);
    window.addEventListener('hashchange', schedule);
    window.addEventListener('popstate', schedule);
    window.addEventListener('load', schedule, true);
    schedule();
}
