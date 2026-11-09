"""Verify the actual patch series against original files at the engine pin."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
ENGINE = ROOT / 'vendor/ladybird'


class EngineOverlayTest(unittest.TestCase):
    def test_patch_series_reconstructs_deployed_sources(self):
        patches = sorted((ROOT / 'patches').glob('*.patch'))
        paths = {
            line.removeprefix('--- a/')
            for patch in patches
            for line in patch.read_text().splitlines()
            if line.startswith('--- a/')
        }
        with tempfile.TemporaryDirectory(prefix='derpbird-overlay-') as directory:
            target = Path(directory)
            for path in paths:
                file = target / path
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(subprocess.check_output(['git', '-C', str(ENGINE), 'show', f'HEAD:{path}']))
            for patch in patches:
                subprocess.run(['git', 'apply', '--check', str(patch)], cwd=target, check=True, capture_output=True)
                subprocess.run(['git', 'apply', str(patch)], cwd=target, check=True, capture_output=True)
            for path in paths:
                self.assertEqual((target / path).read_bytes(), (ENGINE / path).read_bytes(), path)

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
