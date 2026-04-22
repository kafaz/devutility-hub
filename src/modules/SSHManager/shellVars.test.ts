import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShellVarsSyncScript,
  escapeShellSingleQuotedValue,
  isValidShellVarName,
} from './shellVars.ts';

test('isValidShellVarName accepts valid shell identifiers', () => {
  assert.equal(isValidShellVarName('build_id'), true);
  assert.equal(isValidShellVarName('_pod_1'), true);
  assert.equal(isValidShellVarName('1bad'), false);
  assert.equal(isValidShellVarName('bad-name'), false);
});

test('escapeShellSingleQuotedValue keeps single quoted exports safe', () => {
  assert.equal(escapeShellSingleQuotedValue(`prod'blue`), `prod'"'"'blue`);
});

test('buildShellVarsSyncScript exports changed vars and unsets removed ones', () => {
  const script = buildShellVarsSyncScript(
    { node_host: '10.0.0.1', old_var: 'legacy' },
    { node_host: '10.0.0.2', build_id: 'release-42' }
  );

  assert.equal(
    script,
    [
      'unset old_var',
      `export node_host='10.0.0.2'`,
      `export build_id='release-42'`,
    ].join('\n')
  );
});

test('buildShellVarsSyncScript ignores invalid shell variable names', () => {
  const script = buildShellVarsSyncScript({}, {
    'bad-name': 'x',
    good_name: 'ok',
  });

  assert.equal(script, `export good_name='ok'`);
});
