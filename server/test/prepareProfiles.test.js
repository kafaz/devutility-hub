const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_PREPARE_PROFILES,
  mergeDefaultPrepareProfiles,
  selectPrepareProfileSteps,
} = require('../lib/agentRegistry');

test('problem localization boost splits fast readiness steps from background warmup', () => {
  const fastPath = DEFAULT_PREPARE_PROFILES.find((item) => item.profileId === 'linux-problem-localization-fast-path');
  const boost = DEFAULT_PREPARE_PROFILES.find((item) => item.profileId === 'linux-problem-localization-boost');
  assert.ok(fastPath, 'expected builtin fast-path localization profile');
  assert.ok(boost, 'expected builtin boost localization profile');
  assert.match(fastPath.steps.find((step) => step.name === 'load-shell-profile').cmd, /ps -p \$\$ -o comm=/);
  assert.match(fastPath.steps.find((step) => step.name === 'collect-target-identity').cmd, /\[context\] shell=/);
  assert.equal(fastPath.steps.find((step) => step.name === 'collect-target-identity').cacheKey, 'collect-target-identity');
  assert.equal(fastPath.steps.find((step) => step.name === 'warm-common-tools').cacheKey, 'warm-common-tools');
  assert.match(boost.steps.find((step) => step.name === 'collect-runtime-window').cmd, /WINDOW ts=/);

  assert.deepEqual(
    selectPrepareProfileSteps(fastPath, 'essential').map((step) => step.name),
    ['load-shell-profile', 'set-diagnostic-env']
  );
  assert.deepEqual(
    selectPrepareProfileSteps(fastPath, 'background').map((step) => step.name),
    ['collect-target-identity', 'collect-working-dir', 'warm-common-tools']
  );
  assert.deepEqual(
    selectPrepareProfileSteps(boost, 'background').map((step) => step.name),
    ['collect-target-identity', 'collect-working-dir', 'warm-common-tools', 'collect-runtime-window']
  );
});

test('legacy steps without stage default to essential', () => {
  const legacySteps = [{ name: 'plain-step', cmd: 'echo ready' }];
  const essential = selectPrepareProfileSteps(legacySteps, 'essential');
  const background = selectPrepareProfileSteps(legacySteps, 'background');

  assert.equal(essential.length, 1);
  assert.equal(essential[0].stage, 'essential');
  assert.equal(background.length, 0);
});

test('legacy builtin localization profile is upgraded to staged system defaults', () => {
  const builtin = DEFAULT_PREPARE_PROFILES.find((item) => item.profileId === 'linux-problem-localization-boost');
  assert.ok(builtin, 'expected builtin localization profile');

  const legacyProfile = {
    profileId: builtin.profileId,
    name: builtin.name,
    description: 'legacy profile',
    steps: builtin.steps.map((step) => ({ name: step.name, cmd: step.cmd })),
    createdAt: 123,
    updatedAt: 456,
  };

  const { profiles, changed } = mergeDefaultPrepareProfiles([legacyProfile]);
  const upgraded = profiles.find((item) => item.profileId === legacyProfile.profileId);

  assert.equal(changed, true);
  assert.ok(upgraded, 'expected upgraded localization profile');
  assert.equal(upgraded.createdAt, 123);
  assert.equal(upgraded.managedBy, 'system');
  assert.equal(upgraded.version, 3);
  assert.deepEqual(
    selectPrepareProfileSteps(upgraded, 'background').map((step) => step.name),
    ['collect-target-identity', 'collect-working-dir', 'warm-common-tools', 'collect-runtime-window']
  );
});
