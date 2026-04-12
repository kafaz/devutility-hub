const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { simpleGit } = require('simple-git');

const STORE_ROOT = path.join(os.tmpdir(), 'devutility-code-context');
const REPO_CACHE_ROOT = path.join(STORE_ROOT, 'repos');
const INDEX_CACHE_ROOT = path.join(STORE_ROOT, 'indexes');

const activeContexts = new Map();

const SOURCE_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cxx',
  '.go',
  '.h',
  '.hpp',
  '.java',
  '.js',
  '.jsx',
  '.kt',
  '.mjs',
  '.php',
  '.py',
  '.rs',
  '.ts',
  '.tsx',
]);

const IGNORED_PATH_SEGMENTS = new Set([
  '.git',
  '.idea',
  '.next',
  '.vscode',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'vendor',
]);

const JS_CONTROL_KEYWORDS = new Set([
  'catch',
  'for',
  'if',
  'switch',
  'while',
]);

const MAX_FILE_SIZE_BYTES = 1024 * 1024;
const FULL_INDEX_CONCURRENCY = 12;
const MAX_FAST_SEARCH_FILES = 120;
const MAX_FAST_SEARCH_LINE_DISTANCE = 6;
const INDEX_WARMUP_DELAY_MS = 1500;

function ensureRoots() {
  fs.mkdirSync(REPO_CACHE_ROOT, { recursive: true });
  fs.mkdirSync(INDEX_CACHE_ROOT, { recursive: true });
}

function makeHash(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex');
}

function encodeSymbolId(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function makeIndexCachePath(contextId) {
  return path.join(INDEX_CACHE_ROOT, `${contextId}.json.gz`);
}

function decodeSymbolId(symbolId) {
  try {
    return JSON.parse(Buffer.from(String(symbolId), 'base64url').toString('utf8'));
  } catch {
    throw new Error('symbolId 无效');
  }
}

function normalizeRepoDisplayName(repo) {
  const source = String(repo || '').trim().replace(/[\\/]+$/, '');
  if (!source) return '';
  const name = source.split(/[\\/]/).pop() || source;
  return name.replace(/\.git$/i, '') || source;
}

function isLocalRepoSource(repo) {
  const candidate = String(repo || '').trim();
  return Boolean(candidate) && fs.existsSync(candidate);
}

function buildGitAuthPrefix(repo, token) {
  if (!token) return [];
  try {
    const parsed = new URL(repo);
    if (!/^https?:$/i.test(parsed.protocol)) return [];
    const encoded = Buffer.from(`oauth2:${token}`).toString('base64');
    return ['-c', `http.extraHeader=AUTHORIZATION: Basic ${encoded}`];
  } catch {
    return [];
  }
}

function isSupportedSourceFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!SOURCE_EXTENSIONS.has(ext)) return false;
  const segments = filePath.split(/[\\/]/).filter(Boolean);
  return !segments.some((segment) => IGNORED_PATH_SEGMENTS.has(segment));
}

async function normalizeRepoSource(repo) {
  const trimmed = String(repo || '').trim();
  if (!trimmed) return trimmed;

  if (!fs.existsSync(trimmed)) {
    return trimmed;
  }

  const resolvedPath = path.resolve(trimmed);

  try {
    const git = simpleGit(resolvedPath);
    const topLevel = (await git.revparse(['--show-toplevel'])).trim();
    return topLevel || resolvedPath;
  } catch {
    return resolvedPath;
  }
}

function languageFromExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.go') return 'go';
  if (ext === '.py') return 'python';
  if (ext === '.java' || ext === '.kt') return 'jvm';
  if (ext === '.rs') return 'rust';
  if (ext === '.php') return 'php';
  if (['.js', '.jsx', '.ts', '.tsx', '.mjs'].includes(ext)) return 'javascript';
  return 'c-family';
}

