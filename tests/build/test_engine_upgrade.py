"""Exercise engine migration against real Git trees and unrelated user files."""
import subprocess
import tempfile
import unittest
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[2]

class UpgradeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'scripts').mkdir()
        for name in ['update-engine.py', 'engine_overlay.py']:
            shutil.copyfile(ROOT / 'scripts' / name, self.root / 'scripts' / name)
        self.source = self.root / 'vendor/ladybird'
        self.source.mkdir(parents=True)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Test')
        self.git('config', 'user.email', 'test@example.invalid')
        (self.source / 'file').write_text('before\nanchor\nafter\n')
        (self.source / 'other').write_text('original\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'base')
        self.old = self.git('rev-parse', 'HEAD').strip()
        (self.source / 'other').write_text('upstream\n')
        self.git('commit', '-qam', 'upstream')
        self.new = self.git('rev-parse', 'HEAD').strip()
        self.git('checkout', '--detach', self.old)
        self.patches = self.root / 'patches'
        self.patches.mkdir()
        patch = self.patches / '0001.patch'
        patch.write_text('--- a/file\n+++ b/file\n@@ -1,3 +1,4 @@\n before\n anchor\n+overlay\n after\n')
        self.git('apply', str(patch))
        (self.source / 'user-notes').write_text('keep me\n')

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.source), *args], text=True, stderr=subprocess.DEVNULL)

    def upgrade(self):
        return subprocess.run(['python3', str(self.root / 'scripts/update-engine.py'), self.new,
                               '--old-patches', str(self.patches), '--new-patches', str(self.patches)],
                              capture_output=True, text=True)

    def test_upgrade_preserves_overlay_and_unrelated_files(self):
        result = self.upgrade()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.git('rev-parse', 'HEAD').strip(), self.new)
        self.assertEqual((self.source / 'file').read_text(), 'before\nanchor\noverlay\nafter\n')
        self.assertEqual((self.source / 'other').read_text(), 'upstream\n')
        self.assertEqual((self.source / 'user-notes').read_text(), 'keep me\n')
        self.assertTrue(list((self.root / 'artifacts').glob('*.tar.gz')))

    def test_unrelated_tracked_edit_aborts_without_losing_it(self):
        (self.source / 'other').write_text('user edit\n')
        result = self.upgrade()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Unowned tracked changes', result.stderr)
        self.assertEqual(self.git('rev-parse', 'HEAD').strip(), self.old)
        self.assertEqual((self.source / 'other').read_text(), 'user edit\n')

    def test_modified_overlay_aborts_without_losing_it(self):
        (self.source / 'file').write_text('user changed the overlay\n')
        result = self.upgrade()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.git('rev-parse', 'HEAD').strip(), self.old)
        self.assertEqual((self.source / 'file').read_text(), 'user changed the overlay\n')
