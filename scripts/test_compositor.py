"""Locate a test compositor without depending on a developer's temporary files."""
import os
from pathlib import Path
import shutil


def sway_executable():
    requested = os.environ.get('DERPBIRD_TEST_SWAY', 'sway')
    resolved = shutil.which(os.path.expanduser(requested))
    if not resolved:
        raise FileNotFoundError('Install sway on PATH or set DERPBIRD_TEST_SWAY to its executable')
    return Path(resolved).resolve()
