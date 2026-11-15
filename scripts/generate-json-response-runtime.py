#!/usr/bin/env python3
from pathlib import Path
root=Path(__file__).resolve().parents[1]
# Build the bounded adapter from the exact vendored implementation; no page globals/DOM.
source=(root/'third_party/ublock-resources/jsonpath.js').read_text().replace('export class JSONPath', 'class JSONPath')
import re
source,count=re.subn(r'^(\s*(?:for|while) \(.*\) \{)$',r'\1 __step();',source,flags=re.M)
assert count==14,count
source=source.replace('            next() {','            next() { __step();')
source=source.replace('    #modifyVal(obj, key) {', '    #modifyVal(obj, key) { __step(__writeCost);')
# Calls have no meaningful target in a JSON response and must not execute arbitrary methods.
a=source.index("        case 'call': {");b=source.index("        case 'repl': {",a)
source=source[:a]+"        case 'call': { throw new Error('Method calls are not supported on response JSON'); }\n"+source[b:]
prefix='''(() => {
let __remaining = 200000;
function __step(cost = 1) { if ((__remaining -= cost) < 0) throw new Error('JSONPath work limit'); }
'''
suffix='''
JSONPath.Regex = class {
    constructor(pattern, flags = '') { this.pattern = String(pattern); this.flags = String(flags); __nativeRegex('', this.pattern, this.flags, '', false); }
    test(input) { __step(); return __nativeRegex(String(input), this.pattern, this.flags.replace('g', ''), '', true); }
    [Symbol.replace](input, replacement) { __step(); return __nativeRegex(String(input), this.pattern, this.flags, String(replacement), false); }
};
const query = JSONPath.create(__query);
if (!query.valid) return __input;
const __writeCost = 1 + (JSON.stringify(query.value)?.length ?? 0);
function transform(text) {
    __step();
    let value;
    try { value = JSON.parse(text); } catch { return text; }
    const changed = query.apply(value);
    return changed === undefined ? text : JSON.stringify(changed);
}
if (__kind === 'json') return transform(__input);
// Preserve blank records and each original line delimiter, including a final newline.
const output = [];
let start = 0, size = 0;
while (start < __input.length) {
    __step();
    const newline = __input.indexOf('\\n', start);
    const end = newline === -1 ? __input.length : newline;
    const cr = end > start && __input[end - 1] === '\\r';
    const line = __input.slice(start, cr ? end - 1 : end);
    const result = line.trim() ? transform(line) : line;
    const delimiter = (cr ? '\\r' : '') + (newline === -1 ? '' : '\\n');
    size += result.length + delimiter.length;
    if (size > 16 * 1024 * 1024) throw new Error('JSONL output limit');
    output.push(result, delimiter);
    start = end + 1;
}
return output.join('');
})()
'''
runtime=prefix+source+suffix
assert ')DERPJSON"' not in runtime
header='// Generated from third_party/ublock-resources/jsonpath.js (GPL-3.0-or-later).\n#pragma once\nnamespace Web {\ninline constexpr auto derpbird_json_response_runtime = R"DERPJSON('+runtime+')DERPJSON"sv;\n}\n'
target = root/'native/WebContent/DerpBirdJSONResponseRuntime.h'
if not target.exists() or target.read_text() != header:
    target.write_text(header)
