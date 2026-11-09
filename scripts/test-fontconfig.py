#!/usr/bin/env python3
"""Verify the built Fontconfig against system configuration and modern generic-family rules."""
import argparse
import ctypes
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from xml.sax.saxutils import escape


def probe(library, family):
    fc = ctypes.CDLL(str(library.resolve()))
    pointer = ctypes.c_void_p
    fc.FcInit.restype = ctypes.c_int
    assert fc.FcInit(), 'Fontconfig initialization failed'
    fc.FcNameParse.argtypes = [ctypes.c_char_p]
    fc.FcNameParse.restype = pointer
    fc.FcConfigSubstitute.argtypes = [pointer, pointer, ctypes.c_int]
    fc.FcDefaultSubstitute.argtypes = [pointer]
    fc.FcFontMatch.argtypes = [pointer, pointer, ctypes.POINTER(ctypes.c_int)]
    fc.FcFontMatch.restype = pointer
    fc.FcPatternGetString.argtypes = [pointer, ctypes.c_char_p, ctypes.c_int, ctypes.POINTER(ctypes.c_char_p)]
    pattern = fc.FcNameParse((family + ':style=Regular:pixelsize=20.8').encode())
    assert fc.FcConfigSubstitute(None, pattern, 0)
    fc.FcDefaultSubstitute(pattern)
    result = ctypes.c_int()
    match = fc.FcFontMatch(None, pattern, ctypes.byref(result))
    assert match, 'No matching font'
    values = {'version': fc.FcGetVersion()}
    for key in ('family', 'file'):
        value = ctypes.c_char_p()
        assert fc.FcPatternGetString(match, key.encode(), 0, ctypes.byref(value)) == 0
        values[key] = value.value.decode()
    assert Path(values['file']).is_file(), values
    print(json.dumps(values))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--library', type=Path, required=True)
    parser.add_argument('--family', default='sans-serif')
    parser.add_argument('--probe', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.probe:
        probe(args.library, args.family)
        return
    with tempfile.TemporaryDirectory(prefix='derpbird-fontconfig-') as directory:
        config = Path(directory)/'fonts.conf'
        base = os.environ.get('FONTCONFIG_FILE', '/etc/fonts/fonts.conf')
        config.write_text('''<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig><include>''' + escape(base) + '''</include>
<match target="pattern"><test name="genericfamily" compare="contains"><const xsi:nil="true"/></test>
<edit name="genericfamily" mode="append"><const>sans-serif</const></edit></match></fontconfig>''')
        for label, environment in [('system', dict(os.environ)), ('modern-rules', dict(os.environ, FONTCONFIG_FILE=str(config)))]:
            result = subprocess.run([sys.executable, __file__, '--probe', '--library', str(args.library), '--family', args.family], env=environment, capture_output=True, text=True, timeout=30)
            assert result.returncode == 0, result.stderr
            assert 'Fontconfig warning:' not in result.stderr and 'Fontconfig error:' not in result.stderr, result.stderr
            values = json.loads(result.stdout)
            assert values['version'] >= 21803, values
            if args.family == 'Inter':
                assert values['family'] == 'Inter', values
            print(label + ': ' + json.dumps(values))


if __name__ == '__main__':
    main()
