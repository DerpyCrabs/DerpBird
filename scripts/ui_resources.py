"""Keep the checkout's compiled Ladybird resource tree on the prepared UI revision."""
from pathlib import Path
import shutil
from build_config import engine_build


def ui_resource_files(directory: Path) -> dict[str, bytes]:
    page = directory / 'derpbird.html'
    assets = directory / 'derpbird-assets'
    if not page.is_file() or not assets.is_dir():
        raise RuntimeError(f'DerpBird UI resources missing: {directory}')
    return {'derpbird.html': page.read_bytes(), **{
        f'derpbird-assets/{file.name}': file.read_bytes()
        for file in assets.iterdir() if file.is_file()
    }}


def resource_directories(root: Path) -> tuple[Path, Path]:
    engine = root / 'vendor/ladybird'
    return (engine / 'Base/res/ladybird/about-pages',
            engine_build(root) / 'share/Lagom/ladybird/about-pages')


def sync_built_ui(root: Path) -> bool:
    source, target = resource_directories(root)
    if not target.is_dir():
        return False  # Initial engine build creates the runtime resource tree.
    expected = ui_resource_files(source)
    assets = target / 'derpbird-assets'
    assets.mkdir(exist_ok=True)
    # Publish assets before their entry page. Only DerpBird-owned files change.
    for name in sorted(expected, key=lambda name: name == 'derpbird.html'):
        destination = target / name
        if not destination.is_file() or destination.read_bytes() != expected[name]:
            shutil.copyfile(source / name, destination)
    for file in assets.iterdir():
        if file.is_file() and f'derpbird-assets/{file.name}' not in expected:
            file.unlink()
    verify_built_ui(root)
    return True


def verify_built_ui(root: Path) -> None:
    source, target = resource_directories(root)
    if ui_resource_files(source) != ui_resource_files(target):
        raise RuntimeError('Built Ladybird UI resources are stale. Run python3 scripts/sync-ui-resources.py before qualification.')
