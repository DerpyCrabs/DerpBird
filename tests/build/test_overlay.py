"""Verify the committed engine fork and its generated resources."""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]
ENGINE = ROOT / 'vendor/ladybird'


class EngineSourceTest(unittest.TestCase):
    @unittest.skipUnless((ROOT / 'dist/index.html').is_file(), 'Build the UI before testing preparation')
    def test_preparation_preserves_git_state(self):
        def status(path):
            return subprocess.check_output(['git', '-C', str(path), 'status', '--porcelain', '--untracked-files=all'])
        before = (status(ROOT), status(ENGINE))
        subprocess.run(['python3', str(ROOT / 'scripts/prepare-engine.py')], check=True, capture_output=True)
        self.assertEqual((status(ROOT), status(ENGINE)), before,
                         'Preparing the engine must not modify committed sources or create untracked files')

    def test_engine_sources_are_committed(self):
        for name in ['UI/Qt/DerpBirdChrome.cpp', 'Libraries/LibWeb/Page/DerpBirdCredentialFields.h',
                     'Base/res/ladybird/about-pages/downloads.html']:
            committed = subprocess.check_output(['git', '-C', str(ENGINE), 'show', f'HEAD:{name}'])
            self.assertEqual(committed, (ENGINE / name).read_bytes(), name)

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
        for directory, destination in [('WebUI', 'Libraries/LibWebView/WebUI'), ('Qt', 'UI/Qt'), ('Tests', 'Tests/LibWebView'), ('EngineTests', 'Tests/LibWeb'), ('WebContent', 'Libraries/LibWeb/Page')]:
            for source in (ROOT / 'native' / directory).glob('*'):
                self.assertEqual(source.read_bytes(), (ENGINE / destination / source.name).read_bytes(), str(source))


if __name__ == '__main__':
    unittest.main()
