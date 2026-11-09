UserCSS compilation uses unmodified pinned npm/browser libraries:

- usercss-meta 0.12.0 (MIT), https://github.com/openstyles/usercss-meta
- less 4.9.1 (Apache-2.0), https://github.com/less/less.js
- stylus-lang-bundle ad941359ffd800eb6a16fa8459902573e7d5e240 (MIT), https://github.com/openstyles/stylus-lang-bundle
- colorjs.io 0.7.1 (MIT), https://github.com/color-js/color.js

Exact dependency graph and integrity are recorded in bun.lock. Corresponding
licenses accompany this notice. Compiler adapters and UI are in src/browser and
src/ui; compilation is isolated in a disposable worker. No Stylus-extension code
was copied into these adapters.
