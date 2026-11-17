# Licensing scope

Original DerpBird code and documentation are MIT licensed; see LICENSE.
This is not an MIT-only distribution. Retain existing copyright notices,
source headers, license texts, and dependency notices when redistributing it.

| Component | License and retained notices |
| --- | --- |
| Ladybird engine and Ladybird-derived files, including native overlays with BSD headers | BSD-2-Clause; `vendor/ladybird/LICENSE` and per-file notices |
| Modified adblock-rust | MPL-2.0; `third_party/adblock/LICENSE` and `third_party/adblock/DERPBIRD.md` |
| uBlock Origin resources and scriptlets | GPL-3.0-or-later; `third_party/ublock-resources/LICENSE.txt`, README, and source notices |
| UserCSS libraries | MIT and Apache-2.0; `third_party/usercss/NOTICE.md` and adjacent license files |
| JavaScript and native dependencies | Their own licenses; pinned manifests, lockfiles, and upstream notices |
| Dependency patches | Preserve the license of the code being patched |

The uBlock resources and scriptlets are embedded by the build generators.
Their GPL terms continue to apply; the MIT license for original DerpBird code
is not a determination that a combined binary can be distributed under MIT
alone. Evaluate combined-distribution requirements before publishing binaries.
For MPL-covered changes, retain the covered source and its MPL notices.

The package builder includes the DerpBird and Ladybird licenses, this notice,
vcpkg copyright files, bundled third-party license files, and available
JavaScript dependency license/notice files. Shipping notices is not a substitute
for satisfying applicable corresponding-source requirements. Distribute the
matching sources and build information as required by the included licenses.

Dependency icons and brand names do not imply endorsement by their owners.
