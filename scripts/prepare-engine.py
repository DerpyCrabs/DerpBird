#!/usr/bin/env python3
"""Apply the versioned DerpBird overlay to the pinned engine; never update upstream."""
from engine_overlay import apply_series
import os
import shutil
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = root / 'vendor/ladybird'
expected = '2919bf87a5e5dfc49a210a70bda079afa411c6c5'
actual = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
if actual != expected:
    raise SystemExit(f'Engine pin mismatch: expected {expected}, found {actual}')
apply_series(source, sorted((root / 'patches').glob('*.patch')))
subprocess.run(['python3', str(root / 'scripts/generate-json-response-runtime.py')], check=True)
for directory, destination in [('WebUI', 'Libraries/LibWebView/WebUI'), ('Qt', 'UI/Qt'), ('Tests', 'Tests/LibWebView'), ('EngineTests', 'Tests/LibWeb'), ('WebContent', 'Libraries/LibWeb/Page')]:
    for file in (root / 'native' / directory).glob('*'):
        target = source / destination / file.name
        if not target.exists() or target.read_bytes() != file.read_bytes():
            shutil.copyfile(file, target)
# The content-blocker fork is source-controlled, not a mutable Cargo cache.
blocker_source = root / 'third_party/adblock'
blocker_target = source / 'Libraries/LibWeb/ContentBlocker/Rust/adblock'
for directory, subdirectories, filenames in os.walk(blocker_source):
    subdirectories[:] = [name for name in subdirectories if name not in ('target', '.git')]
    for filename in filenames:
        file = Path(directory) / filename
        target = blocker_target / file.relative_to(blocker_source)
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or target.read_bytes() != file.read_bytes():
            shutil.copyfile(file, target)
subprocess.run(['python3', str(root / 'scripts/generate-blocker-resources.py')], check=True)
dist = root / 'dist'
if not (dist / 'index.html').is_file():
    raise SystemExit('Build the UI first: bun run build')
assets = source / 'Base/res/ladybird/about-pages/derpbird-assets'
assets.mkdir(exist_ok=True)
expected_assets = {file.name for file in (dist / 'assets').iterdir() if file.suffix != '.map'}
for file in (dist / 'assets').iterdir():
    if file.suffix == '.map':
        continue
    target = assets / file.name
    if not target.exists() or target.read_bytes() != file.read_bytes():
        shutil.copyfile(file, target)
html = (dist / 'index.html').read_text().replace('./assets/', 'resource://ladybird/about-pages/derpbird-assets/')
page = source / 'Base/res/ladybird/about-pages/derpbird.html'
if not page.exists() or page.read_text() != html:
    page.write_text(html)
print('DerpBird engine overlay and trusted UI resources prepared.')

# Only this generated directory is owned by DerpBird. Retire obsolete hashes.
for file in assets.iterdir():
    if file.is_file() and file.name not in expected_assets:
        file.unlink()

from ui_resources import sync_built_ui
sync_built_ui(root)
