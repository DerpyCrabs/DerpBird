#!/usr/bin/env python3
"""Run every DerpBird native case and upstream blocker regressions.

Build the targets first. Reject missing suites/cases instead of accepting an
empty successful selection. Each suite has an isolated process group and a bounded runtime.
"""
import argparse
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--suite', action='append', help='Run an exact suite name; repeat for several changed suites')
parser.add_argument('--timeout', type=float, default=180, help='Seconds per suite')
parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/native-regressions')
args = parser.parse_args()
if args.timeout <= 0:
    parser.error('--timeout must be positive')
args.output.mkdir(parents=True, exist_ok=True)
engine = ROOT / 'vendor/ladybird'
report = {'revision': subprocess.check_output(['git', '-C', str(engine), 'rev-parse', 'HEAD'], text=True).strip(), 'suites': []}

def run(command):
    process = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               text=True, start_new_session=True)
    try:
        output, _ = process.communicate(timeout=args.timeout)
        return process.returncode, output
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            output, _ = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            output, _ = process.communicate()
        return 124, output + '\nSuite exceeded its time limit.\n'

sources = [(engine / 'Build/release/bin/TestLibWeb', file) for file in sorted((ROOT / 'native/EngineTests').glob('Test*.cpp'))]
sources += [(engine / 'Build/release/bin/TestLibWebView', file) for file in sorted((ROOT / 'native/Tests').glob('Test*.cpp'))]
sources += [(engine / 'Build/release/bin/TestLibWeb', engine / 'Tests/LibWeb/TestContentBlocker.cpp')]
if args.suite:
    unknown = set(args.suite) - {source.stem for _, source in sources}
    if unknown:
        parser.error(f'Unknown suites: {sorted(unknown)}')
    sources = [(binary, source) for binary, source in sources if source.stem in args.suite]
failures = []
try:
    for binary, source in sources:
        expected = re.findall(r'^TEST_CASE\((\w+)\)', source.read_text(), re.M)
        if not expected:
            raise RuntimeError(f'No test cases found in {source}')
        command = [str(binary), '--tests', '--suite', source.stem]
        code, listing = run(command + ['--list'])
        available = re.findall(r'^\s*' + re.escape(source.stem) + r'::(\w+)\s*$', listing, re.M)
        if code or sorted(available) != sorted(expected):
            (args.output / f'{source.stem}.list.log').write_text(listing)
            error = f'{source.stem}: compiled cases differ from source: expected {expected}, found {available}'
            failures.append(error)
            report['suites'].append({'suite': source.stem, 'cases': expected, 'executed': [], 'passed': False, 'error': error})
            print(error, flush=True)
            continue
        started = time.monotonic()
        code, output = run(command)
        elapsed = time.monotonic() - started
        (args.output / f'{source.stem}.log').write_text(output)
        executed = re.findall(r"Running test '(\w+)'\.", output)
        passed = code == 0 and sorted(executed) == sorted(expected)
        report['suites'].append({'suite': source.stem, 'cases': expected, 'executed': executed,
                                 'exit_code': code, 'seconds': elapsed, 'passed': passed})
        print(f'{source.stem}: {"PASS" if passed else "FAIL"}, {len(executed)}/{len(expected)} cases, {elapsed:.2f}s', flush=True)
        if not passed:
            failures.append(f'{source.stem}: see {args.output / (source.stem + ".log")}')
    report['passed'] = not failures
    report['failures'] = failures
except (RuntimeError, OSError) as error:
    report['passed'] = False
    report['error'] = str(error)
    print(error, flush=True)
finally:
    (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
raise SystemExit(0 if report['passed'] else 1)
