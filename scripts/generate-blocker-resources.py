#!/usr/bin/env python3
"""Build the embedded redirect resources from pinned, locally verified sources."""
import argparse
import base64
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--check', action='store_true')
args = parser.parse_args()

root = Path(__file__).resolve().parents[1]
source = root / 'third_party/ublock-resources'
entries = json.loads((source / 'index.json').read_text())
checksums = json.loads((source / 'SHA256SUMS.json').read_text())
mimes = {'.js': 'application/javascript', '.json': 'application/json',
         '.css': 'text/css', '.html': 'text/html', '.txt': 'text/plain',
         '.xml': 'text/xml', '.gif': 'image/gif', '.png': 'image/png',
         '.mp3': 'audio/mp3', '.mp4': 'video/mp4'}
resources = []
names = set()
for name, properties in entries:
    assert Path(name).name == name
    data = (source / 'resources' / name).read_bytes()
    assert hashlib.sha256(data).hexdigest() == checksums[name], name
    assert len(data) <= 1024 * 1024, name
    if properties.get('params'):
        assert name == 'click2load.html'
        data = (root / 'native/Resources/DerpBirdClickToLoad.html').read_bytes()
    aliases = properties.get('alias', [])
    if isinstance(aliases, str):
        aliases = [aliases]
    for identifier in [name, *aliases]:
        assert identifier not in names, identifier
        names.add(identifier)
    resources.append({'name': name, 'aliases': aliases,
                      'kind': {'mime': 'application/x-derpbird-click-to-load' if name == 'click2load.html' else mimes.get(Path(name).suffix, 'text/plain')},
                      'content': base64.b64encode(data).decode(),
                      'dependencies': [], 'permission': 0})
for manifest in ('SCRIPTLET_SHA256SUMS.json', 'PROCEDURAL_SHA256SUMS.json'):
    for name, digest in json.loads((source / manifest).read_text()).items():
        assert not Path(name).is_absolute() and '..' not in Path(name).parts
        assert hashlib.sha256((source / name).read_bytes()).hexdigest() == digest, name
scriptlets = json.loads((source / 'scriptlets.json').read_text())
selected = scriptlets
scriptlet_names = {entry['name'] for entry in selected}
for entry in selected:
    assert all(dependency in scriptlet_names for dependency in entry['dependencies']), entry['name']
    isolated = entry['world'] == 'ISOLATED'
    entry = {key: value for key, value in entry.items() if key != 'world'}
    entry['isolated'] = isolated
    for identifier in [entry['name'], *entry['aliases']]:
        assert identifier not in names, identifier
        names.add(identifier)
    resources.append(entry)
payload = json.dumps(resources, separators=(',', ':'), ensure_ascii=True)
assert len(payload) < 8 * 1024 * 1024
output = '// Generated from pinned uBlock Origin resources; see third_party/ublock-resources/LICENSE.txt.\n'
output += 'const DERPBIRD_REDIRECT_RESOURCES: &str = r###"' + payload + '"###;\n'
runtime = '\n'.join([
    (root / 'native/Resources/DerpBirdProceduralPrelude.js').read_text(),
    (source / 'procedural/contentscript-extra.js').read_text(),
    (root / 'native/Resources/DerpBirdProceduralAdapter.js').read_text(),
    (root / 'native/Resources/DerpBirdProceduralRuntime.js').read_text(),
])
assert '"####' not in runtime and len(runtime) < 256 * 1024
output += 'const DERPBIRD_PROCEDURAL_RUNTIME: &str = r####"' + runtime + '"####;\n'
html_runtime = '\n'.join([
    (root / 'native/Resources/DerpBirdHTMLPrelude.js').read_text(),
    (source / 'procedural/contentscript-extra.js').read_text(),
    (root / 'native/Resources/DerpBirdProceduralAdapter.js').read_text(),
    (root / 'native/Resources/DerpBirdHTMLRuntime.js').read_text(),
])
assert '"####' not in html_runtime and len(html_runtime) < 256 * 1024
output += 'const DERPBIRD_HTML_FILTER_RUNTIME: &str = r####"' + html_runtime + '"####;\n'
target = root / 'vendor/ladybird/Libraries/LibWeb/ContentBlocker/Rust/src/derpbird_resources.rs'
if not target.exists() or target.read_text() != output:
    if args.check:
        raise SystemExit('Embedded redirect resources are stale; run prepare-engine.py')
    target.write_text(output)
print(f'Prepared {len(resources)} blocker resources and {len(names)} names/aliases')
