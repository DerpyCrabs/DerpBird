#!/usr/bin/env bash
# Run only inside the isolated Ubuntu test VM.
set -euo pipefail
[[ $(hostname) == derpbird-test ]] || { echo 'Not the DerpBird test VM' >&2; exit 1; }
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  labwc greetd foot grim wayland-utils dbus-user-session mesa-vulkan-drivers \
  autoconf autoconf-archive automake build-essential ccache cmake curl git \
  clang-22 lld-22 glslang-tools libdrm-dev libgl1-mesa-dev libncurses-dev \
  libpulse-dev libsecret-1-dev gnome-keyring dbus libtool libwayland-dev libxcb-icccm4-dev nasm ninja-build \
  pkg-config python3-venv qt6-base-private-dev qt6-positioning-dev \
  qt6-tools-dev-tools qt6-wayland rsync tar unzip zip fonts-liberation2 \
  fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji
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
