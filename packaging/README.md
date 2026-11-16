# Arch Linux package

Run `makepkg -si` from this checkout with its initialized Ladybird submodule,
Bun, and the engine build prerequisites installed (see the project build docs).
The UI currently also uses the adjacent EffectWeb and DerpDesign workspaces
listed in package.json. This is a local workspace PKGBUILD, not an AUR source release.

To package an already built and verified engine without rebuilding it:

```sh
DERPBIRD_PACKAGE_REUSE_BUILD=1 makepkg -f
sudo pacman -U ./derpbird-0.1.0-7-x86_64.pkg.tar.zst
```

`DERPBIRD_ENGINE_BUILD` selects an alternative engine build directory.
The package contains the native browser, helpers, resources, private shared
libraries and a standalone Bun-compiled MCP server. Running it requires neither
Bun nor Python nor the checkout. It does not configure a window manager or change
the default browser. Normal profiles remain in `$XDG_DATA_HOME/derpbird/profile`
(default `~/.local/share/derpbird/profile`).

Launch **DerpBird** from the application menu or run `derpbird`.
Configure MCP clients to execute `/usr/bin/derpbird-mcp` without arguments.
For Codex, preserve the desktop environment forwarding:

```toml
[mcp_servers.derpbird]
command = "/usr/bin/derpbird-mcp"
startup_timeout_sec = 20
tool_timeout_sec = 120
env_vars = ["DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "QT_QPA_PLATFORM"]
```

New MCP sessions use the installed browser. Isolated agents keep disposable
profiles and the `org.derpbird.Agent` window identity. To attach to your own
browser, use derpbird_session(discover), then attach to its socket. `DERPBIRD_EXECUTABLE` can override the agent
launcher for development; direct `bun src/automation/server.ts` continues using
the checkout by default.

Agent launch opens a background window on the normal profile and shares live logins and storage. Closing an agent session closes only its window. `DERPBIRD_PROFILE` explicitly selects another profile for test harnesses. After upgrading an already running older browser, reopen it once to load native window support.
