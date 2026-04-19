const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DEFAULT_CACHE_FILE = path.join(DATA_DIR, 'prepare-step-cache.json');
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;

function ensureFile(filePath, defaultValue) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf8');
  }
}

function readJson(filePath, defaultValue) {
  ensureFile(filePath, defaultValue);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return defaultValue;
  }
}

function writeJson(filePath, value) {
  ensureFile(filePath, value);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function getCacheFilePath(options = {}) {
  return options.filePath || process.env.PREPARE_STEP_CACHE_FILE || DEFAULT_CACHE_FILE;
}

function normalizePreparePhase(phase) {
  return String(phase || '').trim().toLowerCase() === 'ready' ? 'ready' : 'context';
}

function getCacheTtlMs(step) {
  const raw = Number(step?.cacheTtlMs);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CACHE_TTL_MS;
}

function shouldCacheStep(step) {
  return String(step?.cacheScope || '').trim().toLowerCase() === 'target';
}

function buildPrepareCacheKey(session, profileId, step, resolvedCmd) {
  const host = String(session?.host || session?.connectConfig?.host || 'unknown-host').trim().toLowerCase();
  const port = Number(session?.port || session?.connectConfig?.port || 22);
  const username = String(session?.username || session?.connectConfig?.username || 'unknown-user').trim().toLowerCase();
  const stepName = String(step?.name || resolvedCmd || step?.cmd || 'unknown-step').trim().toLowerCase();
  return [host, port, username, String(profileId || 'default').trim().toLowerCase(), stepName].join('::');
}

function trimCachedResult(result = {}) {
  return {
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    exitCode: typeof result.exitCode === 'number' ? result.exitCode : 0,
    durationMs: typeof result.durationMs === 'number' ? result.durationMs : 0,
    status: result.status === 'failed' ? 'failed' : 'done',
    statusReason: result.statusReason ? String(result.statusReason) : undefined,
    processedOutput: result.processedOutput ? String(result.processedOutput) : undefined,
    capturedVar: result.capturedVar && result.capturedVar.name
      ? {
        name: String(result.capturedVar.name),
        value: String(result.capturedVar.value || ''),
      }
      : undefined,
    scriptResult: result.scriptResult
      ? {
        exitCode: typeof result.scriptResult.exitCode === 'number' ? result.scriptResult.exitCode : 0,
        stdout: String(result.scriptResult.stdout || ''),
      }
      : undefined,
    scriptError: result.scriptError ? String(result.scriptError) : undefined,
  };
}

function readPrepareStepCache(session, profileId, step, resolvedCmd, options = {}) {
  if (!shouldCacheStep(step)) return null;

  const cacheFile = getCacheFilePath(options);
  const cache = readJson(cacheFile, {});
  const cacheKey = buildPrepareCacheKey(session, profileId, step, resolvedCmd);
  const entry = cache[cacheKey];
  if (!entry) return null;

  const ttlMs = getCacheTtlMs(step);
  const cachedAt = Number(entry.cachedAt || 0);
  const now = Number(options.now || Date.now());
  if (!cachedAt || now - cachedAt > ttlMs) {
    delete cache[cacheKey];
    writeJson(cacheFile, cache);
    return null;
  }

  return {
    ...trimCachedResult(entry.result),
    fromCache: true,
    cachedAt,
    cacheTtlMs: ttlMs,
  };
}

function writePrepareStepCache(session, profileId, step, resolvedCmd, result, options = {}) {
  if (!shouldCacheStep(step)) return;
  if ((result?.exitCode ?? 0) !== 0 || result?.status === 'failed') return;

  const cacheFile = getCacheFilePath(options);
  const cache = readJson(cacheFile, {});
  const cacheKey = buildPrepareCacheKey(session, profileId, step, resolvedCmd);
  cache[cacheKey] = {
    cachedAt: Number(options.now || Date.now()),
    result: trimCachedResult(result),
  };
  writeJson(cacheFile, cache);
}

function buildPrepareRunMetrics(steps = [], totalDurationMs = 0) {
  const safeSteps = Array.isArray(steps) ? steps : [];
  const readySteps = safeSteps.filter((step) => normalizePreparePhase(step?.phase) === 'ready');
  const cachedStepCount = safeSteps.filter((step) => step?.fromCache).length;

  let firstStartedAt = 0;
  let lastReadyFinishedAt = 0;

  safeSteps.forEach((step) => {
    const startedAt = Number(step?.startedAt || 0);
    const finishedAt = Number(step?.finishedAt || 0);
    if (startedAt > 0 && (firstStartedAt === 0 || startedAt < firstStartedAt)) {
      firstStartedAt = startedAt;
    }
    if (normalizePreparePhase(step?.phase) === 'ready' && finishedAt > lastReadyFinishedAt) {
      lastReadyFinishedAt = finishedAt;
    }
  });

  return {
    readyStepCount: readySteps.length,
    contextStepCount: Math.max(0, safeSteps.length - readySteps.length),
    cachedStepCount,
    readyDurationMs: firstStartedAt > 0 && lastReadyFinishedAt > 0
      ? Math.max(0, lastReadyFinishedAt - firstStartedAt)
      : 0,
    totalDurationMs: Math.max(0, Number(totalDurationMs || 0)),
  };
}

module.exports = {
  buildPrepareRunMetrics,
  normalizePreparePhase,
  readPrepareStepCache,
  writePrepareStepCache,
};
