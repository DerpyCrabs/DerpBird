import sys
import tempfile
import unittest
import os
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from ui_resources import resource_directories, sync_built_ui, verify_built_ui


class UIResourcesTest(unittest.TestCase):
    def setUp(self):
        # These fixtures must never deploy into an explicitly selected real build.
        environment = patch.dict(os.environ, {}, clear=True)
        environment.start()
        self.addCleanup(environment.stop)

    def test_stale_runtime_is_rejected_and_sync_preserves_unrelated_resources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, target = resource_directories(root)
            for path in [source, target]:
                (path / 'derpbird-assets').mkdir(parents=True)
            (source / 'derpbird.html').write_text('new.js')
            (source / 'derpbird-assets/new.js').write_text('current')
            (target / 'derpbird.html').write_text('old.js')
            (target / 'derpbird-assets/old.js').write_text('obsolete')
            (target / 'welcome.html').write_text('upstream')
            with self.assertRaisesRegex(RuntimeError, 'stale'):
                verify_built_ui(root)
            self.assertTrue(sync_built_ui(root))
            verify_built_ui(root)
            self.assertFalse((target / 'derpbird-assets/old.js').exists())
            self.assertEqual((target / 'welcome.html').read_text(), 'upstream')
            (target / 'derpbird-assets/new.js').write_text('changed')
            with self.assertRaisesRegex(RuntimeError, 'stale'):
                verify_built_ui(root)

    def test_first_build_is_not_created_implicitly(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertFalse(sync_built_ui(Path(directory)))
