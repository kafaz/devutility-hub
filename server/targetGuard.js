function normalizePort(value) {
  if (value === undefined || value === null || value === '') return null;
  const port = Number(value);
  return Number.isFinite(port) ? port : null;
}

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeTargetAssertion(input) {
  if (!input || typeof input !== 'object') return null;

  const target = {
    nodeId: normalizeText(input.nodeId),
    host: normalizeText(input.host),
    port: normalizePort(input.port),
    username: normalizeText(input.username),
  };

  return Object.values(target).some((value) => value !== null) ? target : null;
}

function normalizeExpectedTarget(body = {}) {
  const explicit = normalizeTargetAssertion(body.target);
  if (explicit) return explicit;

  return normalizeTargetAssertion({
    nodeId: body.expectedNodeId,
    host: body.expectedHost,
    port: body.expectedPort,
    username: body.expectedUsername,
  });
}

function appendMismatch(mismatches, field, expected, actual) {
  if (expected === null || expected === undefined) return;
  if (String(expected) === String(actual ?? '')) return;
  mismatches.push({
    field,
    expected,
    actual: actual ?? null,
  });
}

function verifySessionTarget(sessionInfo, expectedTarget, options = {}) {
  const expected = normalizeTargetAssertion(expectedTarget);
  const requireTarget = options.requireTarget === true;

  if (!expected) {
    return {
      ok: !requireTarget,
      enforced: false,
      reason: requireTarget ? '缺少目标断言' : '',
      expected: null,
      session: sessionInfo || null,
      mismatches: [],
    };
  }

  if (!expected.nodeId && !expected.host) {
    return {
      ok: false,
      enforced: false,
      reason: '目标断言缺少 nodeId 或 host',
      expected,
      session: sessionInfo || null,
      mismatches: [],
    };
  }

  const session = sessionInfo || {};
  const mismatches = [];
  appendMismatch(mismatches, 'nodeId', expected.nodeId, session.nodeId);
  appendMismatch(mismatches, 'host', expected.host, session.host);
  appendMismatch(mismatches, 'port', expected.port, normalizePort(session.port || 22));
  appendMismatch(mismatches, 'username', expected.username, session.username);

  return {
    ok: mismatches.length === 0,
    enforced: true,
    reason: mismatches.length > 0 ? '目标断言与当前会话不匹配' : '',
    expected,
    session: sessionInfo || null,
    mismatches,
  };
}

function formatTargetGuardError(guard) {
  if (!guard || guard.ok) return '';
  if (!Array.isArray(guard.mismatches) || guard.mismatches.length === 0) {
    return `[Target Guard Block] ${guard.reason}`;
  }
  const details = guard.mismatches
    .map((item) => `${item.field}: expected=${item.expected}, actual=${item.actual}`)
    .join('; ');
  return `[Target Guard Block] ${guard.reason}: ${details}`;
}

module.exports = {
  formatTargetGuardError,
  normalizeExpectedTarget,
  normalizeTargetAssertion,
  verifySessionTarget,
};
