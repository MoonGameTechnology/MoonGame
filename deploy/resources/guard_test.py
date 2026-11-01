"""Circuit-breaker policy and action tests; no Docker or production disk mutation."""
import importlib.util
import json
from pathlib import Path
import stat
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('resource_guard', Path(__file__).with_name('guard.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


def healthy():
    return {'free_bytes': 20 * guard.GIB, 'free_inodes': 1_000_000,
            'usage': dict.fromkeys(guard.VOLUMES, 1024)}


class PolicyTests(unittest.TestCase):
    def test_rotating_file_retries_measurement_without_accepting_partial_du_output(self):
        replies = ['/var/lib/docker', 'deploy_void-pgdata\ndeploy_void-logs',
                   '/var/lib/docker/volumes/deploy_void-pgdata/_data',
                   subprocess.CalledProcessError(1, ['du'], output='999999 partial'),
                   '4096\t/var/lib/docker/volumes/deploy_void-pgdata/_data',
                   '/var/lib/docker/volumes/deploy_void-logs/_data',
                   '8192\t/var/lib/docker/volumes/deploy_void-logs/_data']
        disk = SimpleNamespace(f_bavail=10_000_000, f_frsize=4096, f_favail=1_000_000)
        with patch.object(guard, 'run', side_effect=replies), \
             patch.object(guard, 'protected'), patch.object(guard.os, 'statvfs', return_value=disk), \
             patch.object(Path, 'lstat', return_value=SimpleNamespace(st_mode=stat.S_IFDIR)):
            sample = guard.measure()
        self.assertEqual(sample['usage']['deploy_void-pgdata'], 4096)
        self.assertEqual(sample['usage']['deploy_void-logs'], 8192)

    def test_healthy_and_warning_do_not_stop_services(self):
        sample = healthy()
        self.assertEqual(guard.decision(sample)['level'], 0)
        sample['free_bytes'] = 7 * guard.GIB
        self.assertEqual(guard.decision(sample), {'level': 1, 'reasons': [], 'targets': []})

    def test_full_stage_volume_only_stops_stage(self):
        sample = healthy()
        sample['usage']['moongame-bots-stage-postgres'] = 2 * guard.GIB
        self.assertEqual(guard.decision(sample)['targets'], sorted(guard.STAGE))

    def test_full_log_volume_keeps_database_and_proxy_running(self):
        sample = healthy()
        sample['usage']['deploy_void-logs'] = 5 * guard.GIB // 4
        self.assertEqual(guard.decision(sample)['targets'], guard.PROD[:1])

    def test_filesystem_bytes_or_inodes_preserve_emergency_reserve(self):
        for key, threshold in [('free_bytes', guard.MIN_FREE), ('free_inodes', guard.MIN_INODES)]:
            sample = healthy()
            sample[key] = threshold
            self.assertEqual(guard.decision(sample)['targets'], sorted(guard.TARGETS))

    def test_unknown_missing_negative_and_boolean_samples_are_not_healthy(self):
        for change in [lambda s: s['usage'].pop('deploy_void-logs'),
                       lambda s: s['usage'].update(unknown=1),
                       lambda s: s.update(free_bytes=-1),
                       lambda s: s.update(free_bytes=True)]:
            sample = healthy()
            change(sample)
            with self.assertRaises(ValueError):
                guard.decision(sample)


class ActionTests(unittest.TestCase):
    def test_intent_is_durable_before_application_stop(self):
        sample = healthy()
        sample['usage']['deploy_void-pgdata'] = 8 * guard.GIB
        calls = []
        with patch.object(guard, 'measure', return_value=sample), \
             patch.object(guard, 'read_pressure', return_value=None), \
             patch.object(guard, 'save', side_effect=lambda p, v: calls.append(('save', p))), \
             patch.object(guard, 'stop', side_effect=lambda names: calls.append(('stop', names))):
            guard.enforce()
        self.assertEqual(calls[0], ('save', guard.PRESSURE))
        self.assertEqual(calls[1], ('stop', sorted(guard.PROD)))

    def test_measurement_failure_stops_writers_and_reports_failure(self):
        with patch.object(guard, 'measure', side_effect=OSError), \
             patch.object(guard, 'save') as save, patch.object(guard, 'stop') as stop:
            with self.assertRaisesRegex(RuntimeError, 'E_RESOURCE_MEASURE'):
                guard.enforce()
            stop.assert_called_once_with(guard.TARGETS)
            self.assertTrue(save.call_args.args[1]['measurement_error'])

    def test_measurement_failure_records_safe_cause_and_preserves_stop(self):
        error = subprocess.TimeoutExpired(
            ['docker', '--host=unix:///var/run/docker.sock', 'info', 'secret-argument'],
            30, output='secret-output', stderr='secret-stderr')
        with patch.object(guard, 'measure', side_effect=error), \
             patch.object(guard, 'save') as save, patch.object(guard, 'stop') as stop:
            with self.assertRaisesRegex(RuntimeError, 'E_RESOURCE_MEASURE'):
                guard.enforce()
            stop.assert_called_once_with(guard.TARGETS)
            marker, status = [call.args[1] for call in save.call_args_list]
            expected = {'kind': 'timeout', 'operation': 'docker-root', 'returncode': None}
            self.assertEqual(marker['measurement_failure'], expected)
            self.assertEqual(status['measurement_failure'], expected)
            self.assertNotIn('secret-', json.dumps([marker, status]))

    def test_measurement_command_failure_exposes_only_bounded_returncode(self):
        error = subprocess.CalledProcessError(137, ['du', '/private/path'], stderr='private-token')
        self.assertEqual(guard.measurement_failure(error), {
            'kind': 'command', 'operation': 'volume-size', 'returncode': 137})
        self.assertEqual(guard.measurement_failure(ValueError('private-token')), {
            'kind': 'validation', 'operation': 'unknown', 'returncode': None})

    def test_healthy_measurement_retains_the_original_blocking_cause(self):
        details = {'kind': 'timeout', 'operation': 'volume-list', 'returncode': None}
        previous = {'at': 1, 'reasons': ['measurement_failed'],
                    'targets': guard.TARGETS, 'measurement_failure': details}
        with patch.object(guard, 'measure', return_value=healthy()), \
             patch.object(guard, 'read_pressure', return_value=previous), \
             patch.object(guard, 'save') as save, patch.object(guard, 'stop') as stop:
            status = guard.enforce()
            self.assertEqual(status['measurement_failure'], details)
            self.assertFalse(status['measurement_error'])
            self.assertEqual(status['level'], 2)
            stop.assert_called_once_with(sorted(guard.TARGETS))
            self.assertEqual(save.call_args_list[0].args[1]['measurement_failure'], details)

    def test_marker_write_failure_still_attempts_to_stop_writers(self):
        sample = healthy()
        sample['free_bytes'] = 0
        with patch.object(guard, 'measure', return_value=sample), \
             patch.object(guard, 'read_pressure', return_value=None), \
             patch.object(guard, 'save', side_effect=OSError), patch.object(guard, 'stop') as stop:
            with self.assertRaises(OSError):
                guard.enforce()
            stop.assert_called_once_with(sorted(guard.TARGETS))

    def test_stop_failure_never_records_a_success_status(self):
        sample = healthy()
        sample['free_bytes'] = 0
        with patch.object(guard, 'measure', return_value=sample), \
             patch.object(guard, 'read_pressure', return_value=None), \
             patch.object(guard, 'save') as save, patch.object(guard, 'stop', side_effect=RuntimeError):
            with self.assertRaises(RuntimeError):
                guard.enforce()
            self.assertEqual(save.call_count, 1)
            self.assertEqual(save.call_args.args[0], guard.PRESSURE)

    def test_recovery_keeps_latch_until_operator_resume(self):
        previous = {'at': 1, 'reasons': ['deploy_void-pgdata'], 'targets': guard.PROD}
        with patch.object(guard, 'measure', return_value=healthy()), \
             patch.object(guard, 'read_pressure', return_value=previous), \
             patch.object(guard, 'save'), patch.object(guard, 'stop') as stop:
            result = guard.enforce()
            self.assertEqual(result['level'], 2)
            stop.assert_called_once_with(sorted(guard.PROD))

    def test_stop_drains_application_before_database_and_uses_exact_ids(self):
        ids = ['a' * 64, 'b' * 64, 'c' * 64]
        inventory = '\n'.join(f'{i} {n}' for i, n in zip(ids, [*guard.PROD, 'unrelated']))
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            return inventory if args[1] == 'ps' else ''
        with patch.object(guard, 'run', side_effect=run):
            guard.stop(guard.PROD)
        self.assertEqual(calls[1], ['docker', 'stop', '--time', '60', ids[0]])
        self.assertEqual(calls[2], ['docker', 'stop', '--time', '60', ids[1]])
        self.assertNotIn(ids[2], sum(calls, []))

    def test_stopped_services_are_not_started_or_updated(self):
        with patch.object(guard, 'run', return_value='') as run:
            guard.stop(guard.TARGETS)
            self.assertEqual(run.call_count, 1)

    def test_unknown_target_is_refused_before_docker(self):
        with patch.object(guard, 'run') as run:
            with self.assertRaises(ValueError):
                guard.stop(['unrelated'])
            run.assert_not_called()

    def test_container_stop_failure_does_not_skip_database_protection(self):
        rows = f'{"a" * 64} {guard.PROD[0]}\n{"b" * 64} {guard.PROD[1]}'
        with patch.object(guard, 'run', side_effect=[rows, RuntimeError(), '']) as run:
            with self.assertRaises(RuntimeError):
                guard.stop(guard.PROD)
            self.assertEqual(run.call_count, 3)


if __name__ == '__main__':
    unittest.main()
