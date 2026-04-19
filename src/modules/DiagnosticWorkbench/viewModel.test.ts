import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEvidenceDrawerSummary,
  getDiagnosticWorkbenchSections,
} from './viewModel.ts';

test('flow view only exposes the four-step localization funnel in order', () => {
  const sections = getDiagnosticWorkbenchSections('flow');

  assert.deepEqual(
    sections.map((section) => section.id),
    ['context', 'execution', 'evidence', 'conclusion']
  );
});

test('config view keeps editing surfaces out of the localization funnel', () => {
  const sections = getDiagnosticWorkbenchSections('config');

  assert.deepEqual(
    sections.map((section) => section.id),
    ['playbook', 'library', 'policy']
  );
});

test('history view is focused on archived runs and current detail drill-down', () => {
  const sections = getDiagnosticWorkbenchSections('history');

  assert.deepEqual(
    sections.map((section) => section.id),
    ['runs', 'detail']
  );
});

test('evidence drawer summary keeps newest titles first and caps the preview list', () => {
  const summary = buildEvidenceDrawerSummary([
    { id: 'e-1', title: '最早 evidence' },
    { id: 'e-2', title: '中间 evidence' },
    { id: 'e-3', title: '较新 evidence' },
    { id: 'e-4', title: '最新 evidence' },
  ]);

  assert.equal(summary.count, 4);
  assert.deepEqual(summary.recentTitles, ['最新 evidence', '较新 evidence', '中间 evidence']);
});
