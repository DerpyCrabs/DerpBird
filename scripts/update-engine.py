#!/usr/bin/env python3
"""Move the engine pin while preserving and validating the owned overlay.

Run only with no build/browser using this source directory. Both patch series
must be available; unrelated tracked edits cause an abort, never a reset.
"""
import argparse
from pathlib import Path
import subprocess
import tempfile
import tarfile
from engine_overlay import apply_series

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('revision')
parser.add_argument('--old-patches', type=Path, required=True)
parser.add_argument('--new-patches', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
source = root / 'vendor/ladybird'
def git(*arguments, **kwargs):
    return subprocess.check_output(['git', '-C', str(source), *arguments], **kwargs)
old = git('rev-parse', 'HEAD').decode().strip()
new = git('rev-parse', f'{args.revision}^{{commit}}').decode().strip()
old_patches = sorted(args.old_patches.resolve().glob('*.patch'))
new_patches = sorted(args.new_patches.resolve().glob('*.patch'))
if not old_patches or not new_patches:
    raise SystemExit('Both patch series must be nonempty')
if git('diff', '--cached', '--name-only'):
    raise SystemExit('Engine index has staged changes; preserving them')
apply_series(source, old_patches)
paths = set()
old_paths = set()
for patch in old_patches + new_patches:
    for line in patch.read_text().splitlines():
        if line.startswith(('--- a/', '+++ b/')):
            paths.add(line[6:])
            if patch in old_patches:
                old_paths.add(line[6:])
modified = set(git('diff', '--name-only').decode().splitlines())
if modified - old_paths:
    raise SystemExit(f'Unowned tracked changes: {sorted(modified - old_paths)}')
for path in paths - old_paths:
    if (source / path).exists() and not git("ls-files", "--", path):
        raise SystemExit(f"Unowned file would be replaced: {path}")
# Prove the new series before touching the live checkout.
with tempfile.TemporaryDirectory(prefix='derpbird-upgrade-') as directory:
    shadow = Path(directory)
    subprocess.run(['git', 'init', '-q', str(shadow)], check=True)
    originals = set(); introduced = set()
    for patch in new_patches:
        previous = ''
        for line in patch.read_text().splitlines():
            if line.startswith('--- a/') and line[6:] not in introduced:
                originals.add(line[6:])
            if line.startswith('+++ b/') and previous == '--- /dev/null':
                introduced.add(line[6:])
            previous = line
    for path in originals:
        target = shadow / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(git('show', f'{new}:{path}'))
    for patch in new_patches:
        subprocess.run(['git', '-C', str(shadow), 'apply', str(patch)], check=True)
tracked = set(git('ls-files').decode().splitlines())
owned_untracked = {path: (source / path).read_bytes() for path in paths - tracked if (source / path).is_file()}
diff = git('diff', '--binary')
backup = root / 'artifacts' / f'engine-before-{new[:12]}.patch'
backup.parent.mkdir(exist_ok=True)
backup.write_bytes(diff)
# Preserve patch-introduced files too: Git's tracked diff does not contain them.
with tarfile.open(backup.with_suffix('.tar.gz'), 'w:gz') as archive:
    for path in owned_untracked:
        archive.add(source / path, arcname=path)
    for patch in old_patches:
        archive.add(patch, arcname=f'old-patches/{patch.name}')
backup.with_suffix('.revision').write_text(old + '\n')
try:
    if diff:
        subprocess.run(['git', '-C', str(source), 'apply', '--reverse', '-'], input=diff, check=True)
    for path in owned_untracked:
        (source / path).unlink()
    subprocess.run(['git', '-C', str(source), 'checkout', '--detach', new], check=True)
    apply_series(source, new_patches)
except BaseException:
    # Checkout/apply errors are left explicit; never reset unknown live changes.
    raise SystemExit(f'Upgrade interrupted. Original revision {old}; tracked backup {backup}. Do not build until resolved.')
print(f'Engine updated: {old} -> {new}; {len(new_patches)} patches applied')
