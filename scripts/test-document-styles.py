#!/usr/bin/env python3
"""Run DerpBird document fixtures with the built Ladybird test-web engine."""
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
engine = root / 'vendor/ladybird'
artifacts = root / 'artifacts'
artifacts.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='document-styles-', dir=artifacts) as temporary:
    suite = Path(temporary)
    for directory in ('Accessibility', 'Layout', 'Text', 'Ref', 'Screenshot'):
        for kind in ('input', 'expected'):
            (suite / directory / kind).mkdir(parents=True)
    (suite / 'Crash').mkdir()
    (suite / 'Text/input/wpt-import').mkdir()
    shutil.copytree(engine / 'Tests/LibWeb/Text/input/wpt-import/_wpttools',
                    suite / 'Text/input/wpt-import/_wpttools')
    (suite / 'TestConfig.ini').write_text('')
    for name in ('Fixtures/http-test-server.py', 'test-web/results-index.html', 'Text/input/include.js'):
        target = suite / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(engine / 'Tests/LibWeb' / name, target)
    for kind in ('input', 'expected', 'data'):
        shutil.copytree(root / 'tests/engine' / kind, suite / 'Text' / kind, dirs_exist_ok=True)
    result = subprocess.run([
        str(engine / 'Build/release/bin/test-web'), '--test-path', str(suite),
        '--results-dir', str(artifacts / 'document-style-results'),
        '--test-concurrency', '1', '--per-test-timeout', '30', '--verify-style',
    ], cwd=root)
    raise SystemExit(result.returncode)
