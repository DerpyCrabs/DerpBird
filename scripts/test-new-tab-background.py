#!/usr/bin/env python3
"""Check the empty document's actual pixels without creating a native window."""
import argparse
import json
import os
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import quote

from PIL import Image
from build_config import engine_build


def check_page(hub, profile, url, size, expected, screenshot):
    env = os.environ.copy()
    for key in ("DISPLAY", "WAYLAND_DISPLAY", "DERPBIRD_AUTOMATION_SOCKET"):
        env.pop(key, None)
    subprocess.run([
        str(hub), "--headless=screenshot", "--force-cpu-painting", "--profile-path", str(profile),
        "--window-width", str(size[0]), "--window-height", str(size[1]),
        "--screenshot-delay", "1", "--screenshot-path", str(screenshot), *([url] if url else []),
    ], env=env, stdout=subprocess.DEVNULL, check=True, timeout=20)
    with Image.open(screenshot) as image:
        assert image.size == size, (url, image.size, size)
        extrema = image.convert("RGB").getextrema()
        assert extrema == tuple((channel, channel) for channel in expected), (url, extrema, expected)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hub", type=Path, default=engine_build() / "libexec/Hub")
    args = parser.parse_args()
    gray = (48, 49, 52)
    # A blank iframe must still show its parent's background. A regular white
    # document must remain white when the user prefers light websites.
    frame = "<style>html{background:#6e783e}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style><iframe src='about:blank'></iframe>"
    cases = [
        (None, gray), ("about:newtab", gray),
        ("data:text/html," + quote(frame), (110, 120, 62)),
        ("data:text/html," + quote("<style>html{background:white}</style>"), (255, 255, 255)),
    ]
    with tempfile.TemporaryDirectory(prefix="derpbird-empty-tab-") as directory:
        root = Path(directory)
        for scheme in ("light", "dark"):
            profile = root / scheme
            config = profile / "config"
            config.mkdir(parents=True)
            (config / "Settings.json").write_text(json.dumps({
                "firstRunComplete": True, "newTabPageURL": "about:blank",
                "appearance": {"websiteColorScheme": scheme},
            }))
            if scheme == "light":
                for url in ("about:blank", "about:blank#history", "data:text/html,<html></html>"):
                    check_page(args.hub, profile, url, (320, 180), (255, 255, 255), root / "site.png")
            for url, color in cases:
                check_page(args.hub, profile, url, (320, 180), color, root / "capture.png")
            custom_page = root / "custom.html"
            custom_page.write_text("<style>html{background:#798a9b}</style>")
            settings = config / "Settings.json"
            preferences = json.loads(settings.read_text())
            preferences["newTabPageURL"] = custom_page.as_uri()
            settings.write_text(json.dumps(preferences))
            check_page(args.hub, profile, None, (320, 180), (121, 138, 155), root / "custom.png")
    print("PASS: blank tabs, fragments, internal new tab, transparent iframe and authored or custom start page backgrounds")


if __name__ == "__main__":
    main()
