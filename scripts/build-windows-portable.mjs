import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      result[key] = 'true';
      continue;
    }
    result[key] = next;
    index += 1;
  }
  return result;
}

async function ensureExists(targetPath, message) {
  try {
    await fs.access(targetPath);
  } catch {
    throw new Error(message);
  }
}

async function copyInto(sourcePath, destinationPath) {
  await fs.cp(sourcePath, destinationPath, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });
}

function renderPortableServerScript() {
  return [
    '@echo off',
    'setlocal',
    'for %%I in ("%~dp0..") do set "ROOT=%%~fI"',
    'if not defined HOST set "HOST=127.0.0.1"',
    'if not defined PORT set "PORT=3001"',
    'if not defined STATIC_DIR set "STATIC_DIR=%ROOT%\\app"',
    'if not defined DEVUTILITY_DATA_DIR set "DEVUTILITY_DATA_DIR=%ROOT%\\data"',
    'if not exist "%ROOT%\\runtime\\node.exe" (',
    '  echo [portable] Missing runtime\\node.exe',
    '  exit /b 1',
    ')',
    'if not exist "%STATIC_DIR%\\index.html" (',
    '  echo [portable] Missing frontend bundle in %STATIC_DIR%',
    '  exit /b 1',
    ')',
    'if not exist "%DEVUTILITY_DATA_DIR%" mkdir "%DEVUTILITY_DATA_DIR%"',
    'pushd "%~dp0"',
    '"%ROOT%\\runtime\\node.exe" "%~dp0index.js"',
    'set "EXIT_CODE=%ERRORLEVEL%"',
    'popd',
    'exit /b %EXIT_CODE%',
    '',
  ].join('\r\n');
}

function renderPortableStartScript() {
  return [
    '@echo off',
    'setlocal',
    'set "ROOT=%~dp0"',
    'if not defined HOST set "HOST=127.0.0.1"',
    'if not defined PORT set "PORT=3001"',
    'start "DevUtility Hub Server" cmd /k ""%ROOT%server\\run-portable-server.cmd""',
    'timeout /t 2 /nobreak >nul',
    'start "" "http://%HOST%:%PORT%"',
    '',
  ].join('\r\n');
}

function renderPortableReadme() {
  return [
    'DevUtility Hub Windows Portable',
    '===============================',
    '',
    '1. Double-click "Start DevUtility Hub.bat".',
    '2. The launcher starts the bundled Node runtime and serves the built frontend.',
    '3. Your browser opens to http://127.0.0.1:3001 once the local proxy is up.',
    '',
    'Package layout',
    '--------------',
    '- Start DevUtility Hub.bat: launcher for the bundled app',
    '- app/: built frontend assets served by the local proxy',
    '- server/: Node/Express proxy service and runtime dependencies',
    '- runtime/: bundled official Node.js Windows runtime',
    '- data/: runtime data generated on first launch',
    '',
    'Notes',
    '-----',
    '- No system-wide Node.js installation is required.',
    '- If port 3001 is occupied, launch from a terminal with: set PORT=3101 && Start DevUtility Hub.bat',
    '- Runtime data is written into the sibling data/ directory, not into server/data/.',
    '',
  ].join('\r\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const nodeRuntimeInput = args['node-runtime-dir'] || process.env.NODE_RUNTIME_DIR;
  const outputDir = path.resolve(
    args['output-dir']
      || process.env.PORTABLE_OUTPUT_DIR
      || path.join(repoRoot, 'release', 'devutility-hub-windows-portable')
  );

  if (!nodeRuntimeInput) {
    throw new Error('Missing --node-runtime-dir. Point it at an extracted official Node.js Windows runtime directory.');
  }
  const nodeRuntimeDir = path.resolve(nodeRuntimeInput);

  const frontendDistDir = path.join(repoRoot, 'dist');
  const serverRoot = path.join(repoRoot, 'server');
  const runtimeNodeExe = path.join(nodeRuntimeDir, 'node.exe');

  await ensureExists(frontendDistDir, 'Missing dist/. Run `npm run build` first.');
  await ensureExists(path.join(frontendDistDir, 'index.html'), 'Missing dist/index.html. Run `npm run build` first.');
  await ensureExists(path.join(serverRoot, 'index.js'), 'Missing server/index.js.');
  await ensureExists(path.join(serverRoot, 'node_modules'), 'Missing server/node_modules. Run `npm ci --prefix server` first.');
  await ensureExists(runtimeNodeExe, `Missing ${runtimeNodeExe}.`);

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const appDir = path.join(outputDir, 'app');
  const runtimeDir = path.join(outputDir, 'runtime');
  const serverDir = path.join(outputDir, 'server');
  const dataDir = path.join(outputDir, 'data');

  await copyInto(frontendDistDir, appDir);
  await copyInto(nodeRuntimeDir, runtimeDir);

  await fs.mkdir(serverDir, { recursive: true });
  for (const entry of [
    'index.js',
    'runtimeHelpers.js',
    'storePaths.js',
    'agentPresets.js',
    'diagnosticKb.js',
    'commandPolicy.js',
    'codeContext.js',
    'package.json',
    'package-lock.json',
    'lib',
    'node_modules',
  ]) {
    await copyInto(path.join(serverRoot, entry), path.join(serverDir, entry));
  }

  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'README.txt'), 'Runtime data is created here on first launch.\r\n', 'utf8');
  await fs.writeFile(path.join(serverDir, 'run-portable-server.cmd'), renderPortableServerScript(), 'utf8');
  await fs.writeFile(path.join(outputDir, 'Start DevUtility Hub.bat'), renderPortableStartScript(), 'utf8');
  await fs.writeFile(path.join(outputDir, 'README.txt'), renderPortableReadme(), 'utf8');

  console.log(`Portable package prepared at ${outputDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
