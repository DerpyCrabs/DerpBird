// A response filter owns this inert document; none of its nodes are adopted by
// the live page. Serialization is fed to the normal parser only after removal.
function __derpbirdFilterHTML(html, serializedRules) {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const vAPI = { randomToken: () => 'derpbird-html-filter', hideStyle: 'display:none!important;' };
