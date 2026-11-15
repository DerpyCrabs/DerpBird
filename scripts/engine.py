#!/usr/bin/env python3
"""Run the pinned upstream build tool with correct submodule path handling."""
import importlib.util
import os
import subprocess
import tomllib
from pathlib import Path
from build_config import PRESET_DIRECTORIES, build_jobs, build_preset, engine_build

source = Path(__file__).resolve().parents[1] / 'vendor' / 'ladybird'
spec = importlib.util.spec_from_file_location('ladybird_build', source / 'Meta' / 'ladybird.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
# Upstream assumes every .git file is a worktree. Ours is a Git submodule;
# its shared build directory belongs beside its sources, not inside .git/modules.
module.find_main_ladybird_source_dir = lambda: source
os.environ['BUILD_PRESET'] = build_preset()
os.environ['MAKEJOBS'] = str(build_jobs())
os.environ.setdefault('VCPKG_MAX_CONCURRENCY', os.environ['MAKEJOBS'])
os.environ.setdefault('DERPBIRD_DIRECT_DOWNLOADS', '1')

# Reuse upstream dependency/toolchain setup, including Release dependencies for
# the lighter Dev configuration. Keep build, run and tests on one selected path.
upstream_build_env = module.configure_build_env


def configure_build_env(platform, preset, jobs=None):
    _, dependencies = upstream_build_env(platform, 'Release' if preset == 'Dev' else preset, jobs)
    if preset not in PRESET_DIRECTORIES:
        raise ValueError(f'Unknown build preset: {preset}')
    directory = engine_build() if os.environ.get('DERPBIRD_ENGINE_BUILD') else source / 'Build' / PRESET_DIRECTORIES[preset]
    return directory, dependencies


module.configure_build_env = configure_build_env
upstream_run_command = module.run_command


def configuration_options(preset):
    if preset == 'Dev':
        # A custom configuration avoids upstream appending -O2 or -ggdb3 after
        # our flags. Preserve the optimized configuration for performance tests.
        return ['-DCMAKE_BUILD_TYPE=DerpBirdDev', '-DCMAKE_CXX_FLAGS_DERPBIRDDEV=-Og -g1',
                '-DCMAKE_C_FLAGS_DERPBIRDDEV=-Og -g1', '-DENABLE_LTO_FOR_RELEASE=OFF']
    return []


def run_command(command, *args, **kwargs):
    command = list(command)
    if command and command[0] == 'cmake' and '--preset' in command:
        position = command.index('--preset') + 1
        preset = command[position]
        if preset == 'Dev':
            command[position] = 'Release'
        command.extend(configuration_options(preset))
    if command and command[0] == 'ninja' and os.environ.get('DERPBIRD_BUILD_KEEP_GOING') == '1':
        command[1:1] = ['-k', '0']
    return upstream_run_command(command, *args, **kwargs)


module.run_command = run_command
upstream_configure = module.configure_main


def configure_main(platform, preset, cc, cxx, jobs):
    directory = upstream_configure(platform, preset, cc, cxx, jobs)
    # Refuse to reuse a differently configured custom directory silently.
    cache = (directory / 'CMakeCache.txt').read_text()
    expected = {'Dev': 'DerpBirdDev', 'Release': 'RelWithDebInfo', 'Debug': 'Debug',
                'All_Debug': 'Debug', 'Sanitizer': 'RelWithDebInfo', 'ThreadSanitizer': 'RelWithDebInfo',
                'Distribution': 'Release', 'Fuzzers': 'RelWithDebInfo'}[preset]
    if f'CMAKE_BUILD_TYPE:STRING={expected}\n' not in cache:
        raise SystemExit(f'{directory} does not use {expected}; choose a separate DERPBIRD_ENGINE_BUILD directory.')
    return directory


module.configure_main = configure_main
# A machine-wide RUSTUP_TOOLCHAIN override otherwise silently defeats the
# checked-in compiler pin (and can turn new deprecations into build errors).
toolchain = tomllib.loads((source / 'rust-toolchain.toml').read_text())
os.environ['RUSTUP_TOOLCHAIN'] = toolchain['toolchain']['channel']
# Complete rustup's first-use installation before Ninja starts concurrent Rust
# commands; otherwise one can observe another's partially installed toolchain.
subprocess.run(['rustc', '--version'], cwd=source, check=True)
module.main()
