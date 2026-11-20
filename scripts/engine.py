#!/usr/bin/env python3
"""Run the pinned upstream build tool with correct submodule path handling."""
import importlib.util
import os
import subprocess
import sys
import tomllib
from pathlib import Path
from build_config import build_jobs

source = Path(__file__).resolve().parents[1] / 'vendor' / 'ladybird'
spec = importlib.util.spec_from_file_location('ladybird_build', source / 'Meta' / 'ladybird.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
# Upstream assumes every .git file is a worktree. Ours is a Git submodule;
# its shared build directory belongs beside its sources, not inside .git/modules.
module.find_main_ladybird_source_dir = lambda: source
os.environ.pop('BUILD_PRESET', None)
if any(arg == '--preset' or arg.startswith('--preset=') for arg in sys.argv[1:]):
    raise SystemExit('DerpBird builds Release only.')
os.environ['MAKEJOBS'] = str(build_jobs())
os.environ.setdefault('VCPKG_MAX_CONCURRENCY', os.environ['MAKEJOBS'])
os.environ.setdefault('DERPBIRD_DIRECT_DOWNLOADS', '1')

upstream_run_command = module.run_command


def run_command(command, *args, **kwargs):
    command = list(command)
    if command and command[0] == 'ninja' and os.environ.get('DERPBIRD_BUILD_KEEP_GOING') == '1':
        command[1:1] = ['-k', '0']
    return upstream_run_command(command, *args, **kwargs)


module.run_command = run_command
# A machine-wide RUSTUP_TOOLCHAIN override otherwise silently defeats the
# checked-in compiler pin (and can turn new deprecations into build errors).
toolchain = tomllib.loads((source / 'rust-toolchain.toml').read_text())
os.environ['RUSTUP_TOOLCHAIN'] = toolchain['toolchain']['channel']
# Complete rustup's first-use installation before Ninja starts concurrent Rust
# commands; otherwise one can observe another's partially installed toolchain.
subprocess.run(['rustc', '--version'], cwd=source, check=True)
module.main()
