#!/usr/bin/env python3
"""Build and run selected DerpBird engine suites in isolated, bounded processes."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import time

from build_config import ROOT, ENGINE, engine_build, test_jobs
from build_tasks import build_suites, suite_sources, suites_build


def run(command, timeout):
    environment = dict(os.environ, LADYBIRD_SOURCE_DIR=str(ENGINE))
    process = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               text=True, start_new_session=True, env=environment)
    try:
        output, _ = process.communicate(timeout=timeout)
        return process.returncode, output
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            output, _ = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            output, _ = process.communicate()
        return 124, output + '\nSuite exceeded its time limit.\n'
    finally:
        # A crashing test must not leave helper processes using its fixtures.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def run_suite(source, output_directory, timeout):
    expected = re.findall(r'^TEST_CASE\((\w+)\)', source.read_text(), re.M)
    result = {'suite': source.stem, 'cases': expected, 'executed': [], 'passed': False}
    try:
        if not expected:
            raise RuntimeError(f'No test cases found in {source}')
        command = [str(suites_build() / source.stem), '--suite', source.stem]
        code, listing = run(command + ['--list'], timeout)
        available = re.findall(r'^\s*' + re.escape(source.stem) + r'::(\w+)\s*$', listing, re.M)
        if code or sorted(available) != sorted(expected):
            (output_directory / f'{source.stem}.list.log').write_text(listing)
            raise RuntimeError(f'Compiled cases differ from source: expected {expected}, found {available}')
        started = time.monotonic()
        code, output = run(command, timeout)
        (output_directory / f'{source.stem}.log').write_text(output)
        executed = re.findall(r"Running test '(\w+)'\.", output)
        result.update(executed=executed, exit_code=code, seconds=time.monotonic() - started,
                      passed=code == 0 and sorted(executed) == sorted(expected))
    except (RuntimeError, OSError) as error:
        result['error'] = str(error)
    print(f'{source.stem}: {"PASS" if result["passed"] else "FAIL"}, '
          f'{len(result["executed"])}/{len(expected)} cases, {result.get("seconds", 0):.2f}s', flush=True)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--suite', action='append', help='Exact suite name; repeat to select multiple suites')
    parser.add_argument('--timeout', type=float, default=180, help='Seconds per suite')
    parser.add_argument('--jobs', type=int, default=test_jobs())
    parser.add_argument('--output', type=Path)
    parser.add_argument('--no-build', action='store_true', help='Explicitly use existing binaries (diagnostics only)')
    args = parser.parse_args()
    if args.timeout <= 0 or args.jobs <= 0:
        parser.error('--timeout and --jobs must be positive')
    sources = suite_sources()
    if args.suite:
        unknown = set(args.suite) - {source.stem for source in sources}
        if unknown:
            parser.error(f'Unknown suites: {sorted(unknown)}')
        sources = [source for source in sources if source.stem in args.suite]
    if not args.no_build:
        build_suites([source.stem for source in sources])
    # Unique defaults allow simultaneous focused test runs without clobbering evidence.
    import tempfile
    (ROOT / 'artifacts').mkdir(exist_ok=True)
    output = args.output or Path(tempfile.mkdtemp(prefix='native-regressions-', dir=ROOT / 'artifacts'))
    output.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        results = list(pool.map(lambda source: run_suite(source, output, args.timeout), sources))
    report = {'revision': subprocess.check_output(['git', '-C', str(ENGINE), 'rev-parse', 'HEAD'], text=True).strip(),
              'engine_build': str(engine_build()), 'suites': results, 'passed': all(result['passed'] for result in results)}
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'Report: {output / "report.json"}', flush=True)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error))
