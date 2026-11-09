# uBlock Origin redirect resources

Upstream: https://github.com/gorhill/uBlock
Pinned commit: f3e5e5e0efa4b01035b928a084b8fe018cbcbe99
Copyright: Raymond Hill and the upstream resource authors.
License: GPL-3.0-or-later; see LICENSE.txt and retained file notices.

redirect-resources.js is the upstream mapping. index.json is its static exported
Map serialized to JSON. All 48 referenced source files are retained unchanged;
SHA256SUMS.json records their hashes.

scripts/generate-blocker-resources.py validates hashes, names and size bounds and
embeds48 redirect resources (88 names/aliases) into the engine. The original
click2load.html is retained and hash-verified; its extension-dependent payload is
replaced by native/Resources/DerpBirdClickToLoad.html with an internal MIME marker.
The native host handles its button and one-navigation approval.
Generation is offline and deterministic. The raw sources and license must accompany
distributions containing these resources. The scriptlet library and its module dependencies are also pinned:35 source
modules,153 registrations. scripts/generate-blocker-scriptlets.mjs serializes
registrations without calling the registered functions; --check verifies the
derived JSON. All source and derived hashes are recorded.

The current bundle includes 131 MAIN registrations/helpers, 22 ISOLATED
registrations and 48 redirect resources. MAIN and ISOLATED sources are selected
separately; shared helpers retain the same permission checks. The isolated
injection path is covered by Spark1 guest HTTP and native engine tests for
DOM changes, dynamic nodes, realm isolation, exceptions and policy disable.
Resources requiring trusted filters retain permission bit1; ordinary rules have
permission0 and cannot invoke them. MAIN scriptlets use a private lexical scope in the page realm; ISOLATED
scriptlets use a separate wrapper world. Both run once at new-document commit
and expose no GM APIs. The isolated blocker world has only private native
callbacks for document-local user-origin CSS and filtering policy; these are
not visible to page scripts.

The unmodified procedural executor is retained in procedural/contentscript-extra.js
from the same pinned commit, under its original GPL3+ notice. Its digest is in
PROCEDURAL_SHA256SUMS.json and checked by the resource generator. The adapter
in native/Resources/DerpBirdProceduralAdapter.js translates adblock-rust's JSON
to the executor's compiled task format. DOM contract tests exercise the actual
upstream executor. The native blocker now embeds the adapter/executor for procedural rules that
cannot use ordinary CSS. DOM changes are coalesced; marker writes do not cause
continuous processing. Native callbacks supply user-origin CSS and current
policy checks. Document deactivation revokes the isolated world. Ruleset changes
still require navigation for scriptlet/procedural source selection; broad
compatibility and performance qualification remain incomplete.
