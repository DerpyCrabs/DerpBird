#!/usr/bin/env python3
"""Deploy prepared UI resources to an existing checkout build; no engine rebuild."""
from pathlib import Path
from ui_resources import sync_built_ui

if not sync_built_ui(Path(__file__).resolve().parents[1]):
    raise SystemExit('Build Ladybird first: runtime resource directory does not exist.')
print('Built Ladybird UI resources match the prepared source.')
