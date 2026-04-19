import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mergePrepareInsightSummaries,
  summarizePrepareRun,
} from './prepareInsights.ts';

test('summarizePrepareRun extracts ready context, shell, tools, and slowest step', () => {
  const summary = summarizePrepareRun([
    {
      name: 'ready-shell-bootstrap',
      stdout: [
        'READY user=root host=node-a pwd=/srv/app',
        '[context] user=root',
        '[context] host=node-a',
        '[context] pwd=/srv/app',
        '[context] shell=zsh',
      ].join('\n'),
      stderr: '',
      durationMs: 140,
      exitCode: 0,
      status: 'done',
    },
    {
      name: 'warm-common-tools',
      stdout: '[tool] journalctl=/usr/bin/journalctl\n[tool] tail=/usr/bin/tail',
      stderr: '',
      durationMs: 220,
      exitCode: 0,
      status: 'done',
    },
  ]);

  assert.equal(summary.readyLine, 'root @ node-a · /srv/app');
  assert.equal(summary.shell, 'zsh');
  assert.equal(summary.slowestStepName, 'warm-common-tools');
  assert.equal(summary.slowestStepDurationMs, 220);
  assert.equal(summary.warmedToolCount, 2);
  assert.ok(summary.missingTools.includes('dmesg'));
});

test('mergePrepareInsightSummaries preserves ready context and upgrades tool insights from background steps', () => {
  const readySummary = summarizePrepareRun([
    {
      name: 'ready-shell-bootstrap',
      stdout: 'READY user=root host=node-a pwd=/srv/app\n[context] shell=bash',
      stderr: '',
      durationMs: 90,
      exitCode: 0,
      status: 'done',
    },
  ]);
  const backgroundSummary = summarizePrepareRun([
    {
      name: 'warm-common-tools',
      stdout: '[tool] journalctl=/usr/bin/journalctl\n[tool] grep=/usr/bin/grep',
      stderr: '',
      durationMs: 180,
      exitCode: 0,
      status: 'cached',
    },
  ]);

  const merged = mergePrepareInsightSummaries(readySummary, backgroundSummary);
  assert.equal(merged.readyLine, 'root @ node-a · /srv/app');
  assert.equal(merged.shell, 'bash');
  assert.equal(merged.warmedToolCount, 2);
  assert.equal(merged.slowestStepName, 'warm-common-tools');
  assert.equal(merged.durationMs, 270);
});
