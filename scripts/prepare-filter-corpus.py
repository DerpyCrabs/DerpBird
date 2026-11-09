#!/usr/bin/env python3
"""Build deterministic requests from immutable full EasyList/EasyPrivacy snapshots.

This covers hostname rules, controls and domain exceptions, not full uBO parity.
The native runner loads both complete lists, not only the sampled rules.
"""
import hashlib
import json
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1] / 'artifacts/compatibility-corpus'
manifest = {item['file']: item for item in json.loads((root / 'manifest.json').read_text())}
lists, cases = [], []
source = 'https://news.corpus.invalid/article'
for filename in ('easylist.txt', 'easyprivacy.txt'):
    data = (root / filename).read_bytes()
    if hashlib.sha256(data).hexdigest() != manifest[filename]['sha256']:
        raise SystemExit(f'Snapshot hash mismatch: {filename}')
    text = data.decode('utf-8')
    lists.append({'name': filename, 'trusted': False, 'user_owned': False, 'text': text})
    rules = [(line, rule, re.fullmatch(r'\|\|([a-z0-9.-]+)\^', rule))
             for line, rule in enumerate(text.splitlines(), 1)]
    rules = [(line, rule, match[1]) for line, rule, match in rules if match]
    if len(rules) < 256:
        raise SystemExit(f'Unexpectedly small hostname rule corpus: {filename}')
    for index in range(256):
        line, rule, host = rules[index * len(rules) // 256]
        cases.append({'url': f'https://{host}/resource.js', 'source': source,
                      'type': 'script', 'blocked': True, 'list': filename, 'line': line, 'rule': rule})
for index in range(128):
    cases.append({'url': f'https://control-{index}.corpus.invalid/resource.js',
                  'source': source, 'type': 'script', 'blocked': False, 'rule': 'negative control'})
for host, kind, exception in (
    ('js-agent.newrelic.com', 'script', '@@||js-agent.newrelic.com^$script,domain=abema.tv'),
    ('bam.nr-data.net', 'xhr', '@@||bam.nr-data.net^$xmlhttprequest,domain=abema.tv'),
):
    if exception not in lists[1]['text'].splitlines():
        raise SystemExit('Expected explicit corpus exception missing')
    for page, blocked in ((source, True), ('https://abema.tv/', False)):
        cases.append({'url': f'https://{host}/resource.js', 'source': page,
                      'type': kind, 'blocked': blocked, 'rule': exception})
(root / 'filter-bundle.json').write_text(json.dumps({'derpbirdFilterBundle': 1, 'lists': lists}))
(root / 'filter-requests.json').write_text(json.dumps(cases, indent=2))
print(f'Prepared both full lists and {len(cases)} request expectations; snapshot hashes verified.')
