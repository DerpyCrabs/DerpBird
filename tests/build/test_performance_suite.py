"""Prevent misleading green performance runs and incompatible comparisons."""
import copy
import json
from pathlib import Path
import sys
import unittest
import urllib.request
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
from performance_suite import FixtureServer, compare, scenarios, stats, summarize, component_summary, check_budgets

class PerformanceReportingTests(unittest.TestCase):
    def rows(self):
        return [dict(id='probe',sample=i,warmup=i==0,ok=True,metrics={'elapsedMs':value}) for i,value in enumerate([999,10,20])]
    def report(self,value=10):
        return dict(schema=1,compatibility={'fixture':'a'},passed=True,results={'probe':dict(passed=True,summary={'elapsedMs':stats([value,value])})})
    def test_responsiveness_budgets_reject_slow_and_missing_measurements(self):
        good = {'elapsedMs': stats([14, 15, 17]), 'heartbeatMaxMs': stats([15, 16, 18])}
        self.assertEqual(check_budgets('styles-history-1000', good)['elapsedMs'], 100)
        bad = dict(good, elapsedMs=stats([10500, 10600, 10700]))
        with self.assertRaises(ValueError): check_budgets('styles-history-1000', bad)
        with self.assertRaises(KeyError): check_budgets('styles-history-1000', {})
        with self.assertRaises(ValueError): check_budgets('procedural-20-text', {'heartbeatMaxMs': stats([60])})

    def test_warmup_excluded(self):
        result=summarize(self.rows(),{'id':'probe'},2,1)
        self.assertEqual(result['elapsedMs']['median'],15)
        self.assertEqual(result['elapsedMs']['p95'],20)
    def test_missing_duplicate_wrong_failed_or_nonfinite_sample_rejected(self):
        for change in [lambda rows:rows.pop(),lambda rows:rows[1].update(sample=0),lambda rows:rows[1].update(id='wrong'),
                       lambda rows:rows[0].update(ok=False),lambda rows:rows[2].update(metrics={}),
                       lambda rows:rows[1]['metrics'].update(elapsedMs=float('nan'))]:
            with self.subTest(change=change):
                rows=self.rows();change(rows)
                with self.assertRaises(ValueError):summarize(rows,{'id':'probe'},2,1)
    def test_statistic_validation(self):
        for values in [[],[float('inf')],[-1],[True]]:
            with self.assertRaises(ValueError):stats(values)
    def test_baseline_needs_relative_and_absolute_regression(self):
        self.assertEqual(compare(self.report(11),self.report()),[])
        self.assertEqual(len(compare(self.report(15),self.report())),1)
        self.assertEqual(compare(self.report(.5),self.report(.1)),[])
    def test_incompatible_failed_or_missing_baseline_rejected(self):
        for change in [lambda r:r.update(schema=2),lambda r:r.update(compatibility={}),lambda r:r.update(passed=False),
                       lambda r:r['results'].clear(),lambda r:r['results']['probe']['summary'].clear(),
                       lambda r:r['results']['probe'].update(passed=False)]:
            baseline=self.report();change(baseline)
            with self.assertRaises(ValueError):compare(self.report(),baseline)
    def test_components_have_repeated_samples_and_stable_identity(self):
        runs=[[dict(case='match',mean_match_us=value)] for value in [999,1000,2000]]
        self.assertEqual(component_summary(runs,1)['0.mean_matchMs']['median'],1.5)
        runs[1][0]['case']='other'
        with self.assertRaises(ValueError):component_summary(runs,1)
    def test_memory_and_nonfinite_baseline_are_checked(self):
        current=self.report();baseline=self.report()
        current['results']['probe']['summary']={'postLoadRssMiB':stats([150])}
        baseline['results']['probe']['summary']={'postLoadRssMiB':stats([100])}
        self.assertEqual(len(compare(current,baseline)),1)
        baseline['results']['probe']['summary']['postLoadRssMiB']['median']=float('nan')
        with self.assertRaises(ValueError):compare(current,baseline)
    def test_executor_timeout_and_failure_preserve_logs(self):
        import importlib.util, tempfile, os
        spec=importlib.util.spec_from_file_location('performance_runner',Path(__file__).resolve().parents[2]/'scripts/benchmark-performance.py')
        runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
        with tempfile.TemporaryDirectory() as directory:
            for label,code,timeout in [('failure',"print('failure evidence',flush=True);raise SystemExit(3)",5),('timeout',"print('timeout evidence',flush=True);__import__('time').sleep(20)",.2)]:
                out=Path(directory)/label
                with self.assertRaises(RuntimeError):runner.execute([sys.executable,'-c',code],out,dict(os.environ),timeout)
                self.assertIn(label+' evidence',(out/'output.log').read_text())

    def test_scenarios_unique_and_cover_required_areas(self):
        rows=scenarios()
        self.assertEqual(len(rows),len({r['id'] for r in rows}))
        for workload in ['navigation','layout','animation','scroll','images','canvas','cache','blocked-fetch','idle','shell-snapshot','shell-ipc']:
            self.assertTrue(any(r['workload']==workload for r in rows),workload)
    def test_loopback_fixture_counts_and_cache_headers(self):
        with FixtureServer() as server:
            with urllib.request.urlopen(server.endpoint+'/page?count=2') as response:
                self.assertEqual(response.read().count(b'class="card"'),2)
                self.assertEqual(response.headers['Cache-Control'],'no-store')
            with urllib.request.urlopen(server.endpoint+'/payload/test/1') as response:
                self.assertEqual(response.read(),b'payload-ok')
                self.assertIn('max-age=3600',response.headers['Cache-Control'])
            with urllib.request.urlopen(server.endpoint+'/stats?prefix=/payload/test/') as response:
                self.assertEqual(json.load(response),1)
            with urllib.request.urlopen(server.endpoint+'/image.png') as response:
                self.assertTrue(response.read().startswith(b'\x89PNG'))

if __name__=='__main__':unittest.main()
