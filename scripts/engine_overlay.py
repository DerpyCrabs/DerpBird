"""Validate a complete patch series before applying its missing suffix.

Reconstruct prefixes from the pinned source in a temporary directory. Unlike
checking each patch backwards against the final tree, this supports later patches
changing earlier additions. Never reverse or overwrite the caller's files.
"""
from pathlib import Path
import subprocess
import tempfile


def apply_series(source: Path, patches: list[Path]) -> int:
    patches = [path.resolve() for path in patches]
    paths: set[str] = set()
    original_paths: set[str] = set()
    introduced: set[str] = set()
    for patch in patches:
        old = None
        for line in patch.read_text().splitlines():
            if line.startswith('--- '):
                old = line[4:]
            if line.startswith('--- a/') or line.startswith('+++ b/'):
                path = line[6:]
                if Path(path).is_absolute() or '..' in Path(path).parts:
                    raise ValueError(f'Unsafe overlay path: {path}')
                paths.add(path)
                if line.startswith('--- a/') and path not in introduced:
                    original_paths.add(path)
                if line.startswith('+++ b/') and old == '/dev/null':
                    introduced.add(path)
    live: dict[str, bytes | None] = {}
    for path in paths:
        file = source / path
        if file.is_symlink():
            raise ValueError(f'Overlay target must not be a symlink: {path}')
        live[path] = file.read_bytes() if file.exists() else None
    with tempfile.TemporaryDirectory(prefix='derpbird-series-') as directory:
        shadow = Path(directory)
        for path in original_paths:
            content = subprocess.check_output(['git', '-C', str(source), 'show', f'HEAD:{path}'])
            file = shadow / path
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(content)

        def matches() -> bool:
            return all(live[path] == ((shadow / path).read_bytes() if (shadow / path).exists() else None) for path in paths)

        prefix = 0 if matches() else None
        for index, patch in enumerate(patches, 1):
            subprocess.run(['git', 'apply', str(patch)], cwd=shadow, check=True, capture_output=True)
            if matches():
                prefix = index
        if prefix is None:
            raise RuntimeError('Engine overlay differs from every validated patch prefix; preserving local changes')
        # Refuse a concurrent modification during reconstruction.
        for path in paths:
            file = source / path
            if file.is_symlink() or live[path] != (file.read_bytes() if file.exists() else None):
                raise RuntimeError(f'Engine changed during overlay validation: {path}')
        for patch in patches[prefix:]:
            subprocess.run(['git', '-C', str(source), 'apply', str(patch)], check=True)
        return len(patches) - prefix
