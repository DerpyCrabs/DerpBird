#!/usr/bin/env python3
"""Create/start the isolated ARM64 graphical test VM on Spark 1."""
import argparse
import hashlib
import os
from pathlib import Path
import platform
import shutil
import subprocess

root = Path(__file__).resolve().parents[1]
work = root / 'artifacts/vm'
parser = argparse.ArgumentParser()
parser.add_argument('action', choices=['prepare', 'start'])
parser.add_argument('--cpus', type=int, default=8)
parser.add_argument('--memory-mib', type=int, default=12288)
args = parser.parse_args()
if args.cpus < 1 or args.memory_mib < 2048:
    parser.error('Provide positive CPU count and at least 2048 MiB memory')
if platform.machine() != 'aarch64':
    raise SystemExit('Run this script on Spark 1 (aarch64), not the development workstation.')
work.mkdir(parents=True, exist_ok=True)
base = work / 'ubuntu-26.04-server-cloudimg-arm64.img'

def run(*command):
    subprocess.run(command, check=True, cwd=work)

if args.action == 'prepare':
    expected = next(line.split()[0] for line in (work / 'SHA256SUMS').read_text().splitlines()
                    if line.split()[-1].lstrip('*') == base.name)
    with base.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != expected:
            raise SystemExit('Cloud image checksum mismatch')
    key = work / 'guest-key'
    if not key.exists():
        run('ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(key))
    public_key = key.with_suffix('.pub').read_text().strip()
    (work / 'meta-data').write_text('instance-id: derpbird-spark1-v1\nlocal-hostname: derpbird-test\n')
    (work / 'user-data').write_text(f'''#cloud-config
users:
  - name: derpbird
    groups: [sudo, video, render]
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    lock_passwd: true
    ssh_authorized_keys:
      - {public_key}
ssh_pwauth: false
disable_root: true
''')
    os.chmod(work / 'user-data', 0o600)
    run('xorriso', '-as', 'mkisofs', '-quiet', '-output', str(work / 'seed.iso'),
        '-volid', 'cidata', '-joliet', '-rock', 'user-data', 'meta-data')
    disk = work / 'guest.qcow2'
    if not disk.exists():
        run('qemu-img', 'create', '-f', 'qcow2', '-F', 'qcow2', '-b', str(base), str(disk), '100G')
    firmware = work / 'AAVMF_VARS.fd'
    if not firmware.exists():
        shutil.copyfile('/usr/share/AAVMF/AAVMF_VARS.fd', firmware)
else:
    pidfile = work / 'qemu.pid'
    if pidfile.exists() and Path('/proc', pidfile.read_text().strip()).exists():
        raise SystemExit('The VM is already running; inspect it instead of starting another.')
    run('qemu-system-aarch64', '-name', 'derpbird-test', '-machine', 'virt,accel=kvm',
        '-cpu', 'host', '-smp', str(args.cpus), '-m', str(args.memory_mib),
        '-drive', 'if=pflash,format=raw,readonly=on,file=/usr/share/AAVMF/AAVMF_CODE.fd',
        '-drive', f'if=pflash,format=raw,file={work}/AAVMF_VARS.fd',
        '-drive', f'if=virtio,format=qcow2,file={work}/guest.qcow2',
        '-drive', f'if=virtio,format=raw,readonly=on,file={work}/seed.iso',
        '-device', 'virtio-gpu-pci', '-device', 'qemu-xhci',
        '-device', 'usb-kbd', '-device', 'usb-tablet',
        '-netdev', 'user,id=net0,hostfwd=tcp:127.0.0.1:22261-:22',
        '-device', 'virtio-net-pci,netdev=net0', '-vnc', '127.0.0.1:16',
        '-serial', f'file:{work}/serial.log',
        '-qmp', f'unix:{work}/qmp.sock,server=on,wait=off',
        '-pidfile', str(pidfile), '-daemonize')
