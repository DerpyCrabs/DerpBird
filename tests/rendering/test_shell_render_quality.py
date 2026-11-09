"""Negative controls for the rendered-quality comparison, not browser substitutes."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from PIL import Image, ImageDraw, ImageFont

spec = importlib.util.spec_from_file_location(
    'render_quality', Path(__file__).resolve().parents[2] / 'scripts/test-shell-render-quality.py')
quality = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quality)


class QualityOracleTests(unittest.TestCase):
    def fixture(self, degrade=False):
        content = Image.new('RGB', (356 * 4, 28 * 4), '#242629')
        draw = ImageDraw.Draw(content)
        draw.line([(24, 56), (60, 20), (96, 56)], fill='#dddddd', width=7)
        draw.text((140, 12), 'https://www.google.com/',
                  font=ImageFont.load_default(size=56), fill='#dddddd')
        content = content.resize((356, 28), Image.Resampling.LANCZOS)
        image = Image.new('RGB', (400, 100), '#18191b')
        draw = ImageDraw.Draw(image)
        for y in (4, 60):
            draw.rectangle((4, y, 363, y + 31), fill='#ff00ff')
            rendered = content
            if degrade and y == 4:
                rendered = content.resize((178, 14), Image.Resampling.BILINEAR).resize(
                    content.size, Image.Resampling.NEAREST)
            image.paste(rendered, (6, y + 2))
        return image

    def test_identical_independent_rasters_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'capture.png'
            self.fixture().save(path)
            result = quality.compare(path, 1)
            self.assertEqual(result['mean_absolute_error'], 0)

    def test_undersampled_shell_fails_against_unchanged_page(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'capture.png'
            self.fixture(degrade=True).save(path)
            with self.assertRaisesRegex(AssertionError, 'raster mismatch'):
                quality.compare(path, 1)


if __name__ == '__main__':
    unittest.main()
