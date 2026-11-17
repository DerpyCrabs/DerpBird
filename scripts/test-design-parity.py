#!/usr/bin/env python3
"""Compare two settled DerpDesign snapshots without tolerating visual drift."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageChops

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('baseline', type=Path)
parser.add_argument('actual', type=Path)
parser.add_argument('--report', type=Path, required=True)
args = parser.parse_args()
expected = sorted(args.baseline.glob('pane-*.png'))
assert expected, 'Baseline has no pane captures'
assert {p.name for p in expected} == {p.name for p in args.actual.glob('pane-*.png')}, 'Pane sets differ'
results = []
for source in expected:
    before = Image.open(source).convert('RGBA')
    after = Image.open(args.actual / source.name).convert('RGBA')
    same_size = before.size == after.size
    bounds = ImageChops.difference(before, after).convert('RGB').getbbox() if same_size else None
    # Compare alpha separately so transparent-color differences cannot hide.
    alpha = ImageChops.difference(before.getchannel('A'), after.getchannel('A')).getbbox() if same_size else None
    results.append({'pane': source.name, 'identical': same_size and bounds is None and alpha is None, 'differenceBounds': bounds, 'alphaDifferenceBounds': alpha, 'size': after.size})
report = {'passed': all(item['identical'] for item in results), 'baseline': str(args.baseline.resolve()), 'actual': str(args.actual.resolve()), 'panes': results}
args.report.write_text(json.dumps(report, indent=2) + '\n')
print(f"{sum(item['identical'] for item in results)}/{len(results)} panes pixel-identical")
raise SystemExit(0 if report['passed'] else 1)
