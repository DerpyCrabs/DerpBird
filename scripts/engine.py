#!/usr/bin/env python3
"""Run the pinned upstream build tool with correct submodule path handling."""
import importlib.util
import os
import subprocess
import tomllib
from pathlib import Path

source = Path(__file__).resolve().parents[1] / 'vendor' / 'ladybird'
spec = importlib.util.spec_from_file_location('ladybird_build', source / 'Meta' / 'ladybird.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
# Upstream assumes every .git file is a worktree. Ours is a Git submodule;
# its shared build directory belongs beside its sources, not inside .git/modules.
module.find_main_ladybird_source_dir = lambda: source
os.environ.setdefault('DERPBIRD_DIRECT_DOWNLOADS', '1')
# A machine-wide RUSTUP_TOOLCHAIN override otherwise silently defeats the
# checked-in compiler pin (and can turn new deprecations into build errors).
toolchain = tomllib.loads((source / 'rust-toolchain.toml').read_text())
os.environ['RUSTUP_TOOLCHAIN'] = toolchain['toolchain']['channel']
# Complete rustup's first-use installation before Ninja starts concurrent Rust
# commands; otherwise one can observe another's partially installed toolchain.
subprocess.run(['rustc', '--version'], cwd=source, check=True)
# Qualification can collect independent compiler failures in one build while
# retaining the upstream configuration, toolchain and dependency handling.
if os.environ.get('DERPBIRD_BUILD_KEEP_GOING') == '1':
    upstream_run_command = module.run_command

    def run_command_collect_errors(command, *args, **kwargs):
        if command and command[0] == 'ninja':
            command = [command[0], '-k', '0', *command[1:]]
        return upstream_run_command(command, *args, **kwargs)

    module.run_command = run_command_collect_errors

module.main()
