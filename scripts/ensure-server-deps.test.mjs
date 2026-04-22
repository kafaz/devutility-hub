import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ensureServerDependencies,
  findMissingServerDependencies,
} from './ensure-server-deps.mjs';

function withTempRepo(setup) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devutility-hub-server-deps-'));
  try {
    setup(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

test('findMissingServerDependencies reports declared server packages that are not installed', () => {
  withTempRepo((repoDir) => {
    writeJson(path.join(repoDir, 'server', 'package.json'), {
      dependencies: {
        express: '^4.18.2',
        ws: '^8.17.0',
      },
    });
    fs.mkdirSync(path.join(repoDir, 'server', 'node_modules', 'ws'), { recursive: true });
    writeJson(path.join(repoDir, 'server', 'node_modules', 'ws', 'package.json'), { name: 'ws', version: '8.17.0' });

    assert.deepEqual(findMissingServerDependencies(repoDir), ['express']);
  });
});

test('ensureServerDependencies skips installation when declared server dependencies are already present', async () => {
  withTempRepo((repoDir) => {
    writeJson(path.join(repoDir, 'server', 'package.json'), {
      dependencies: {
        express: '^4.18.2',
      },
    });
    fs.mkdirSync(path.join(repoDir, 'server', 'node_modules', 'express'), { recursive: true });
    writeJson(path.join(repoDir, 'server', 'node_modules', 'express', 'package.json'), { name: 'express', version: '4.18.2' });

    let called = false;
    const result = ensureServerDependencies(repoDir, {
      spawnSyncImpl() {
        called = true;
        return { status: 0 };
      },
    });

    assert.equal(called, false);
    assert.deepEqual(result, { installed: false, missingDependencies: [] });
  });
});

test('ensureServerDependencies runs npm ci in server when required packages are missing', async () => {
  withTempRepo((repoDir) => {
    writeJson(path.join(repoDir, 'server', 'package.json'), {
      dependencies: {
        express: '^4.18.2',
      },
    });
    writeJson(path.join(repoDir, 'server', 'package-lock.json'), { name: 'ssh-proxy', lockfileVersion: 3 });

    let received = null;
    const result = ensureServerDependencies(repoDir, {
      spawnSyncImpl(command, args, options) {
        received = { command, args, options };
        return { status: 0 };
      },
    });

    assert.deepEqual(result, { installed: true, missingDependencies: ['express'] });
    assert.ok(received);
    assert.match(received.command, /npm(\.cmd)?$/);
    assert.deepEqual(received.args, ['--prefix', path.join(repoDir, 'server'), 'ci']);
    assert.equal(received.options.cwd, repoDir);
  });
});
