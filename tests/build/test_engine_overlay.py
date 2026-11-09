"""Overlay upgrade/idempotency checks, including overlapping patch hunks."""
from pathlib import Path
import difflib
import importlib.util
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('engine_overlay', ROOT / 'scripts/engine_overlay.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SeriesTest(unittest.TestCase):
    def test_overlapping_upgrade_and_preservation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source'
            source.mkdir()
            subprocess.run(['git', 'init', '-q', str(source)], check=True)
            file = source / 'value.txt'
            file.write_text('original\n')
            subprocess.run(['git', '-C', str(source), 'add', '.'], check=True)
            subprocess.run(['git', '-C', str(source), '-c', 'user.name=Overlay Test', '-c', 'user.email=overlay@example.invalid', 'commit', '-qm', 'fixture'], check=True)
            patches = []
            for i, (old, new) in enumerate([('original\n', 'first\n'), ('first\n', 'second\n')]):
                patch = root / f'{i}.patch'
                patch.write_text(''.join(difflib.unified_diff([old], [new], fromfile='a/value.txt', tofile='b/value.txt')))
                patches.append(patch)
            self.assertEqual(module.apply_series(source, patches[:1]), 1)
            self.assertEqual(module.apply_series(source, patches), 1)
            self.assertEqual(file.read_text(), 'second\n')
            self.assertEqual(module.apply_series(source, patches), 0)
            file.write_text('local change\n')
            with self.assertRaises(RuntimeError):
                module.apply_series(source, patches)
            self.assertEqual(file.read_text(), 'local change\n')
            file.write_text('original\n')
            broken = root / 'broken.patch'
            broken.write_text(''.join(difflib.unified_diff(['not second\n'], ['broken\n'], fromfile='a/value.txt', tofile='b/value.txt')))
            with self.assertRaises(subprocess.CalledProcessError):
                module.apply_series(source, [*patches, broken])
            self.assertEqual(file.read_text(), 'original\n') # No partially applied prefix.
            file.unlink()
            file.symlink_to(root / 'elsewhere')
            with self.assertRaises(ValueError):
                module.apply_series(source, patches)


if __name__ == '__main__':
    unittest.main()
