const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_PREPARE_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_PREPARE_CACHE_ENTRIES = 256;

const prepareStepCache = new Map();

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizePreparePhase(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['context', 'collect', 'observe', 'readonly'].includes(normalized)) {
    return 'context';
  }
  return 'ready';
}

function normalizePrepareCacheScope(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'target' || normalized === 'connection') {
    return normalized;
  }
  return 'profile';
}

function evalOutputStatus(stdout, opts = {}) {
  const text = stdout ?? '';

  if (opts.abnormalRegex) {
    try {
      if (new RegExp(opts.abnormalRegex, 'im').test(text)) {
        return { status: 'failed', reason: `异常正则命中: /${opts.abnormalRegex}/` };
      }
    } catch {
      // ignore invalid regex
    }
  }

  if (opts.normalRegex) {
    try {
      const matched = new RegExp(opts.normalRegex, 'im').test(text);
      return {
        status: matched ? 'done' : 'failed',
        reason: matched
          ? `正常正则命中: /${opts.normalRegex}/`
          : `正常正则未匹配: /${opts.normalRegex}/`,
      };
    } catch {
      // ignore invalid regex
    }
  }

  return {
    status: opts.exitCode === 0 ? 'done' : 'failed',
    reason: `exit ${opts.exitCode}`,
  };
}

function getStepMode(step) {
  return step?.mode === 'exec' ? 'exec' : 'pty';
}

function getStepTimeout(step) {
  return Number(step?.timeoutMs || step?.timeout || DEFAULT_TIMEOUT_MS);
}

function resolveStepCommand(step, varContext) {
  return String(step?.cmd || '').replace(
    /\$\{([^}]+)\}/g,
    (_, name) => (varContext[name] !== undefined ? varContext[name] : `\${${name}}`)
  );
}

function getTargetCacheKey(session, opts = {}) {
  if (opts.targetCacheKey) return String(opts.targetCacheKey);
  const username = String(session?.username || session?.user || 'unknown');
  const host = String(session?.host || session?.nodeId || session?.sessionId || 'session');
  const port = Number(session?.port || 22);
  return `${username}@${host}:${port}`;
}

function buildPrepareStepCacheKey(session, step, resolvedCmd, opts = {}) {
  const cacheKey = String(step?.cacheKey || '').trim();
  if (!cacheKey) return '';
  const targetCacheKey = getTargetCacheKey(session, opts);
  const cacheScope = normalizePrepareCacheScope(step?.cacheScope);

  if (cacheScope === 'target') {
    return `${targetCacheKey}::target::${cacheKey}::${resolvedCmd}`;
  }

  if (cacheScope === 'connection') {
    const connectionId = String(
      session?.connectedAt
      || session?.sessionId
      || session?.nodeId
      || session?.host
      || 'connection'
    );
    return `${targetCacheKey}::connection::${connectionId}::${cacheKey}::${resolvedCmd}`;
  }

  const profileId = String(opts.profileId || 'adhoc');
  return `${targetCacheKey}::profile::${profileId}::${cacheKey}::${resolvedCmd}`;
}

function prunePrepareStepCache(now = Date.now()) {
  for (const [cacheKey, entry] of prepareStepCache.entries()) {
    if (!entry || entry.expiresAt <= now) {
      prepareStepCache.delete(cacheKey);
    }
  }

  while (prepareStepCache.size > MAX_PREPARE_CACHE_ENTRIES) {
    const oldestKey = prepareStepCache.keys().next().value;
    if (!oldestKey) break;
    prepareStepCache.delete(oldestKey);
  }
}

function clearPrepareStepCache() {
  prepareStepCache.clear();
}

function readPrepareStepCache(cacheKey, now = Date.now()) {
  if (!cacheKey) return null;
  prunePrepareStepCache(now);
  const entry = prepareStepCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    prepareStepCache.delete(cacheKey);
    return null;
  }
  return {
    ...cloneValue(entry.value),
    cached: true,
    cacheAgeMs: Math.max(0, now - entry.cachedAt),
  };
}

function writePrepareStepCache(cacheKey, value, ttlMs = DEFAULT_PREPARE_CACHE_TTL_MS, now = Date.now()) {
  if (!cacheKey || !value || ttlMs <= 0) return;
  prepareStepCache.set(cacheKey, {
    cachedAt: now,
    expiresAt: now + ttlMs,
    value: cloneValue(value),
  });
  prunePrepareStepCache(now);
}

function buildPrepareRunMetrics(results = []) {
  const readySteps = results.filter((item) => normalizePreparePhase(item.phase) === 'ready');
  const contextSteps = results.filter((item) => normalizePreparePhase(item.phase) === 'context');
  const sumDuration = (items) => items.reduce((total, item) => total + Number(item.durationMs || 0), 0);
  return {
    readyStepCount: readySteps.length,
    contextStepCount: contextSteps.length,
    cachedStepCount: results.filter((item) => item.cached || item.status === 'cached').length,
    readyDurationMs: sumDuration(readySteps),
    totalDurationMs: sumDuration(results),
  };
}

