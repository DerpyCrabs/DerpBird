function __derpbirdInstallProcedural(serializedRules) {
    const addCSS = globalThis.__derpbirdAddCSS;
    const enabled = globalThis.__derpbirdFilterEnabled;
    if (typeof addCSS !== 'function' || typeof enabled !== 'function') return;
    const entropy = new Uint32Array(4);
    crypto.getRandomValues(entropy);
    const prefix = 'data-derpbird-' + Array.from(entropy, n => n.toString(36)).join('') + '-';
    let sequence = 0;
    const vAPI = {
        randomToken: () => prefix + ++sequence,
        hideStyle: 'display:none!important;',
    };
