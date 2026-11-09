// Serialize the pinned uBO registrations without executing the registered functions.
import fs from 'node:fs';
import { builtinScriptlets } from '../third_party/ublock-resources/scriptlets/scriptlets.js';
const entries = builtinScriptlets.map(entry => {
    if (typeof entry.name !== 'string' || typeof entry.fn !== 'function') throw new Error('Invalid scriptlet entry');
    return {
        name: entry.name,
        aliases: entry.aliases ?? [],
        kind: { mime: entry.name.endsWith('.fn') ? 'fn/javascript' : 'application/javascript' },
        content: Buffer.from(entry.fn.toString()).toString('base64'),
        dependencies: (entry.dependencies ?? []).map(dep => typeof dep === 'string' ? dep : dep.details.name),
        permission: entry.requiresTrust ? 1 : 0,
        world: entry.world ?? 'MAIN',
    };
});
const output = JSON.stringify(entries, null, 2) + '\n';
const target = new URL('../third_party/ublock-resources/scriptlets.json', import.meta.url);
if (process.argv.includes('--check')) {
    if (fs.readFileSync(target, 'utf8') !== output) throw new Error('Serialized scriptlets are stale');
} else {
    fs.writeFileSync(target, output);
}
console.log('Serialized ' + entries.length + ' registered scriptlets/helpers');