function escapeRegex(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function refExists(git, ref) {
  try {
    const output = (await git.raw(['rev-parse', '--verify', '--quiet', ref])).trim();
    return Boolean(output);
  } catch {
    return false;
  }
}

async function resolveBranchRef(git, branch) {
  const remoteBranchRef = `refs/remotes/origin/${branch}`;
  const localBranchRef = `refs/heads/${branch}`;

  if (await refExists(git, remoteBranchRef)) {
    return `origin/${branch}`;
  }

  if (await refExists(git, localBranchRef) || (await refExists(git, branch))) {
    return branch;
  }

  return null;
}

async function isCommitOnBranch(git, commit, branchRef) {
  if (!commit || !branchRef) {
    return false;
  }

  if (!(await refExists(git, `${commit}^{commit}`))) {
    return false;
  }

  try {
    await git.raw(['merge-base', '--is-ancestor', commit, branchRef]);
    return true;
  } catch {
    return false;
  }
}

function buildBranchFetchArgs({ repo, branch, depth, deepen }) {
  const args = ['fetch', '--prune', '--no-tags'];

  if (!isLocalRepoSource(repo)) {
    if (Number.isFinite(depth) && depth > 0) {
      args.push(`--depth=${depth}`);
    } else if (Number.isFinite(deepen) && deepen > 0) {
      args.push(`--deepen=${deepen}`);
    }
  }

  args.push('origin', `refs/heads/${branch}:refs/remotes/origin/${branch}`);
  return args;
}

async function ensureCommitFetched({ git, repo, branch, commit, authPrefix }) {
  if (!commit || await refExists(git, `${commit}^{commit}`)) {
    return;
  }

  if (isLocalRepoSource(repo)) {
    return;
  }

  for (const deepenBy of [128, 512, 2048]) {
    try {
      await git.raw([...authPrefix, ...buildBranchFetchArgs({ repo, branch, deepen: deepenBy })]);
    } catch {
      // ignore deepen failures and fall through to the next attempt
    }

    if (await refExists(git, `${commit}^{commit}`)) {
      return;
    }
  }

  await git.raw([...authPrefix, ...buildBranchFetchArgs({ repo, branch })]);
}

async function initializeRepoCache({ repoDir, repo, branch, authPrefix }) {
  fs.rmSync(repoDir, { recursive: true, force: true });
  fs.mkdirSync(repoDir, { recursive: true });

  const git = simpleGit(repoDir);
  await git.init();
  await git.addRemote('origin', repo);
  await git.raw([...authPrefix, ...buildBranchFetchArgs({ repo, branch, depth: 1 })]);
  return git;
}

async function ensureRepoCache({ repo, branch, commit, token }) {
  ensureRoots();

  const repoKey = makeHash(repo).slice(0, 16);
  const repoDir = path.join(REPO_CACHE_ROOT, repoKey);
  const gitMarker = path.join(repoDir, '.git');
  const authPrefix = buildGitAuthPrefix(repo, token);

  let git;
  if (!fs.existsSync(gitMarker)) {
    fs.mkdirSync(REPO_CACHE_ROOT, { recursive: true });
    git = await initializeRepoCache({ repoDir, repo, branch, authPrefix });
  } else {
    git = simpleGit(repoDir);
  }

  try {
    await git.remote(['set-url', 'origin', repo]);
  } catch {
    // ignore remote scrubbing failures; fetch below will surface real issues
  }

  const cachedBranchRef = await resolveBranchRef(git, branch);
  if (cachedBranchRef && await isCommitOnBranch(git, commit, cachedBranchRef)) {
    return { git, repoDir, branchRef: cachedBranchRef };
  }

  if (cachedBranchRef) {
    await ensureCommitFetched({ git, repo, branch, commit, authPrefix });
  } else {
    const fetchArgs = buildBranchFetchArgs({ repo, branch, depth: 1 });
    if (authPrefix.length > 0) {
      await git.raw([...authPrefix, ...fetchArgs]);
    } else {
      await git.raw(fetchArgs);
    }
    await ensureCommitFetched({ git, repo, branch, commit, authPrefix });
  }

  const branchRef = await resolveBranchRef(git, branch);
  if (branchRef && await isCommitOnBranch(git, commit, branchRef)) {
    return { git, repoDir, branchRef };
  }

  git = await initializeRepoCache({ repoDir, repo, branch, authPrefix });
  await ensureCommitFetched({ git, repo, branch, commit, authPrefix });
  const recreatedBranchRef = await resolveBranchRef(git, branch);
  if (recreatedBranchRef) {
    return { git, repoDir, branchRef: recreatedBranchRef };
  }

  throw new Error(`分支不存在: ${branch}`);
}

async function verifyCommitOnBranch(git, commit, branchRef) {
  try {
    await git.raw(['rev-parse', '--verify', '--quiet', `${commit}^{commit}`]);
  } catch {
    throw new Error(`commit 不存在或未拉取: ${commit}`);
  }

  try {
    await git.raw(['merge-base', '--is-ancestor', commit, branchRef]);
  } catch {
    throw new Error(`commit ${commit} 不属于分支 ${branchRef}`);
  }
}

async function collectTrackedFiles(repoDir, commit) {
  const output = await simpleGit(repoDir).raw(['ls-tree', '-r', '-l', '--full-tree', commit]);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const matched = /^(\d+)\s+(\w+)\s+([0-9a-f]+)\s+(\d+|-)\t(.+)$/.exec(line);
      if (!matched) return null;

      return {
        type: matched[2],
        size: matched[4] === '-' ? null : Number(matched[4]),
        path: matched[5],
      };
    })
    .filter((item) => item && item.type === 'blob' && isSupportedSourceFile(item.path))
    .map((item) => ({
      path: item.path,
      size: Number.isFinite(item.size) ? item.size : null,
    }));
}

