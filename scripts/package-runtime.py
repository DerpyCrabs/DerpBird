#!/usr/bin/env python3
"""Stage the current engine build as a self-contained private runtime."""
import shutil
import subprocess
import sys
from pathlib import Path
from build_config import ROOT, engine_build

build = engine_build()
stage = Path(sys.argv[1]) / 'usr/lib/derpbird'
for directory in ('bin', 'lib', 'libexec'):
    (stage / directory).mkdir(parents=True, exist_ok=True)
shutil.copy2(build / 'bin/Ladybird', stage / 'bin/Ladybird')
shutil.copy2(ROOT / 'artifacts/package/derpbird-mcp', stage / 'bin/derpbird-mcp')
shutil.copy2(ROOT / 'artifacts/package/style-compiler.worker.js', stage / 'bin/style-compiler.worker.js')
shutil.copytree(build / 'libexec', stage / 'libexec', dirs_exist_ok=True)
shutil.copytree(build / 'share/Lagom', stage / 'share/Lagom', dirs_exist_ok=True)
triplet = build / 'vcpkg_installed/x64-linux-dynamic'
for directory in (triplet / 'lib', build / 'lib'):
    for path in directory.glob('*.so*'):
        target = stage / 'lib' / path.name
        if path.is_symlink():
            target.symlink_to(path.readlink().name)
        else:
            shutil.copy2(path, target)
# Every ELF owns its search path; no LD_LIBRARY_PATH leaks into external apps.
for directory in ('bin', 'lib', 'libexec'):
    for path in (stage / directory).iterdir():
        if path.is_symlink() or not path.is_file() or path.name == 'derpbird-mcp':
            continue
        with path.open('rb') as stream:
            if stream.read(4) != b'\x7fELF':
                continue
        subprocess.run(['patchelf', '--set-rpath', '$ORIGIN:$ORIGIN/../lib', str(path)], check=True)
licenses = Path(sys.argv[1]) / 'usr/share/licenses/derpbird'
licenses.mkdir(parents=True)
shutil.copy2(ROOT / 'vendor/ladybird/LICENSE', licenses / 'Ladybird')
for path in (triplet / 'share').glob('*/copyright'):
    shutil.copy2(path, licenses / path.parent.name)
for directory in ('third_party/usercss', 'third_party/adblock', 'third_party/ublock-resources'):
    for path in (ROOT / directory).glob('*LICENSE*'):
        shutil.copy2(path, licenses / (path.parent.name + '-' + path.name))

# Preserve notices from the JS packages included by the standalone MCP bundler.
for path in (ROOT / 'node_modules').rglob('*'):
    if path.is_file() and path.name.lower().startswith(('license', 'copying', 'notice')):
        relative = path.relative_to(ROOT / 'node_modules')
        destination = licenses / 'javascript' / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)
