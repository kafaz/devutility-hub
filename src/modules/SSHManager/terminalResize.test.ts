import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldPublishTerminalResize,
  type TerminalResizeDimensions,
} from './terminalResize.ts';

test('shouldPublishTerminalResize suppresses hidden, zero-sized, and duplicate resizes', () => {
  const last: TerminalResizeDimensions = { cols: 120, rows: 36 };

  assert.equal(shouldPublishTerminalResize({ visible: false, next: { cols: 140, rows: 40 }, last }), false);
  assert.equal(shouldPublishTerminalResize({ visible: true, next: { cols: 0, rows: 40 }, last }), false);
  assert.equal(shouldPublishTerminalResize({ visible: true, next: { cols: 2, rows: 1 }, last }), false);
  assert.equal(shouldPublishTerminalResize({ visible: true, next: { cols: 120, rows: 36 }, last }), false);
});

test('shouldPublishTerminalResize allows visible dimension changes', () => {
  const last: TerminalResizeDimensions = { cols: 120, rows: 36 };

  assert.equal(shouldPublishTerminalResize({ visible: true, next: { cols: 121, rows: 36 }, last }), true);
  assert.equal(shouldPublishTerminalResize({ visible: true, next: { cols: 120, rows: 37 }, last }), true);
  assert.equal(shouldPublishTerminalResize({ visible: true, next: { cols: 80, rows: 24 }, last: null }), true);
});