async function getTrackedSourceFiles(entry) {
  if (entry.sourceFiles) {
    return entry.sourceFiles;
  }

  if (!entry.sourceFilesPromise) {
    entry.sourceFilesPromise = collectTrackedFiles(entry.repoDir, entry.commit)
      .then((files) => {
        entry.sourceFiles = files;
        files.forEach((file) => {
          entry.fileSizes.set(file.path, file.size);
        });
        return files;
      })
      .finally(() => {
        entry.sourceFilesPromise = null;
      });
  }

  return entry.sourceFilesPromise;
}

function collectSignature(lines, startIndex, language) {
  const signatureLines = [];
  const maxLines = Math.min(lines.length, startIndex + 6);

  for (let index = startIndex; index < maxLines; index += 1) {
    const line = lines[index];
    signatureLines.push(line.trim());

    if (language === 'python') {
      if (line.includes(':')) break;
      continue;
    }

    if (line.includes('{') || line.includes('=>') || line.trim().endsWith(';')) {
      break;
    }
  }

  return signatureLines.join(' ').replace(/\s+/g, ' ').trim();
}

function extractSymbolsFromLines(lines, relativePath) {
  const language = languageFromExt(relativePath);
  const symbols = [];

  const patternsByLanguage = {
    go: [
      /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[[^\]]+\])?\s*\(/,
    ],
    python: [
      /^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
    ],
    javascript: [
      /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^>(]+>)?\s*\(/,
      /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\s*\(/,
      /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^=]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/,
      /^\s*(?:public|private|protected|static|readonly|async|get|set|\s)*([A-Za-z_$][\w$]*)\s*(?:<[^>(]+>)?\s*\([^=;]*\)\s*\{/,
    ],
    jvm: [
      /^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:public|protected|private|internal)?\s*(?:static\s+|final\s+|synchronized\s+|abstract\s+|open\s+|override\s+)*[\w<>\[\],?. ]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^;]*\)\s*(?:throws [^{]+)?\{/,
    ],
    rust: [
      /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>(]+>)?\s*\(/,
    ],
    php: [
      /^\s*(?:public|protected|private)?\s*(?:static\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
    ],
    'c-family': [
      /^\s*(?:template\s*<[^>]+>\s*)?(?:[\w:*<>\[\]&~]+\s+)+([A-Za-z_][A-Za-z0-9_:~]*)\s*\([^;]*\)\s*(?:const)?\s*\{/,
    ],
  };

  const patterns = patternsByLanguage[language] || [];

  lines.forEach((line, lineIndex) => {
    for (const pattern of patterns) {
      const matched = pattern.exec(line);
      if (!matched) continue;

      const symbolName = matched[1];
      if (!symbolName) continue;
      if (language === 'javascript' && JS_CONTROL_KEYWORDS.has(symbolName)) continue;

      const lineNumber = lineIndex + 1;
      symbols.push({
        id: encodeSymbolId({ path: relativePath, line: lineNumber, name: symbolName, language }),
        name: symbolName,
        path: relativePath,
        line: lineNumber,
        language,
        signature: collectSignature(lines, lineIndex, language) || line.trim(),
      });
      break;
    }
  });

  return symbols;
}

async function buildSymbolIndex(entry) {
  const files = await getTrackedSourceFiles(entry);
  const symbols = [];

  for (const file of files) {
    if (Number.isFinite(file.size) && file.size > MAX_FILE_SIZE_BYTES) {
      continue;
    }

    const content = await readSourceFile(entry, file.path);
    if (!content) continue;

    const lines = content.split(/\r?\n/);
    symbols.push(...extractSymbolsFromLines(lines, file.path));
  }

  return symbols;
}

async function getContextEntry(contextId) {
  const entry = activeContexts.get(contextId);
  if (!entry) {
    throw new Error('代码上下文不存在，请重新绑定 repo / branch / commit');
  }

  return entry;
}

function hydrateSymbolMaps(entry, symbols) {
  entry.symbolById.clear();
  entry.fileSymbols.clear();
  symbols.forEach((symbol) => {
    entry.symbolById.set(symbol.id, symbol);
    if (!entry.fileSymbols.has(symbol.path)) {
      entry.fileSymbols.set(symbol.path, []);
    }
    entry.fileSymbols.get(symbol.path).push(symbol);
  });
}

async function loadPersistedSymbolIndex(entry) {
  if (entry.symbolIndex) {
    return entry.symbolIndex;
  }

  if (!entry.indexCachePath || !fs.existsSync(entry.indexCachePath)) {
    return null;
  }

  try {
    const payload = await fs.promises.readFile(entry.indexCachePath);
    const parsed = JSON.parse(zlib.gunzipSync(payload).toString('utf8'));
    if (!Array.isArray(parsed?.symbols)) {
      return null;
    }

    const symbols = parsed.symbols
      .filter((item) => item && item.id && item.path && item.name && item.line)
      .map((item) => ({
        id: item.id,
        name: item.name,
        path: item.path,
        line: Number(item.line),
        language: item.language || languageFromExt(item.path),
        signature: String(item.signature || ''),
      }));

    entry.symbolIndex = symbols;
    entry.symbolCount = symbols.length;
    hydrateSymbolMaps(entry, symbols);
    return symbols;
  } catch {
    return null;
  }
}

async function persistSymbolIndex(entry, symbols) {
  if (!entry.indexCachePath) {
    return;
  }

  try {
    const payload = zlib.gzipSync(Buffer.from(JSON.stringify({
      repo: entry.repo,
      branch: entry.branch,
      commit: entry.commit,
      symbols,
    }), 'utf8'));
    const tempPath = `${entry.indexCachePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(tempPath, payload);
    await fs.promises.rename(tempPath, entry.indexCachePath);
  } catch {
    // ignore cache persistence failures
  }
}

function scheduleIndexWarmup(entry) {
  if (entry.indexWarmScheduled || entry.symbolIndex || entry.symbolIndexPromise) {
    return;
  }

  entry.indexWarmScheduled = true;
  setTimeout(() => {
    void ensureSymbolIndex(entry)
      .catch(() => {})
      .finally(() => {
        entry.indexWarmScheduled = false;
      });
  }, INDEX_WARMUP_DELAY_MS);
}

async function readSourceFile(entry, relativePath) {
  if (entry.fileContents.has(relativePath)) {
    return entry.fileContents.get(relativePath);
  }

  if (entry.fileContentPromises.has(relativePath)) {
    return entry.fileContentPromises.get(relativePath);
  }

  const promise = (async () => {
    try {
      const content = await simpleGit(entry.repoDir).raw(['show', `${entry.commit}:${relativePath}`]);
      entry.fileSizes.set(relativePath, Buffer.byteLength(content, 'utf8'));
      entry.fileContents.set(relativePath, content);
      return content;
    } catch {
      entry.fileSizes.set(relativePath, null);
      entry.fileContents.set(relativePath, null);
      return null;
    }
  })().finally(() => {
    entry.fileContentPromises.delete(relativePath);
  });

  entry.fileContentPromises.set(relativePath, promise);
  return promise;
}

async function getFileSymbols(entry, relativePath) {
  if (entry.fileSymbols.has(relativePath)) {
    return entry.fileSymbols.get(relativePath);
  }

  if (entry.fileSymbolPromises.has(relativePath)) {
    return entry.fileSymbolPromises.get(relativePath);
  }

  const promise = (async () => {
    const blobSize = entry.fileSizes.get(relativePath);
    if (Number.isFinite(blobSize) && blobSize > MAX_FILE_SIZE_BYTES) {
      entry.fileSymbols.set(relativePath, []);
      return [];
    }

    const content = await readSourceFile(entry, relativePath);
    if (!content) {
      entry.fileSymbols.set(relativePath, []);
      return [];
    }

    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE_BYTES) {
      entry.fileSymbols.set(relativePath, []);
      return [];
    }

    const symbols = extractSymbolsFromLines(content.split(/\r?\n/), relativePath);
    entry.fileSymbols.set(relativePath, symbols);
    symbols.forEach((symbol) => {
      entry.symbolById.set(symbol.id, symbol);
    });
    return symbols;
  })().finally(() => {
    entry.fileSymbolPromises.delete(relativePath);
  });

  entry.fileSymbolPromises.set(relativePath, promise);
  return promise;
}

async function ensureSymbolIndex(entry) {
  if (entry.symbolIndex) {
    return entry.symbolIndex;
  }

  const persisted = await loadPersistedSymbolIndex(entry);
  if (persisted) {
    return persisted;
  }

  if (!entry.symbolIndexPromise) {
    entry.symbolIndexPromise = (async () => {
      const files = await getTrackedSourceFiles(entry);
      const aggregated = [];
      let cursor = 0;

      async function worker() {
        while (cursor < files.length) {
          const nextFile = files[cursor];
          cursor += 1;
          const symbols = await getFileSymbols(entry, nextFile.path);
          if (symbols.length > 0) {
            aggregated.push(...symbols);
          }
        }
      }

      const concurrency = Math.min(FULL_INDEX_CONCURRENCY, Math.max(1, files.length));
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      aggregated.sort((left, right) =>
        left.path.localeCompare(right.path) ||
        left.line - right.line
      );
      entry.symbolIndex = aggregated;
      entry.symbolCount = aggregated.length;
      hydrateSymbolMaps(entry, aggregated);
      await persistSymbolIndex(entry, aggregated);
      return aggregated;
    })().finally(() => {
      entry.symbolIndexPromise = null;
    });
  }

  return entry.symbolIndexPromise;
}

function formatContextResponse(entry) {
  return {
    contextId: entry.contextId,
    repo: entry.repo,
    repoDisplayName: entry.repoDisplayName,
    branch: entry.branch,
    branchRef: entry.branchRef,
    commit: entry.commit,
    worktreePath: entry.repoDir,
    symbolCount: entry.symbolCount,
    searchStrategy: entry.symbolIndex ? 'indexed' : 'on-demand',
  };
}

async function openCodeContext({ repo, branch, commit, token }) {
  const normalizedRepo = await normalizeRepoSource(repo);
  const normalizedBranch = String(branch || '').trim();
  const normalizedCommit = String(commit || '').trim();
  const contextId = makeHash(`${normalizedRepo}#${normalizedBranch}#${normalizedCommit}`).slice(0, 16);

  if (!normalizedRepo) throw new Error('repo 不能为空');
  if (!normalizedBranch) throw new Error('branch 不能为空');
  if (!normalizedCommit) throw new Error('commit 不能为空');

  const existing = activeContexts.get(contextId);
  if (existing && fs.existsSync(existing.repoDir)) {
    existing.openedAt = Date.now();
    if (!existing.symbolIndex && existing.indexCachePath && fs.existsSync(existing.indexCachePath)) {
      void loadPersistedSymbolIndex(existing);
    } else if (!existing.symbolIndex) {
      scheduleIndexWarmup(existing);
    }
    return formatContextResponse(existing);
  }

  const { git, repoDir, branchRef } = await ensureRepoCache({
    repo: normalizedRepo,
    branch: normalizedBranch,
    commit: normalizedCommit,
    token: String(token || '').trim(),
  });

  await verifyCommitOnBranch(git, normalizedCommit, branchRef);

  const metadata = {
    contextId,
    repo: normalizedRepo,
    repoDisplayName: normalizeRepoDisplayName(normalizedRepo),
    branch: normalizedBranch,
    branchRef,
    commit: normalizedCommit,
    repoDir,
    indexCachePath: makeIndexCachePath(contextId),
    openedAt: Date.now(),
    symbolIndex: null,
    symbolIndexPromise: null,
    symbolCount: null,
    indexWarmScheduled: false,
    sourceFiles: null,
    sourceFilesPromise: null,
    fileSizes: new Map(),
    fileContents: new Map(),
    fileContentPromises: new Map(),
    fileSymbols: new Map(),
    fileSymbolPromises: new Map(),
    symbolById: new Map(),
    searchCache: new Map(),
  };

  activeContexts.set(contextId, metadata);

  if (fs.existsSync(metadata.indexCachePath)) {
    void loadPersistedSymbolIndex(metadata);
  } else {
    scheduleIndexWarmup(metadata);
  }

  return formatContextResponse(metadata);
}

function scoreSymbolCandidate(symbol, query) {
  const lowerName = symbol.name.toLowerCase();
  const rawQuery = String(query || '').trim();
  const terms = Array.from(new Set(
    [
      rawQuery,
      ...rawQuery.split(/::|->|\./g),
    ]
      .map((item) => item.trim().replace(/[()[\],:;]+$/g, ''))
      .filter((item) => item.length >= 2)
  ));

  let bestScore = 0;

  terms.forEach((term) => {
    const lowerTerm = term.toLowerCase();
    if (!lowerTerm) return;

    if (symbol.name === term) {
      bestScore = Math.max(bestScore, 120);
      return;
    }
    if (lowerName === lowerTerm) {
      bestScore = Math.max(bestScore, 100);
      return;
    }
    if (lowerName.startsWith(lowerTerm)) {
      bestScore = Math.max(bestScore, 80);
      return;
    }
    if (lowerName.includes(lowerTerm)) {
      bestScore = Math.max(bestScore, 60);
    }
  });

  return bestScore;
}

function rankSymbolResults(symbols, query, limit = 50) {
  return symbols
    .map((symbol) => ({ symbol, score: scoreSymbolCandidate(symbol, query) }))
    .filter((item) => item.score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      left.symbol.path.localeCompare(right.symbol.path) ||
      left.symbol.line - right.symbol.line
    )
    .slice(0, Math.max(1, Math.min(Number(limit) || 50, 100)))
    .map(({ symbol, score }) => ({
      ...symbol,
      matchType: symbol.name.toLowerCase() === String(query).trim().toLowerCase() ? 'exact' : 'fuzzy',
      score,
    }));
}

function buildSearchTerms(query) {
  const trimmed = String(query || '').trim().replace(/^[`'"]+|[`'"]+$/g, '');
  if (!trimmed) return [];

  const segments = trimmed
    .split(/::|->|\./g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);

  return Array.from(new Set([
    trimmed,
    ...segments,
    segments[segments.length - 1],
  ].filter(Boolean)));
}

async function runGitGrep(repoDir, commit, terms) {
  const normalizedTerms = Array.from(new Set(
    (Array.isArray(terms) ? terms : [terms])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));
  if (normalizedTerms.length === 0) return '';

  try {
    return await simpleGit(repoDir).raw([
      'grep',
      '-n',
      '-I',
      '-i',
      '-F',
      '--full-name',
      ...normalizedTerms.flatMap((term) => ['-e', term]),
      commit,
      '--',
    ]);
  } catch (error) {
    const stderr = String(error?.stderr || error?.message || '');
    if (
      stderr.includes('exit code: 1') ||
      stderr.includes('status code 1') ||
      stderr.includes('did not match any file')
    ) {
      return '';
    }
    throw error;
  }
}

function collectGitGrepHits(output, hitMap) {
  String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const matched = /^(?:[^:]+:)?([^:]+):(\d+):(.*)$/.exec(line);
      if (!matched) return;

      const relativePath = matched[1];
      const lineNumber = Number(matched[2]);
      if (!relativePath || !Number.isFinite(lineNumber) || !isSupportedSourceFile(relativePath)) {
        return;
      }

      if (!hitMap.has(relativePath)) {
        hitMap.set(relativePath, new Set());
      }

      hitMap.get(relativePath).add(lineNumber);
    });
}

async function searchSymbolsFast(entry, query, limit = 50) {
  const searchTerms = buildSearchTerms(query);
  if (searchTerms.length === 0) {
    return [];
  }

  const hitMap = new Map();
  const output = await runGitGrep(entry.repoDir, entry.commit, searchTerms);
  collectGitGrepHits(output, hitMap);

  if (hitMap.size === 0) {
    return [];
  }

  const dedupedSymbols = new Map();
  const candidateFiles = Array.from(hitMap.entries()).slice(0, MAX_FAST_SEARCH_FILES);

  for (const [relativePath, hitLines] of candidateFiles) {
    const symbols = await getFileSymbols(entry, relativePath);
    if (symbols.length === 0) continue;

    symbols.forEach((symbol) => {
      const score = scoreSymbolCandidate(symbol, query);
      if (score <= 0) return;

      const nearHit = Array.from(hitLines).some((lineNumber) =>
        Math.abs(Number(symbol.line) - lineNumber) <= MAX_FAST_SEARCH_LINE_DISTANCE
      );
      if (!nearHit) return;

      const previous = dedupedSymbols.get(symbol.id);
      if (!previous || previous.score < score) {
        dedupedSymbols.set(symbol.id, { ...symbol, score });
      }
    });
  }

  return rankSymbolResults(Array.from(dedupedSymbols.values()), query, limit);
}

async function searchSymbols(contextId, query, limit = 50) {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) {
    throw new Error('query 不能为空');
  }

  const entry = await getContextEntry(contextId);
  const cacheKey = normalizedQuery.toLowerCase();
  const cappedLimit = Math.max(1, Math.min(Number(limit) || 50, 100));

  if (entry.searchCache.has(cacheKey)) {
    return entry.searchCache.get(cacheKey).slice(0, cappedLimit);
  }

  let results = await searchSymbolsFast(entry, normalizedQuery, cappedLimit);
  if (results.length === 0) {
    const symbolIndex = await ensureSymbolIndex(entry);
    results = rankSymbolResults(symbolIndex, normalizedQuery, cappedLimit);
  }

  results.forEach((symbol) => {
    entry.symbolById.set(symbol.id, symbol);
  });
  entry.searchCache.set(cacheKey, results);
  return results.slice(0, cappedLimit);
}

function countBraces(line) {
  let balance = 0;
  for (const char of line) {
    if (char === '{') balance += 1;
    else if (char === '}') balance -= 1;
  }
  return balance;
}

function expandSymbolStart(lines, startIndex, language) {
  let start = startIndex;

  if (language === 'python') {
    while (start > 0 && lines[start - 1].trim().startsWith('@')) {
      start -= 1;
    }
    return start;
  }

  while (start > 0) {
    const previous = lines[start - 1].trim();
    if (!previous) break;
    if (previous.startsWith('@')) {
      start -= 1;
      continue;
    }
    break;
  }

  return start;
}

function detectPythonRange(lines, startIndex) {
  const expandedStart = expandSymbolStart(lines, startIndex, 'python');
  const declarationLine = lines[startIndex];
  const declarationIndent = declarationLine.match(/^\s*/)?.[0].length || 0;
  let end = Math.min(lines.length - 1, startIndex + 1);

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      end = index;
      continue;
    }

    const indent = line.match(/^\s*/)?.[0].length || 0;
    if (indent <= declarationIndent && !trimmed.startsWith('#')) {
      break;
    }
    end = index;
  }

  return { start: expandedStart, end };
}

