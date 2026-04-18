export interface FunctionCandidateToken {
  token: string;
  query: string;
  hits: number;
  sampleLine: string;
}

export interface SourceLocationCandidate {
  rawPath: string;
  path: string;
  line: number;
  hits: number;
  sampleLine: string;
}

const FUNCTION_CANDIDATE_BLACKLIST = new Set([
  'and',
  'awk',
  'bash',
  'cat',
  'catch',
  'cd',
  'echo',
  'else',
  'for',
  'func',
  'function',
  'grep',
  'head',
  'if',
  'journalctl',
  'ls',
  'map',
  'new',
  'return',
  'sed',
  'sh',
  'switch',
  'tail',
  'throw',
  'try',
  'while',
]);

const SOURCE_EXTENSIONS = [
  'c',
  'cc',
  'cpp',
  'cxx',
  'h',
  'hpp',
];

const LOCATION_PATTERN = new RegExp(
  `((?:[A-Za-z]:)?(?:[~./\\\\]|[A-Za-z0-9_-])[A-Za-z0-9_./\\\\@~:-]*?\\.(?:${SOURCE_EXTENSIONS.join('|')})):(\\d+)(?::\\d+)?`,
  'g'
);

function normalizeFunctionQuery(rawToken: string) {
  const cleaned = String(rawToken || '')
    .trim()
    .replace(/^[`'"[\](){}]+|[`'"[\](){}:,;]+$/g, '');
  if (!cleaned) return '';

  const segments = cleaned.split(/::|->/g).filter(Boolean);
  return (segments[segments.length - 1] || cleaned).trim();
}

function isLikelyFunctionToken(rawToken: string) {
  const normalized = normalizeFunctionQuery(rawToken);
  if (normalized.length < 3) return false;
  if (FUNCTION_CANDIDATE_BLACKLIST.has(normalized.toLowerCase())) return false;
  if (/^\d+$/.test(normalized)) return false;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) return false;

  return (
    rawToken.includes('::') ||
    rawToken.includes('->') ||
    normalized.includes('_') ||
    /^[a-z][a-z0-9_]{3,}$/.test(normalized)
  );
}

export function extractFunctionCandidates(text: string) {
  const exactPatterns = [
    /\[([A-Za-z_][A-Za-z0-9_:]*):\d+\]/g,
    /\b([A-Za-z_][A-Za-z0-9_:~]*)\+0x[0-9a-f]+\b/gi,
  ];

  const fuzzyPatterns = [
    /\b([A-Za-z_][A-Za-z0-9_:~]*(?:(?:::|->)[A-Za-z_][A-Za-z0-9_:~]*)+)\b/g,
    /\b([A-Za-z_][A-Za-z0-9_]*)\s*(?=\()/g,
    /\b([a-z]+_[a-z0-9_]+)\b/g,
  ];

  const candidateMap = new Map<string, FunctionCandidateToken>();
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 500);

  const processToken = (match: RegExpMatchArray, line: string, isExact: boolean) => {
    const token = String(match[1] || '').trim();
    if (!token) return;

    if (!isExact && !isLikelyFunctionToken(token)) return;

    const query = normalizeFunctionQuery(token);
    if (!query || query.length < 2 || FUNCTION_CANDIDATE_BLACKLIST.has(query.toLowerCase())) return;

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
  };

  lines.forEach((line) => {
    exactPatterns.forEach((pattern) => {
      for (const match of line.matchAll(pattern)) processToken(match, line, true);
    });
    fuzzyPatterns.forEach((pattern) => {
      for (const match of line.matchAll(pattern)) processToken(match, line, false);
    });
  });

  return Array.from(candidateMap.values())
    .sort((left, right) =>
      right.hits - left.hits ||
      left.query.localeCompare(right.query)
    )
    .slice(0, 24);
}

function normalizeLocationPath(rawPath: string) {
  const withoutScheme = String(rawPath || '').trim().replace(/^file:\/\//i, '');
  const cleaned = withoutScheme.replace(/^[`'"[\](){}<]+|[`'"\])}>.,;]+$/g, '');
  if (!cleaned || cleaned.includes('://')) return '';
  return cleaned.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+/g, '/');
}

export function extractLocationCandidates(text: string) {
  const candidateMap = new Map<string, SourceLocationCandidate>();
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 500);

  lines.forEach((line) => {
    for (const match of line.matchAll(LOCATION_PATTERN)) {
      const normalizedPath = normalizeLocationPath(match[1] || '');
      const lineNumber = Number(match[2] || 0);
      if (!normalizedPath || !Number.isFinite(lineNumber) || lineNumber <= 0) continue;

      const key = `${normalizedPath}:${lineNumber}`;
      const existing = candidateMap.get(key);
      if (existing) {
        existing.hits += 1;
      } else {
        candidateMap.set(key, {
          rawPath: String(match[1] || ''),
          path: normalizedPath,
          line: lineNumber,
          hits: 1,
          sampleLine: line.slice(0, 240),
        });
      }
    }
  });

  return Array.from(candidateMap.values())
    .sort((left, right) =>
      right.hits - left.hits ||
      left.path.length - right.path.length ||
      left.line - right.line
    )
    .slice(0, 24);
}

export function extractCLookupHints(text: string) {
  const locations = extractLocationCandidates(text);
  const functions = extractFunctionCandidates(text);

  return {
    locations,
    functions,
    hasHints: locations.length > 0 || functions.length > 0,
  };
}
