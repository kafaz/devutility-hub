import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getNextTerminalScrollMode,
  isTerminalNearBottom,
  shouldShowTerminalScrollOverlay,
  type TerminalScrollMetrics,
} from './terminalScroll.ts';

function metrics(overrides: Partial<TerminalScrollMetrics> = {}): TerminalScrollMetrics {
  return {
    visible: true,
    bufferType: 'normal',
    viewportY: 90,
    rows: 10,
    bufferLength: 100,
    ...overrides,
  };
}

test('isTerminalNearBottom treats the current bottom and a small threshold as bottom', () => {
  assert.equal(isTerminalNearBottom(metrics({ viewportY: 90, rows: 10, bufferLength: 100 })), true);
  assert.equal(isTerminalNearBottom(metrics({ viewportY: 88, rows: 10, bufferLength: 100 })), true);
  assert.equal(isTerminalNearBottom(metrics({ viewportY: 87, rows: 10, bufferLength: 100 })), false);
});

test('getNextTerminalScrollMode pauses when the operator scrolls away from bottom', () => {
  assert.equal(
    getNextTerminalScrollMode('following', metrics({ viewportY: 60, rows: 10, bufferLength: 100 })),
    'history',
  );
});

test('getNextTerminalScrollMode resumes when the operator returns near bottom', () => {
  assert.equal(
    getNextTerminalScrollMode('history', metrics({ viewportY: 89, rows: 10, bufferLength: 100 })),
    'following',
  );
});

test('alternate and hidden terminals stay in following mode and suppress the overlay', () => {
  assert.equal(
    getNextTerminalScrollMode('history', metrics({ bufferType: 'alternate', viewportY: 5 })),
    'following',
  );
  assert.equal(
    getNextTerminalScrollMode('history', metrics({ visible: false, viewportY: 5 })),
    'following',
  );
  assert.equal(
    shouldShowTerminalScrollOverlay({ visible: true, bufferType: 'alternate', mode: 'history' }),
    false,
  );
  assert.equal(
    shouldShowTerminalScrollOverlay({ visible: false, bufferType: 'normal', mode: 'history' }),
    false,
  );
});

test('normal visible history mode shows the back-to-bottom overlay', () => {
  assert.equal(
    shouldShowTerminalScrollOverlay({ visible: true, bufferType: 'normal', mode: 'history' }),
    true,
  );
});
