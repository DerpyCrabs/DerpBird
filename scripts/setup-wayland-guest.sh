#!/usr/bin/env bash
set -euo pipefail
[[ $(hostname) == derpbird-test ]] || { echo 'Not the DerpBird test VM' >&2; exit 1; }
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y labwc greetd foot grim wayland-utils
sudo install -d /etc/greetd
sudo tee /etc/greetd/config.toml >/dev/null <<'EOF'
[terminal]
vt = 7
switch = true

[default_session]
command = "labwc"
user = "derpbird"

[initial_session]
command = "labwc"
user = "derpbird"
EOF
mkdir -p "$HOME/.config/labwc"
cat > "$HOME/.config/labwc/environment" <<'EOF'
QT_QPA_PLATFORM=wayland
GDK_BACKEND=wayland
XDG_SESSION_TYPE=wayland
EOF
# This is a single-user, task-owned test VM. The compositor runs on its DRM seat,
# not nested inside X11. Its VNC/SSH endpoints remain host-loopback only.
sudo systemctl disable --now lightdm || true
sudo systemctl enable --force greetd
sudo systemctl restart greetd
