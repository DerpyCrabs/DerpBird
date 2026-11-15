"""Verify synchronized working sources and idempotent preparation."""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]
ENGINE = ROOT / 'vendor/ladybird'


class EngineSourceTest(unittest.TestCase):
    @unittest.skipUnless((ROOT / 'dist/index.html').is_file(), 'Build the UI before testing preparation')
    def test_preparation_is_idempotent(self):
        def status(path):
            return subprocess.check_output(['git', '-C', str(path), 'status', '--porcelain', '--untracked-files=all'])
        subprocess.run(['python3', str(ROOT / 'scripts/prepare-engine.py')], check=True, capture_output=True)
        before = (status(ROOT), status(ENGINE))
        generated = ROOT / 'native/WebContent/DerpBirdJSONResponseRuntime.h'
        modified = generated.stat().st_mtime_ns
        subprocess.run(['python3', str(ROOT / 'scripts/prepare-engine.py')], check=True, capture_output=True)
        self.assertEqual((status(ROOT), status(ENGINE)), before,
                         'A second preparation must not alter the synchronized working tree')
        self.assertEqual(generated.stat().st_mtime_ns, modified,
                         'Unchanged generated headers must preserve timestamps')

    def test_deployed_content_blocker_dependency_matches_source(self):
        source = ROOT / 'third_party/adblock'
        deployed = ENGINE / 'Libraries/LibWeb/ContentBlocker/Rust/adblock'
        for file in source.rglob('*'):
            if 'target' not in file.relative_to(source).parts and '.git' not in file.relative_to(source).parts and file.is_file():
                self.assertEqual(file.read_bytes(), (deployed / file.relative_to(source)).read_bytes(), str(file))

    def test_embedded_redirect_resources_are_verified_and_current(self):
        subprocess.run(['python3', str(ROOT / 'scripts/generate-blocker-resources.py'), '--check'],
                       check=True, capture_output=True)

    def test_deployed_native_files_match_source(self):
        for directory, destination in [('HTTP', 'Libraries/LibHTTP'), ('WebUI', 'Libraries/LibWebView/WebUI'), ('Qt', 'UI/Qt'), ('Tests', 'Tests/LibWebView'), ('EngineTests', 'Tests/LibWeb'), ('WebContent', 'Libraries/LibWeb/Page')]:
            for source in (ROOT / 'native' / directory).glob('*'):
                self.assertEqual(source.read_bytes(), (ENGINE / destination / source.name).read_bytes(), str(source))


if __name__ == '__main__':
    unittest.main()
