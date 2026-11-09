    const filterer = new vAPI.DOMProceduralFilterer({
        commit() {},
        hasListeners: () => false,
        addCSS() { throw new TypeError('HTML filters must remove nodes'); },
    });
    // These nodes belong to an inert response document. Removing them is enough:
    // clearing a detached <script>.textContent invokes a TrustedScript sink in
    // the page realm, despite the fact that nothing will execute here.
    filterer.processNodes = (nodes, action) => {
        if (action?.[0] !== 'remove') throw new TypeError('Invalid HTML filter action');
        for (const node of nodes) node.remove();
    };
    derpbirdRegisterProceduralTasks(filterer);
    vAPI.domFilterer = { proceduralFilterer: filterer };
    for (const serialized of serializedRules) {
        const rule = derpbirdProceduralRule(JSON.parse(serialized));
        if (rule.action?.[0] !== 'remove') throw new TypeError('Invalid HTML filter action');
        filterer.addProceduralSelectors([rule]);
    }
    filterer.commitNow();
    // Preserve the doctype and therefore quirks mode. outerHTML serializes raw
    // text elements through the platform serializer, not string replacement.
    const doctype = document.doctype ? new XMLSerializer().serializeToString(document.doctype) : '';
    return doctype + (document.documentElement?.outerHTML ?? '');
}