function buildStepResult(step, resolvedCmd, result, meta = {}) {
  return {
    name: step.name || resolvedCmd,
    cmd: step.cmd,
    resolvedCmd,
    stdout: result.stdout,
    processedOutput: meta.processedOutput,
    stderr: result.stderr,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    status: meta.status,
    statusReason: meta.statusReason,
    capturedVar: meta.capturedVar,
    scriptResult: meta.scriptResult,
    scriptError: meta.scriptError,
    varSnapshot: meta.varSnapshot,
    phase: normalizePreparePhase(step.phase),
    mode: getStepMode(step),
    parallelGroup: step.parallelGroup || undefined,
    cached: Boolean(meta.cached),
    cacheAgeMs: meta.cacheAgeMs,
  };
}

async function processExecutedStep(step, resolvedCmd, commandResult, varContext, deps) {
  let processedOutput = commandResult.stdout;
  let scriptResult;
  let scriptError;

  if (step.scriptPath && typeof deps.runPythonScript === 'function') {
    const sr = await deps.runPythonScript(step.scriptPath, commandResult.stdout, 15000);
    if (sr.exitCode === 0) {
      processedOutput = sr.stdout;
      scriptResult = { exitCode: sr.exitCode, stdout: sr.stdout };
    } else {
      scriptError = `脚本执行失败(exit ${sr.exitCode}): ${sr.stderr}`;
    }
  }

  const evaluation = evalOutputStatus(processedOutput, {
    abnormalRegex: step.abnormalRegex,
    normalRegex: step.normalRegex,
    exitCode: commandResult.exitCode,
  });

  let capturedVar;
  if (step.captureVar && evaluation.status !== 'failed') {
    let value = processedOutput.trim();
    if (step.capturePattern) {
      try {
        const matched = new RegExp(step.capturePattern).exec(processedOutput);
        if (matched) value = matched[1] !== undefined ? matched[1] : matched[0];
      } catch {
        // ignore invalid regex
      }
    }
    if (value) {
      varContext[step.captureVar] = value;
      capturedVar = { name: step.captureVar, value };
    }
  }

  return buildStepResult(step, resolvedCmd, commandResult, {
    processedOutput: step.scriptPath ? processedOutput : undefined,
    status: evaluation.status,
    statusReason: evaluation.reason,
    capturedVar,
    scriptResult,
    scriptError,
    varSnapshot: { ...varContext },
  });
}

function applyCachedStepResult(step, resolvedCmd, cachedResult, varContext) {
  const cacheAgeMs = Math.max(0, Number(cachedResult.cacheAgeMs || 0));
  const reused = {
    ...cloneValue(cachedResult),
    cached: true,
    durationMs: 0,
    resolvedCmd,
    phase: normalizePreparePhase(step.phase),
    mode: getStepMode(step),
    parallelGroup: step.parallelGroup || undefined,
    status: 'cached',
    statusReason: `命中缓存 (${Math.max(1, Math.round(cacheAgeMs / 1000))}s 前生成)`,
    cacheAgeMs,
  };
  if (reused.capturedVar?.name && reused.status !== 'failed') {
    varContext[reused.capturedVar.name] = reused.capturedVar.value;
  }
  reused.varSnapshot = { ...varContext };
  return reused;
}

function getCommandRunner(deps) {
  if (typeof deps.executeCommand === 'function') return deps.executeCommand;
  return async (session, cmd, timeoutMs, mode) => {
    if (mode === 'exec' && typeof session?.execCommand === 'function') {
      return session.execCommand(cmd, timeoutMs);
    }
    return session.enqueueShellCmd(cmd, timeoutMs);
  };
}

function canRunParallelExec(session, deps) {
  if (deps.allowParallelExec === true) return true;
  if (deps.allowParallelExec === false) return false;
  return typeof session?.execCommand === 'function' || Boolean(session?.sshClient);
}

