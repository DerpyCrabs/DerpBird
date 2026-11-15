"""Regression checks for selecting the right artifacts and rejecting false passes."""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import build_config as config
import build_tasks

spec = importlib.util.spec_from_file_location('regressions', config.ROOT / 'scripts/test-native-regressions.py')
regressions = importlib.util.module_from_spec(spec)
spec.loader.exec_module(regressions)


class ConfigurationTests(unittest.TestCase):
    def test_preset_paths_and_custom_directories_cannot_share_native_artifacts(self):
        with patch.dict(os.environ, {}, clear=True):
            release = config.native_build(True)
            self.assertEqual(config.engine_build().name, 'release')
            with patch.dict(os.environ, {'DERPBIRD_BUILD_PRESET': 'Dev'}):
                self.assertEqual(config.engine_build().name, 'dev')
                self.assertNotEqual(config.native_build(True), release)
            with patch.dict(os.environ, {'DERPBIRD_ENGINE_BUILD': 'artifacts/custom-engine'}):
                self.assertEqual(config.engine_build(), config.ROOT / 'artifacts/custom-engine')
                self.assertNotEqual(config.native_build(True), release)

    def test_invalid_configuration_fails_early(self):
        for name, value, function in [('DERPBIRD_BUILD_PRESET', 'typo', config.build_preset),
                                      ('DERPBIRD_BUILD_JOBS', '0', config.build_jobs),
                                      ('DERPBIRD_TEST_JOBS', '-1', config.test_jobs)]:
            with self.subTest(name=name), patch.dict(os.environ, {name: value}), self.assertRaises(ValueError):
                function()

    def test_unknown_suite_is_rejected_before_building(self):
        with patch.object(build_tasks, 'prepare') as prepare, self.assertRaises(ValueError):
            build_tasks.build_suites(['NotAnEngineSuite'])
        prepare.assert_not_called()

    def test_selected_suites_build_dependencies_before_test_targets(self):
        calls = []
        with patch.object(build_tasks, 'prepare', side_effect=lambda: calls.append('prepare')), \
             patch.object(build_tasks, 'build_engine', side_effect=lambda targets: calls.append(('engine', targets))), \
             patch.object(build_tasks, 'configure_tests', side_effect=lambda *args: calls.append('configure')), \
             patch.object(build_tasks, 'run', side_effect=lambda command: calls.append(command)):
            build_tasks.build_suites(['TestDerpBirdShell'])
        self.assertEqual(calls[:3], ['prepare', ('engine', ('Ladybird', 'LibTest')), 'configure'])
        self.assertEqual(calls[3][-2:], ['--target', 'TestDerpBirdShell'])


class RegressionRunnerTests(unittest.TestCase):
    def test_stale_case_list_cannot_pass(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source = directory / 'TestFixture.cpp'
            source.write_text('TEST_CASE(new_case)\n')
            with patch.object(regressions, 'run', return_value=(0, 'TestFixture::old_case\n')) as run:
                result = regressions.run_suite(source, directory, 1)
            self.assertFalse(result['passed'])
            self.assertEqual(run.call_count, 1)
            self.assertIn('Compiled cases differ', result['error'])

    def test_success_exit_with_missing_execution_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source = directory / 'TestFixture.cpp'
            source.write_text('TEST_CASE(actual_case)\n')
            with patch.object(regressions, 'run', side_effect=[(0, 'TestFixture::actual_case\n'), (0, 'No tests run\n')]):
                result = regressions.run_suite(source, directory, 1)
            self.assertFalse(result['passed'])


if __name__ == '__main__':
    unittest.main()
