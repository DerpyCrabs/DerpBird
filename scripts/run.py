#!/usr/bin/env python3
"""Launch the built DerpBird host with its own profile; never builds implicitly."""
import os
from pathlib import Path
import sys
from build_config import engine_build

root = Path(__file__).resolve().parents[1]
binary = engine_build() / 'bin/Ladybird'
if not binary.is_file():
    raise SystemExit('DerpBird engine is not built yet. Run bun run build:engine first.')
data_home = Path(os.environ.get('XDG_DATA_HOME', str(Path.home() / '.local/share')))
profile = Path(os.environ.get('DERPBIRD_PROFILE', str(data_home / 'derpbird/profile'))).expanduser().resolve()
os.environ['DERPBIRD_UI'] = '1'
os.execv(str(binary), [str(binary), '--profile-path', str(profile), *sys.argv[1:]])
