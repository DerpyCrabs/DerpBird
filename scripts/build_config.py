"""Shared configuration for building, launching and testing the same engine."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / 'vendor/ladybird'
PRESET_DIRECTORIES = {
    'Release': 'release', 'Dev': 'dev', 'Debug': 'debug',
    'Sanitizer': 'sanitizer', 'ThreadSanitizer': 'tsan',
    'All_Debug': 'alldebug', 'Distribution': 'distribution', 'Fuzzers': 'fuzzers',
}


def build_preset():
    preset = os.environ.get('DERPBIRD_BUILD_PRESET', os.environ.get('BUILD_PRESET', 'Release'))
    if preset not in PRESET_DIRECTORIES:
        raise ValueError(f'Unknown engine preset {preset!r}; choose from {", ".join(PRESET_DIRECTORIES)}')
    return preset


def engine_build(root=ROOT):
    override = os.environ.get('DERPBIRD_ENGINE_BUILD')
    if override:
        path = Path(override).expanduser()
        return (path if path.is_absolute() else root / path).resolve()
    return root / 'vendor/ladybird/Build' / PRESET_DIRECTORIES[build_preset()]


def positive_integer(value, name):
    try:
        number = int(value)
        if number > 0:
            return number
    except (TypeError, ValueError):
        pass
    raise ValueError(f'{name} must be a positive integer, got {value!r}')


def build_jobs():
    override = os.environ.get('DERPBIRD_BUILD_JOBS', os.environ.get('MAKEJOBS'))
    if override is not None:
        return positive_integer(override, 'DERPBIRD_BUILD_JOBS / MAKEJOBS')
    # Eight jobs was measured on a 24-thread/64-GB host. Bound smaller hosts by
    # both their CPU allocation and available memory (large C++ TUs use >1 GB).
    cpus = len(os.sched_getaffinity(0)) if hasattr(os, 'sched_getaffinity') else os.cpu_count() or 1
    memory_jobs = 8
    try:
        available = next(int(line.split()[1]) for line in Path('/proc/meminfo').read_text().splitlines()
                         if line.startswith('MemAvailable:'))
        memory_jobs = max(1, available // (2 * 1024 * 1024))
    except (OSError, StopIteration):
        pass
    return max(1, min(8, cpus, memory_jobs))


def test_jobs():
    return positive_integer(os.environ.get('DERPBIRD_TEST_JOBS', min(4, build_jobs())), 'DERPBIRD_TEST_JOBS')


def native_build(engine=False):
    if not engine:
        return ROOT / 'artifacts/native-tests'
    # Custom engine directories must never reuse a native build linked to another engine.
    import hashlib
    selected = engine_build()
    default = ROOT / 'vendor/ladybird/Build/release'
    suffix = '' if selected == default else '-' + hashlib.sha256(str(selected).encode()).hexdigest()[:10]
    return ROOT / f'artifacts/native-engine-tests{suffix}'
