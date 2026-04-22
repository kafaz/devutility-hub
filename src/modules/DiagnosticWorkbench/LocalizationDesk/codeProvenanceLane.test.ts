import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('code provenance lane owns a standalone manual-navigation contract', () => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const lanePath = path.join(currentDir, 'CodeProvenanceLane.tsx');

  assert.equal(fs.existsSync(lanePath), true, 'expected standalone CodeProvenanceLane.tsx to exist');

  const laneSource = fs.readFileSync(lanePath, 'utf8');

  assert.match(laneSource, /export interface CodeProvenanceLaneProps/);
  assert.match(laneSource, /binding:\s*LocalizationDeskCodeContextSummary \| null;/);
  assert.match(laneSource, /navigationStack\?:\s*CodeProvenanceNavigationEntry\[\];/);
  assert.match(laneSource, /forwardTargets\?:\s*CodeProvenanceForwardTarget\[\];/);
  assert.match(laneSource, /onExpandAbove\?\(\): void;/);
  assert.match(laneSource, /onExpandBelow\?\(\): void;/);
  assert.match(laneSource, /onOpenFullFunction\?\(\): void;/);
  assert.match(laneSource, /onNavigateForward\?\(target: CodeProvenanceForwardTarget\): void;/);
  assert.match(laneSource, /onJumpBack\?\(index: number\): void;/);
  assert.match(laneSource, /手动代码溯源/);
  assert.match(laneSource, /不做自动推荐，所有展开和跳转都由你手动触发/);
  assert.match(laneSource, /Expand above|向上展开/);
  assert.match(laneSource, /Expand below|向下展开/);
  assert.match(laneSource, /Full function|完整函数/);
  assert.match(laneSource, /Click function forward|点击函数前进/);
  assert.match(laneSource, /Jump back|跳回上一个函数/);
  assert.match(laneSource, /repoDisplayName/);
  assert.match(laneSource, /branch/);
  assert.match(laneSource, /commit\.slice\(0,\s*12\)/);
  assert.match(laneSource, /Bind a repo\/branch\/commit first|请先绑定 repo\/branch\/commit/);
});
