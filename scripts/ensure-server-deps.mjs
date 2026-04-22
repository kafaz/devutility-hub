import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function getServerDir(repoDir) {
  return path.join(repoDir, 'server');
}

function getServerPackageJsonPath(repoDir) {
  return path.join(getServerDir(repoDir), 'package.json');
}

function getServerLockfilePath(repoDir) {
  return path.join(getServerDir(repoDir), 'package-lock.json');
}

function getServerManifest(repoDir) {
  return JSON.parse(fs.readFileSync(getServerPackageJsonPath(repoDir), 'utf8'));
}

function getInstalledDependencyManifestPath(serverDir, packageName) {
  return path.join(serverDir, 'node_modules', ...packageName.split('/'), 'package.json');
}

export function findMissingServerDependencies(repoDir) {
  const serverDir = getServerDir(repoDir);
  const manifest = getServerManifest(repoDir);
  const declaredDependencies = Object.keys(manifest.dependencies || {});

  return declaredDependencies.filter((packageName) => !fs.existsSync(getInstalledDependencyManifestPath(serverDir, packageName)));
}

export function ensureServerDependencies(
  repoDir,
  {
    spawnSyncImpl = spawnSync,
    stdio = 'inherit',
  } = {}
) {
  const missingDependencies = findMissingServerDependencies(repoDir);
  if (missingDependencies.length === 0) {
    return {
      installed: false,
      missingDependencies: [],
    };
  }

  const serverDir = getServerDir(repoDir);
  const installSubcommand = fs.existsSync(getServerLockfilePath(repoDir)) ? 'ci' : 'install';
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSyncImpl(
    npmCommand,
    ['--prefix', serverDir, installSubcommand],
    {
      cwd: repoDir,
      stdio,
      env: process.env,
    }
  );

  if (result.status !== 0) {
    throw new Error(`server 依赖安装失败，缺失依赖: ${missingDependencies.join(', ')}`);
  }

  return {
    installed: true,
    missingDependencies,
  };
}

function getRepoDirFromScriptLocation() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoDir = getRepoDirFromScriptLocation();
  const result = ensureServerDependencies(repoDir);
  if (result.installed) {
    console.log(`[dev bootstrap] installed missing server dependencies: ${result.missingDependencies.join(', ')}`);
  }
}
