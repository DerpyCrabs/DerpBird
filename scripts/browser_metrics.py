"""Opt-in, low-frequency Linux process-tree sampling for native UI sessions.

RSS is summed across processes and includes shared pages more than once. CPU
samples can miss short-lived children between samples; neither metric measures
input latency or presented frames.
"""
import json
import os
from pathlib import Path
import platform
import threading
import time


def process_tree(root_pid):
    processes = {}
    for directory in Path('/proc').iterdir():
        if not directory.name.isdecimal():
            continue
        try:
            stat = (directory / 'stat').read_text()
            fields = stat[stat.rfind(')') + 2:].split()
            processes[int(directory.name)] = {
                'pid': int(directory.name), 'ppid': int(fields[1]),
                'name': stat[stat.find('(') + 1:stat.rfind(')')],
                'start_ticks': int(fields[19]),
                'cpu_ticks': int(fields[11]) + int(fields[12]),
                'rss_bytes': max(0, int(fields[21])) * os.sysconf('SC_PAGE_SIZE'),
            }
        except (OSError, ValueError, IndexError):
            continue  # Processes may disappear during a sample.
    selected = {root_pid} if root_pid in processes else set()
    pending = [root_pid]
    children = {}
    for pid, process in processes.items():
        children.setdefault(process['ppid'], []).append(pid)
    while pending:
        for pid in children.get(pending.pop(), []):
            if pid not in selected:
                selected.add(pid)
                pending.append(pid)
    return [processes[pid] for pid in sorted(selected)]


class BrowserMetrics:
    def __init__(self, pid, output, interval=1.0):
        self.pid = pid
        self.output = Path(output)
        if interval <= 0:
            raise ValueError('Sampling interval must be positive')
        self.interval = interval
        self.stop_event = threading.Event()
        initial = process_tree(pid)
        self.root_start_ticks = next((p['start_ticks'] for p in initial if p['pid'] == pid), None)
        self.started_unix = time.time()
        self.started = time.monotonic()
        self.samples = []
        # CPU use before attachment belongs outside the measured interval.
        self.last_ticks = {(p['pid'], p['start_ticks']): p['cpu_ticks'] for p in initial}
        self.error = None
        self.root_exited = self.root_start_ticks is None
        self.thread = threading.Thread(target=self._sample, name='browser-metrics', daemon=True)
        self.thread.start()

    def _sample(self):
        ticks_per_second = os.sysconf('SC_CLK_TCK')
        previous_time = self.started
        try:
            while not self.stop_event.wait(self.interval):
                begin = time.monotonic()
                processes = process_tree(self.pid)
                if self.root_exited or not any(p['pid'] == self.pid and p['start_ticks'] == self.root_start_ticks for p in processes):
                    self.root_exited = True
                    break  # Do not follow an unrelated process after PID reuse.
                cpu_ticks = 0
                current_ticks = {}
                for process in processes:
                    identity = (process['pid'], process['start_ticks'])
                    old = self.last_ticks.get(identity, 0)
                    cpu_ticks += max(0, process['cpu_ticks'] - old)
                    current_ticks[identity] = process['cpu_ticks']
                self.last_ticks = current_ticks
                elapsed = begin - previous_time
                self.samples.append({
                    'seconds': begin - self.started,
                    'interval_seconds': elapsed,
                    'cpu_seconds': cpu_ticks / ticks_per_second,
                    'cpu_percent_one_core': 100 * cpu_ticks / ticks_per_second / elapsed,
                    'aggregate_rss_bytes': sum(p['rss_bytes'] for p in processes),
                    'processes': processes,
                    'sampling_seconds': time.monotonic() - begin,
                })
                previous_time = begin
        except Exception as error:
            self.error = str(error)

    def close(self):
        self.stop_event.set()
        self.thread.join()
        report = {
            'started_unix_seconds': self.started_unix,
            'root_pid': self.pid, 'machine': platform.machine(),
            'kernel': platform.release(), 'logical_cpus': os.cpu_count(),
            'interval_seconds': self.interval, 'duration_seconds': time.monotonic() - self.started,
            'limitations': 'Aggregate RSS double-counts shared pages. Short-lived children may be missed. No input/presentation latency measured.',
            'error': self.error, 'root_exited': self.root_exited, 'samples': self.samples,
        }
        self.output.write_text(json.dumps(report, indent=2) + '\n')
