    let pending = false;
    let frame, fallback;
    let filterer;
    const run = () => {
        if (!pending) return;
        pending = false;
        cancelAnimationFrame(frame);
        clearTimeout(fallback);
        frame = fallback = undefined;
        if (!enabled()) return;
        try {
            filterer.commitNow();
        } catch (error) {
            console.warn('DerpBird procedural filter execution failed', error);
        }
    };
    const schedule = () => {
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
    filterer = new vAPI.DOMProceduralFilterer(facade);
    derpbirdRegisterProceduralTasks(filterer);
    vAPI.domFilterer = { proceduralFilterer: filterer };
    for (const serialized of serializedRules) {
        try {
            filterer.addProceduralSelectors([derpbirdProceduralRule(JSON.parse(serialized))]);
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
            schedule();
            break;
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
