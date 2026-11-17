"""Render the portable performance report without a server or dependencies."""
from html import escape
from pathlib import Path


def write_html(report, path):
    rows=[]
    for name,result in report['results'].items():
        summary=result.get('summary',{})
        primary='navigationMs' if result['config']['workload']=='navigation' else 'updateP95Ms' if result['config']['kind']=='shell' else 'elapsedMs'
        timing=summary.get(primary,{})
        memory=summary.get('postLoadRssMiB',{})
        rows.append(f'<tr><td>{escape(name)}</td><td>{"PASS" if result["passed"] else "FAIL"}</td>'
                    f'<td>{escape(primary)}</td><td>{timing.get("median",0):.2f}</td><td>{timing.get("p95",0):.2f}</td>'
                    f'<td>{timing.get("mad",0):.2f}</td><td>{memory.get("median",0):.1f}</td></tr>')
    components=''.join(f'<li>{escape(name)}: {"PASS" if result["passed"] else "FAIL"} {escape(result.get("error",""))}</li>' for name,result in report.get('components',{}).items())
    failures=list(report.get('errors',[])) + [f'{name}: {result["error"]}' for name,result in report['results'].items() if result.get('error')]
    errors=''.join(f'<li>{escape(str(error))}</li>' for error in failures)
    budgets=''.join(f'<li>{escape(name)}: '+', '.join(f'{escape(metric)} ≤ {limit:g} ms' for metric,limit in result['budgetsMs'].items())+'</li>' for group in ('results','components') for name,result in report.get(group,{}).items() if result.get('budgetsMs'))
    regressions=''.join(f'<li>{escape(row["scenario"])} / {escape(row["metric"])}: {row["before"]:.2f} → {row["after"]:.2f}</li>' for row in report.get('regressions',[]))
    limits=''.join(f'<li>{escape(text)}</li>' for text in report.get('limitations',[]))
    html='''<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<style>:root{color-scheme:light;color:#172033;background:#ffffff}body{color:#172033;background:#ffffff;font:14px system-ui;max-width:1200px;margin:24px auto;padding:0 16px}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}td,th{padding:8px;border-bottom:1px solid #8885;text-align:right}td:first-child,th:first-child{text-align:left}li{margin:6px 0}.scroll{overflow:auto}p{line-height:1.5}</style>'''
    html+=f'<h1>Performance suite: {"PASS" if report["passed"] else "FAIL"}</h1><p>{len(rows)} native scenarios · {len(report.get("components",{}))} additional groups · {report["compatibility"]["samples"]} measured runs after {report["compatibility"]["warmups"]} warmup(s). Complete run: {report["complete"]}.</p>'
    html+='<p>Timings in milliseconds. Median, p95 across runs, and median absolute deviation (MAD). RSS is summed across processes and double-counts shared pages. Open report.json for all metrics and raw samples.</p>'
    html+='<div class=scroll><table><thead><tr><th>Scenario</th><th>Status</th><th>Metric</th><th>Median ms</th><th>p95 ms</th><th>MAD ms</th><th>RSS MiB</th></tr></thead><tbody>'+''.join(rows)+'</tbody></table></div>'
    html+='<h2>Responsiveness budgets</h2><p>Limits apply to medians across repeated runs. These guard against severe stalls; they do not certify presented frame rate.</p><ul>'+budgets+'</ul>'
    html+='<h2>Additional groups</h2><ul>'+components+'</ul><h2>Errors / regressions</h2><ul>'+errors+regressions+'</ul><h2>Scope and limitations</h2><ul>'+limits+'</ul>'
    Path(path).write_text(html+'\n')
