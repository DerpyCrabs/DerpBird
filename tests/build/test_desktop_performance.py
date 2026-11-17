"""The displayed-pixel oracle must reject frozen output and missing evidence."""
import copy
import importlib.util
from pathlib import Path
import sys
import unittest

SCRIPTS = Path(__file__).resolve().parents[2] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location('benchmark_browser', SCRIPTS / 'benchmark-browser.py')
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


class DesktopPerformanceTests(unittest.TestCase):
    def captures(self, frozen=False):
        return [dict(seconds=(i+1)/20, digest='same' if frozen else str(i)) for i in range(40)]

    def test_frozen_pixels_fail_even_with_advancing_page_or_decoder(self):
        metrics = benchmark.visible_progress(self.captures(True), 2.05)
        self.assertGreater(metrics['maxVisibleStallMs'], 1900)
        with self.assertRaisesRegex(ValueError, 'presentation stalled'):
            benchmark.check_sample('mouse-video-full-log', metrics)

    def test_live_updates_have_cpu_and_presentation_budgets(self):
        for scenario in ('blocked-request-burst', 'title-full-log'):
            with self.assertRaisesRegex(ValueError, 'Hub state'):
                benchmark.check_sample(scenario, {'hubCpuPercentOneCore': 80})
        with self.assertRaisesRegex(ValueError, 'DOM inspection'):
            benchmark.check_sample('devtools-dom-mutations', {'cpuPercentOneCore': 250})
        for scenario in ('blocked-request-burst', 'title-full-log', 'devtools-dom-mutations'):
            with self.assertRaisesRegex(ValueError, 'presentation stalled'):
                benchmark.check_sample(scenario, benchmark.visible_progress(self.captures(True), 2.05))

    def test_successful_motion_and_static_idle_have_distinct_contracts(self):
        benchmark.check_sample('video', benchmark.visible_progress(self.captures(), 2.05))
        benchmark.check_sample('idle', benchmark.visible_progress(self.captures(True), 2.05))

    def test_tail_stall_is_not_lost_when_no_more_frames_arrive(self):
        rows=self.captures()
        for row in rows[20:]: row['digest']=rows[19]['digest']
        self.assertGreaterEqual(benchmark.visible_progress(rows, 2.05)['maxVisibleStallMs'], 1000)

    def test_missing_or_slow_capture_is_not_a_green_measurement(self):
        with self.assertRaises(ValueError): benchmark.visible_progress([], 2)
        rows=self.captures()[:10]+self.captures()[20:]
        with self.assertRaisesRegex(ValueError, 'inconclusive'):
            benchmark.check_sample('video', benchmark.visible_progress(rows, 2.05))

    def test_invalid_capture_timeline_rejected(self):
        for change in (lambda r:r[3].update(seconds=-1),lambda r:r[3].update(seconds=float('nan')),
                       lambda r:r[3].update(seconds=r[2]['seconds']),lambda r:r[3].update(digest='')):
            rows=self.captures();change(rows)
            with self.assertRaises(ValueError):benchmark.visible_progress(rows,2.05)

    def test_complete_runner_checks_decreasing_browser_throughput(self):
        from performance_suite import compare
        def report(rate):
            return dict(schema=1,compatibility={},passed=True,results={},components={
                'full-browser':dict(passed=True,summary={'video.visibleUpdatesPerSecond':{'median':rate}})})
        self.assertEqual(len(compare(report(12),report(20))),1)
        self.assertEqual(compare(report(20),report(12)),[])

    def report(self, updates=20):
        return dict(schema=1, compatibility={'fixture':'test'}, passed=True, scenarios={
            'video':dict(passed=True,summary={'visibleUpdatesPerSecond':{'median':updates}})})

    def test_lower_visible_update_rate_is_a_regression(self):
        self.assertEqual(len(benchmark.compare_reports(self.report(12),self.report())),1)
        self.assertEqual(benchmark.compare_reports(self.report(),self.report(12)),[])

    def test_incompatible_failed_or_missing_baseline_rejected(self):
        for change in (lambda r:r.update(passed=False),lambda r:r.update(compatibility={}),lambda r:r['scenarios'].clear()):
            baseline=copy.deepcopy(self.report());change(baseline)
            with self.assertRaises(ValueError):benchmark.compare_reports(self.report(),baseline)


if __name__ == '__main__': unittest.main()
