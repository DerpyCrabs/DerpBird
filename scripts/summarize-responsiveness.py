#!/usr/bin/env python3
"""Summarize native fixture windows without mislabeling RAF cadence as FPS."""
import argparse
import json
import statistics
from pathlib import Path

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('fixture',type=Path)
parser.add_argument('metrics',type=Path)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
rows=[json.loads(line) for line in args.fixture.read_text().splitlines() if line.strip()]
metrics=json.loads(args.metrics.read_text())
start=metrics['started_unix_seconds']
end=start+metrics['duration_seconds']
rows=[row for row in rows if start <= row['receivedUnix'] <= end]
if not rows:
    raise SystemExit('No fixture reports overlap the measured browser run')
revision=max(row.get('fixtureRevision',1) for row in rows)
valid=[row for row in rows if row.get('fixtureRevision',1)==revision and row['reason']=='sample' and row['visible'] and 4500<=row['windowMs']<=5500 and row['rafGapMs']['count']]
phases={}
for churn in (False,True):
    windows=[row for row in valid if row['churn']==churn]
    samples=[sample for sample in metrics['samples'] if any(row['receivedUnix']-row['windowMs']/1000 <= metrics['started_unix_seconds']+sample['seconds'] <= row['receivedUnix'] for row in windows)]
    phase={'windows':len(windows),'observed_seconds':sum(row['windowMs'] for row in windows)/1000,'process_samples':len(samples)}
    for key in ('rafGapMs','timerGapMs','inputToRafMs'):
        points=[row[key] for row in windows if row[key]['count']]
        phase[key]={'events':sum(point['count'] for point in points),'worst_window_p95':max((point['p95'] for point in points),default=None),'max':max((point['max'] for point in points),default=None)}
    if samples:
        rss=[sample['aggregate_rss_bytes']/1024**2 for sample in samples]
        phase.update(cpu_one_core_mean=statistics.mean(sample['cpu_percent_one_core'] for sample in samples),rss_mib_first=rss[0],rss_mib_last=rss[-1],rss_mib_peak=max(rss))
    phases['churn' if churn else 'animation_only']=phase
result={'fixture_revision':revision,'duration_seconds':metrics['duration_seconds'],'fixture_documents':len(set(row['id'] for row in rows)),'phases':phases,'sampler_error':metrics['error'],'limitations':['RAF callback gaps are not compositor FPS or presentation latency.','Input timing starts in the DOM handler; OS/VNC/input dispatch delay is excluded.','Worst window p95 is not a pooled percentile. Visibility-transition windows are excluded.','Summed RSS double-counts shared pages; short-run changes do not establish a memory leak.','Synthetic 2000-node fixture, not general website compatibility or long-session qualification.']}
probes={}
markers=set()
for row in rows:
    if not row.get('userscript'): continue
    marker=row['userscript']
    try:
        probe=json.loads(marker)
    except (ValueError, TypeError):
        markers.add(str(marker))
        continue
    if isinstance(probe, dict) and 'failures' in probe:
        probes[row['id']]=probe
    else:
        markers.add(str(marker))
result['userscript_markers']=sorted(markers)
result['userscript_storage']={'documents_with_cumulative_counters':len(probes),'reported_batches':sum(p.get('batches',0) for p in probes.values()),'failures':sum(p['failures'] for p in probes.values()) if probes else None,'latest_reports':probes}
args.output.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