async function executeStructuredSteps(session, steps, opts = {}, deps = {}) {
  const startedAt = typeof deps.now === 'function' ? deps.now() : Date.now();
  const varContext = { ...(opts.variables || {}) };
  const results = [];
  const continueOnError = opts.continueOnError === true;
  const getBlockedCommandError = typeof deps.getBlockedCommandError === 'function'
    ? deps.getBlockedCommandError
    : () => null;
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  const executeCommand = getCommandRunner(deps);

  let index = 0;
  while (index < (steps || []).length) {
    const step = steps[index];
    if (!step?.cmd) {
      index += 1;
      continue;
    }

    const isParallelExecGroup = getStepMode(step) === 'exec'
      && step.parallelGroup
      && canRunParallelExec(session, deps);

    if (!isParallelExecGroup) {
      const resolvedCmd = resolveStepCommand(step, varContext);
      const blocked = getBlockedCommandError(resolvedCmd, 'structured-steps');
      if (blocked) {
        results.push(buildStepResult(step, resolvedCmd, {
          stdout: '',
          stderr: blocked,
          exitCode: -1,
          durationMs: 0,
        }, {
          status: 'failed',
          statusReason: blocked,
          varSnapshot: { ...varContext },
        }));
        if (!continueOnError) break;
        index += 1;
        continue;
      }

      const cacheKey = buildPrepareStepCacheKey(session, step, resolvedCmd, opts);
      const cached = readPrepareStepCache(cacheKey, now());
      if (cached) {
        results.push(applyCachedStepResult(step, resolvedCmd, cached, varContext));
        index += 1;
        continue;
      }

      const commandResult = await executeCommand(session, resolvedCmd, getStepTimeout(step), getStepMode(step));
      const finalResult = await processExecutedStep(step, resolvedCmd, commandResult, varContext, deps);
      results.push(finalResult);
      if (
        cacheKey &&
        finalResult.status === 'done' &&
        finalResult.exitCode === 0 &&
        getStepMode(step) === 'exec'
      ) {
        writePrepareStepCache(
          cacheKey,
          finalResult,
          Number(step.cacheTtlMs || DEFAULT_PREPARE_CACHE_TTL_MS),
          now()
        );
      }
      if (finalResult.status === 'failed' && !continueOnError) break;
      index += 1;
      continue;
    }

    const group = [];
    let cursor = index;
    while (cursor < steps.length) {
      const candidate = steps[cursor];
      if (!candidate?.cmd) {
        cursor += 1;
        continue;
      }
      if (getStepMode(candidate) !== 'exec' || candidate.parallelGroup !== step.parallelGroup) break;
      group.push(candidate);
      cursor += 1;
    }

    const pendingExecutions = [];
    const pendingIndexMap = new Map();
    const groupResults = new Array(group.length);
    let blockedInGroup = false;

    for (let groupIndex = 0; groupIndex < group.length; groupIndex += 1) {
      const currentStep = group[groupIndex];
      const resolvedCmd = resolveStepCommand(currentStep, varContext);
      const blocked = getBlockedCommandError(resolvedCmd, 'structured-steps');
      if (blocked) {
        groupResults[groupIndex] = buildStepResult(currentStep, resolvedCmd, {
          stdout: '',
          stderr: blocked,
          exitCode: -1,
          durationMs: 0,
        }, {
          status: 'failed',
          statusReason: blocked,
          varSnapshot: { ...varContext },
        });
        blockedInGroup = true;
        continue;
      }

      const cacheKey = buildPrepareStepCacheKey(session, currentStep, resolvedCmd, opts);
      const cached = readPrepareStepCache(cacheKey, now());
      if (cached) {
        groupResults[groupIndex] = applyCachedStepResult(currentStep, resolvedCmd, cached, varContext);
        continue;
      }

      pendingIndexMap.set(pendingExecutions.length, { cacheKey, groupIndex, resolvedCmd, step: currentStep });
      pendingExecutions.push(executeCommand(session, resolvedCmd, getStepTimeout(currentStep), 'exec'));
    }

    const pendingOutputs = await Promise.all(pendingExecutions);
    for (let pendingIndex = 0; pendingIndex < pendingOutputs.length; pendingIndex += 1) {
      const meta = pendingIndexMap.get(pendingIndex);
      if (!meta) continue;
      const finalResult = await processExecutedStep(
        meta.step,
        meta.resolvedCmd,
        pendingOutputs[pendingIndex],
        varContext,
        deps
      );
      groupResults[meta.groupIndex] = finalResult;
      if (meta.cacheKey && finalResult.status === 'done' && finalResult.exitCode === 0) {
        writePrepareStepCache(
          meta.cacheKey,
          finalResult,
          Number(meta.step.cacheTtlMs || DEFAULT_PREPARE_CACHE_TTL_MS),
          now()
        );
      }
    }

    for (const item of groupResults) {
      if (!item) continue;
      results.push(item);
      if (item.status === 'failed' && !continueOnError) {
        blockedInGroup = true;
      }
    }

    if (blockedInGroup && !continueOnError) break;
    index = cursor;
  }

  const metrics = buildPrepareRunMetrics(results);
  return {
    status: results.some((item) => item.status === 'failed') ? 'failed' : 'done',
    steps: results,
    finalVarContext: varContext,
    ...metrics,
    totalDurationMs: Math.max(metrics.totalDurationMs, now() - startedAt),
  };
}

module.exports = {
  buildPrepareRunMetrics,
  buildPrepareStepCacheKey,
  clearPrepareStepCache,
  evalOutputStatus,
  executeStructuredSteps,
  normalizePreparePhase,
  readPrepareStepCache,
  writePrepareStepCache,
};
