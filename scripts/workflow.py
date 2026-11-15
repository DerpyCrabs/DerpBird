#!/usr/bin/env python3
"""Build the selected artifacts before running focused development checks."""
import argparse
import subprocess
import sys
from build_config import ROOT, build_jobs, engine_build, test_jobs
from build_tasks import build_engine, build_native, prepare, run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    build = commands.add_parser('build', help='Prepare and build the browser and its helpers')
    build.add_argument('targets', nargs='*', default=['Ladybird'])
    native = commands.add_parser('native', help='Build and test native units/integration')
    native.add_argument('--engine', action='store_true')
    native.add_argument('--fast', action='store_true', help='Exclude real-time timeout scenarios')
    native.add_argument('--filter', help='CTest name regular expression; an empty selection fails')
    commands.add_parser('fast', help='TypeScript, production bundle, DOM, worker, and Python checks')
    commands.add_parser('styles', help='Native style suite and real document fixtures')
    commands.add_parser('proxy', help='Native routing and real proxy network integration')
    commands.add_parser('doctor', help='Print selected build paths, concurrency and optional tools')
    args = parser.parse_args()
    if args.command == 'build':
        prepare()
        build_engine(args.targets)
    elif args.command == 'native':
        directory = build_native(args.engine)
        command = ['ctest', '--test-dir', directory, '--output-on-failure', '--no-tests=error',
                   '--parallel', test_jobs()]
        if args.fast:
            command += ['-LE', 'slow']
        if args.filter:
            command += ['-R', args.filter]
        run(command)
    elif args.command == 'fast':
        run(['bun', 'run', 'check'])
        run(['bun', 'run', 'test'])
        run(['bun', 'run', 'build'])
        run([sys.executable, 'scripts/prepare-engine.py'])
        run(['bun', 'scripts/check-ui.ts'])
        run(['bun', 'scripts/test-style-worker.ts'])
        run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests/build', '-v'])
        run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests/rendering', '-v'])
    elif args.command == 'styles':
        run([sys.executable, 'scripts/test-native-regressions.py', '--suite', 'TestDerpBirdStyles'])
        build_engine(('test-web',))
        run([sys.executable, 'scripts/test-document-styles.py'])
    elif args.command == 'proxy':
        directory = build_native(True, ('test-proxy-routing',))
        run(['ctest', '--test-dir', directory, '--output-on-failure', '--no-tests=error', '-R', '^proxy-routing$'])
        run([sys.executable, 'scripts/test-proxy-switcher.py'])
    else:
        import shutil
        print(f'Engine: {engine_build()}\nBuild jobs: {build_jobs()}\nTest jobs: {test_jobs()}')
        for tool in ('bun', 'cmake', 'ninja', 'ccache', 'sccache', 'ld.lld', 'ld.mold'):
            print(f'{tool}: {shutil.which(tool) or "not installed"}')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error))
