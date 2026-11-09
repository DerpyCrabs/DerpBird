#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/.." && pwd)
exec ssh -i "$root/artifacts/vm/guest-key" -p 22261 \
  -o BatchMode=yes -o ConnectTimeout=10 \
  -o StrictHostKeyChecking=accept-new \
  -o "UserKnownHostsFile=$root/artifacts/vm/known_hosts" \
  derpbird@127.0.0.1 "$@"
