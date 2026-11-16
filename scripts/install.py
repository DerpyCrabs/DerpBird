#!/usr/bin/env python3
"""Install a user launcher for this checkout's built browser (no rebuild or root)."""
import argparse
import os
from pathlib import Path
from build_config import engine_build
import stat

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--prefix', type=Path, default=Path.home() / '.local')
parser.add_argument('--uninstall', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
prefix = args.prefix.expanduser().resolve()
launcher = prefix / 'bin/derpbird'
desktop = prefix / 'share/applications/derpbird.desktop'
icon = prefix / 'share/icons/hicolor/scalable/apps/derpbird.svg'
if args.uninstall:
    for path in (launcher, desktop, icon):
        path.unlink(missing_ok=True)
    print('Removed DerpBird launcher; profiles and source files retained.')
    raise SystemExit
if not (engine_build() / 'bin/Ladybird').is_file():
    raise SystemExit('Build the engine first: bun run build:engine')
for path in (launcher, desktop, icon):
    path.parent.mkdir(parents=True, exist_ok=True)
launcher.write_text('#!/usr/bin/env python3\nimport os, sys\nos.environ["DERPBIRD_ENGINE_BUILD"] = ' + repr(str(engine_build())) + '\nos.execv(sys.executable, [sys.executable, ' + repr(str(root / 'scripts/run.py')) + ', *sys.argv[1:]])\n')
launcher.chmod(launcher.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
# Desktop-entry Exec quoting differs from shell quoting; percent is a field marker.
exe = str(launcher).replace('\\', '\\\\').replace('"', '\\"').replace('`', '\\`').replace('$', '\\$').replace('%', '%%')
desktop.write_text('[Desktop Entry]\nVersion=1.0\nType=Application\nName=DerpBird\nComment=Browse with Ladybird\nExec="' + exe + '" %U\nIcon=derpbird\nTerminal=false\nCategories=Network;WebBrowser;\nMimeType=text/html;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;\nStartupNotify=true\n')
icon.write_text((root / 'packaging/derpbird.svg').read_text())
print(f'Installed {desktop}\nLauncher: {launcher}\nKeep this checkout at {root}.')
