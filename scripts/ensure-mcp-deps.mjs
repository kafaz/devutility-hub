import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoDir = path.resolve(__dirname, '..');
const mcpDir = path.join(repoDir, 'mcp-server');
const mcpNodeModules = path.join(mcpDir, 'node_modules');
const mcpDist = path.join(mcpDir, 'dist', 'index.js');
const mcpLockfile = path.join(mcpDir, 'package-lock.json');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    throw new Error(`命令失败: ${cmd} ${args.join(' ')}`);
  }
}

// 1. 检查并安装 mcp-server 依赖
if (!fs.existsSync(mcpNodeModules)) {
  console.log('[dev bootstrap] installing mcp-server dependencies...');
  const subCmd = fs.existsSync(mcpLockfile) ? 'ci' : 'install';
  run(npmCommand, ['--prefix', mcpDir, subCmd, '--no-audit', '--no-fund'], repoDir);
}

// 2. 检查并编译 mcp-server（dist 不存在时）
if (!fs.existsSync(mcpDist)) {
  console.log('[dev bootstrap] building mcp-server (dist not found)...');
  run(npmCommand, ['--prefix', mcpDir, 'run', 'build'], repoDir);
}
