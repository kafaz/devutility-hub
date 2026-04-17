function normalizeFunctionQuery(rawToken) {
  const cleaned = String(rawToken || '')
    .trim()
    .replace(/^[`'"[\](){}]+|[`'"[\](){}:,;]+$/g, '');
  if (!cleaned) return '';

  const segments = cleaned.split(/::|->|\./g).filter(Boolean);
  return (segments[segments.length - 1] || cleaned).trim();
}

const FUNCTION_CANDIDATE_BLACKLIST = new Set([
  'and', 'catch', 'else', 'for', 'func', 'function',
  'if', 'map', 'new', 'return', 'switch', 'throw', 'try', 'while'
]);

function isLikelyFunctionToken(rawToken) {
  const normalized = normalizeFunctionQuery(rawToken);
  if (normalized.length < 3) return false;
  if (FUNCTION_CANDIDATE_BLACKLIST.has(normalized.toLowerCase())) return false;
  if (/^\d+$/.test(normalized)) return false;

  return (
    rawToken.includes('::') ||
    rawToken.includes('->') ||
    rawToken.includes('.') ||
    /[A-Z]/.test(normalized) ||
    normalized.includes('_')
  );
}

function extractFunctionCandidates(text) {
  const patterns = [
    // 匹配类似 ****[func_name:123]**** 日志格式
    /\[([A-Za-z_][A-Za-z0-9_:]*):\d+\]/g,
    /\b([A-Za-z_][A-Za-z0-9_$]*(?:(?:::|->|\.)[A-Za-z_][A-Za-z0-9_$]+)+)\b/g,
    /\b([A-Za-z_][A-Za-z0-9_$]*)\s*(?=\()/g,
    /\b([a-z]+(?:[A-Z][A-Za-z0-9_$]*)+)\b/g,
    /\b([a-z]+_[a-z0-9_]+)\b/g,
  ];

  const candidateMap = new Map();
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  lines.forEach((line) => {
    patterns.forEach((pattern) => {
      for (const match of line.matchAll(pattern)) {
        const token = String(match[1] || '').trim();
        if (!isLikelyFunctionToken(token)) continue;

        const query = normalizeFunctionQuery(token);
        if (!query) continue;

        const existing = candidateMap.get(token);
        if (existing) {
          existing.hits += 1;
        } else {
          candidateMap.set(token, {
            token,
            query,
            hits: 1,
            sampleLine: line.slice(0, 220),
          });
        }
      }
    });
  });

  return Array.from(candidateMap.values())
    .sort((left, right) =>
      right.hits - left.hits ||
      left.query.localeCompare(right.query)
    )
    .slice(0, 24);
}

const cephLogMock = `
2024-03-01 12:00:00.000 7f8b9a 0 log_channel(cluster) log [INF] : ****[OSDMonitor::update_from_paxos:452]**** handle osd ping
2024-03-01 12:00:01.000 7f8b9a 0 [ReplicatedPG::do_op:1234] starting op ReplicatedPG::do_op
ceph-osd: ****[BlueStore::_txc_add_transaction:5512]**** bad state
****[FileJournal::write_thread:200]**** write queue is full
`;

console.log("Extraction Results:", JSON.stringify(extractFunctionCandidates(cephLogMock), null, 2));