function detectBraceRange(lines, startIndex, language) {
  const expandedStart = expandSymbolStart(lines, startIndex, language);
  let bodyStart = -1;

  for (let index = startIndex; index < Math.min(lines.length, startIndex + 24); index += 1) {
    if (lines[index].includes('{')) {
      bodyStart = index;
      break;
    }
  }

  if (bodyStart === -1) {
    return {
      start: expandedStart,
      end: Math.min(lines.length - 1, startIndex + 40),
    };
  }

  let balance = 0;
  let seenOpen = false;
  let end = bodyStart;

  for (let index = bodyStart; index < lines.length; index += 1) {
    balance += countBraces(lines[index]);
    if (lines[index].includes('{')) {
      seenOpen = true;
    }

    end = index;
    if (seenOpen && balance <= 0 && index > bodyStart) {
      break;
    }
  }

  return { start: expandedStart, end };
}

function detectSymbolRange(lines, symbol) {
  const startIndex = Math.max(0, Number(symbol.line || 1) - 1);

  if (symbol.language === 'python') {
    return detectPythonRange(lines, startIndex);
  }

  return detectBraceRange(lines, startIndex, symbol.language);
}

async function renderSymbol(contextId, symbolId, options = {}) {
  const entry = await getContextEntry(contextId);
  const symbolKey = decodeSymbolId(symbolId);
  let symbol = entry.symbolById.get(symbolId)
    || (entry.symbolIndex || []).find((item) => item.id === symbolId)
    || (entry.symbolIndex || []).find((item) =>
      item.path === symbolKey.path &&
      Number(item.line) === Number(symbolKey.line) &&
      item.name === symbolKey.name
    );

  if (!symbol && symbolKey.path && symbolKey.line && symbolKey.name) {
    symbol = {
      id: symbolId,
      path: symbolKey.path,
      line: Number(symbolKey.line),
      name: symbolKey.name,
      language: symbolKey.language || languageFromExt(symbolKey.path),
      signature: String(symbolKey.signature || ''),
    };
  }

  if (!symbol) {
    throw new Error('函数候选不存在，请重新搜索');
  }

  const content = await readSourceFile(entry, symbol.path);
  if (!content) {
    throw new Error(`无法读取源码文件: ${symbol.path}`);
  }

  const lines = content.split(/\r?\n/);
  if (!symbol.signature) {
    symbol.signature = collectSignature(lines, Math.max(0, Number(symbol.line || 1) - 1), symbol.language) || symbol.name;
    entry.symbolById.set(symbol.id, symbol);
  }
  const { start, end } = detectSymbolRange(lines, symbol);
  const beforeContext = Math.max(0, Math.min(Number(options.beforeContext) || 12, 240));
  const afterContext = Math.max(0, Math.min(Number(options.afterContext) || 24, 360));
  const snippetStart = Math.max(0, start - beforeContext);
  const snippetEnd = Math.min(lines.length - 1, end + afterContext);

  return {
    symbol,
    signature: symbol.signature,
    functionStartLine: start + 1,
    functionEndLine: end + 1,
    snippetStartLine: snippetStart + 1,
    snippetEndLine: snippetEnd + 1,
    beforeContext,
    afterContext,
    totalLines: lines.length,
    lines: lines.slice(snippetStart, snippetEnd + 1).map((text, index) => ({
      lineNumber: snippetStart + index + 1,
      text,
      inFunction: snippetStart + index >= start && snippetStart + index <= end,
      isDeclaration: snippetStart + index === Number(symbol.line) - 1,
    })),
  };
}

module.exports = {
  openCodeContext,
  renderSymbol,
  searchSymbols,
};
