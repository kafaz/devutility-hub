import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('floating source window owns draggable resizable function-only behavior', () => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const componentPath = path.join(currentDir, 'FloatingSourceWindow.tsx');

  assert.equal(fs.existsSync(componentPath), true, 'expected FloatingSourceWindow.tsx to exist');

  const componentSource = fs.readFileSync(componentPath, 'utf8');

  assert.match(componentSource, /export interface FloatingSourceWindowProps/);
  assert.match(componentSource, /open:\s*boolean;/);
  assert.match(componentSource, /onClose\(\): void;/);
  assert.match(componentSource, /position:\s*'fixed'/);
  assert.match(componentSource, /resize:\s*'both'/);
  assert.match(componentSource, /overflow:\s*'hidden'/);
  assert.match(componentSource, /cursor:\s*'move'/);
  assert.match(componentSource, /onMouseDown=\{handleDragStart\}/);
  assert.match(componentSource, /window\.addEventListener\('mousemove'/);
  assert.match(componentSource, /window\.addEventListener\('mouseup'/);
});

test('diagnostic workbench uses the floating source window instead of the old source drawer', () => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const workbenchSource = fs.readFileSync(path.join(currentDir, 'index.tsx'), 'utf8');

  assert.match(workbenchSource, /import FloatingSourceWindow from '\.\/FloatingSourceWindow';/);
  assert.match(workbenchSource, /sourceWindowOpen && sourcePreview\?\.lookupMode === 'function'/);
  assert.match(workbenchSource, /<FloatingSourceWindow/);
  assert.doesNotMatch(workbenchSource, /title="C 源码上下文"[\s\S]*placement="right"[\s\S]*width=\{900\}/);
});

test('session log lane exposes selectable function chips instead of auto-opening source', () => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const laneSource = fs.readFileSync(path.join(currentDir, 'LocalizationDesk', 'SessionLogLane.tsx'), 'utf8');

  assert.match(laneSource, /extractCLookupHints/);
  assert.match(laneSource, /函数线索/);
  assert.match(laneSource, /functionCandidate:\s*candidate/);
  assert.match(laneSource, /onLocateSource\(request,\s*\{\s*functionCandidate:\s*candidate\s*\}\)/);
});
