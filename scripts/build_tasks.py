"""Dependency-aware build operations shared by the command-line workflows."""
import subprocess
import sys
import shutil
from build_config import ROOT, engine_build, build_jobs, native_build


def run(command):
    print('+ ' + ' '.join(map(str, command)), flush=True)
    subprocess.run(list(map(str, command)), cwd=ROOT, check=True)


def prepare():
    run(['bun', 'run', 'build'])
    run([sys.executable, 'scripts/prepare-engine.py'])


def build_engine(targets=('Ladybird',)):
    run([sys.executable, 'scripts/engine.py', 'build', '--jobs', build_jobs(), *targets])


def suite_sources():
    return sorted((ROOT / 'native/EngineTests').glob('Test*.cpp')) + sorted((ROOT / 'native/Tests').glob('Test*.cpp')) + [ROOT / 'vendor/ladybird/Tests/LibWeb/TestContentBlocker.cpp']


def suites_build():
    return ROOT / 'artifacts/engine-suites'


def configure_tests(source, directory, with_engine):
    command = ['cmake', '-S', ROOT / source, '-B', directory, '-G', 'Ninja']
    if cache := shutil.which('ccache'):
        command.append(f'-DCMAKE_CXX_COMPILER_LAUNCHER={cache}')
    if with_engine:
        if not (engine_build() / 'lib/liblagom-core.so').is_file():
            raise ValueError('Native suites require a Release engine build.')
        cache = (engine_build() / 'CMakeCache.txt').read_text()
        compiler = next(line.split('=', 1)[1] for line in cache.splitlines()
                        if line.startswith(('CMAKE_CXX_COMPILER:FILEPATH=', 'CMAKE_CXX_COMPILER:STRING=')))
        command += [f'-DDERPBIRD_ENGINE_BUILD={engine_build()}', f'-DCMAKE_CXX_COMPILER={compiler}']
    run(command)


def build_suites(names):
    unknown = set(names) - {source.stem for source in suite_sources()}
    if unknown:
        raise ValueError(f'Unknown suites: {sorted(unknown)}')
    prepare()
    build_engine(('Ladybird', 'LibTest'))
    configure_tests('tests/engine-native', suites_build(), True)
    run(['cmake', '--build', suites_build(), '--parallel', build_jobs(), '--target', *names])


def build_native(with_engine, targets=()):
    if with_engine:
        prepare()
        build_engine()
    directory = native_build(with_engine)
    configure_tests('tests/native', directory, with_engine)
    command = ['cmake', '--build', directory, '--parallel', build_jobs()]
    if targets:
        command += ['--target', *targets]
    run(command)
    return directory
