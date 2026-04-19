const fs = require('fs');
const path = require('path');
const { getServerDataDir } = require('../storePaths');

const DATA_DIR = getServerDataDir();
const NODE_FILE = path.join(DATA_DIR, 'agent-nodes.json');
const PREPARE_FILE = path.join(DATA_DIR, 'prepare-profiles.json');
const DEFAULT_PREPARE_PROFILE_VERSION = 3;

const READY_SHELL_STEPS = [
  {
    name: 'load-shell-profile',
    cmd: 'source /etc/profile >/dev/null 2>&1 || true; [ -f ~/.bashrc ] && source ~/.bashrc >/dev/null 2>&1 || true; [ -f ~/.zshrc ] && source ~/.zshrc >/dev/null 2>&1 || true',
    phase: 'ready',
    mode: 'pty',
  },
  {
    name: 'set-diagnostic-env',
    cmd: 'export LANG=C.UTF-8; export LC_ALL=C.UTF-8; export TERM=xterm-256color; export LESS=-SR; alias ll=\"ls -alF\" >/dev/null 2>&1 || true; printf \"READY user=%s host=%s pwd=%s\\n\" \"$(whoami)\" \"$(hostname)\" \"$(pwd)\"',
    phase: 'ready',
    mode: 'pty',
  },
];

const FAST_CONTEXT_STEPS = [
  {
    name: 'collect-fast-context',
    cmd: 'printf "[context] user=%s\\n[context] host=%s\\n[context] pwd=%s\\n[context] shell=%s\\n" "$(whoami)" "$(hostname)" "$(pwd)" "${SHELL:-unknown}"',
    phase: 'context',
    mode: 'exec',
    parallelGroup: 'fast-context',
  },
  {
    name: 'warm-common-tools',
    cmd: 'for cmd in journalctl dmesg ss ps top iostat vmstat tail grep awk sed; do if command -v \"$cmd\" >/dev/null 2>&1; then printf \"[tool] %s=%s\\n\" \"$cmd\" \"$(command -v \"$cmd\")\"; fi; done',
    phase: 'context',
    mode: 'exec',
    parallelGroup: 'fast-context',
    cacheKey: 'warm-common-tools',
    cacheScope: 'target',
    cacheTtlMs: 600000,
  },
];

const SAFE_CONTEXT_STEPS = [
  ...FAST_CONTEXT_STEPS,
  {
    name: 'uptime',
    cmd: 'uptime',
    phase: 'context',
    mode: 'exec',
    parallelGroup: 'fast-context',
  },
];

const LOCALIZATION_FAST_PATH_STEPS = [
  ...READY_SHELL_STEPS,
  ...FAST_CONTEXT_STEPS,
];

const LOCALIZATION_BOOST_STEPS = [
  ...LOCALIZATION_FAST_PATH_STEPS,
  {
    name: 'collect-runtime-window',
    cmd: 'printf "WINDOW ts=%s uptime=%s shell=%s\\n" "$(date +%FT%T%z 2>/dev/null || date)" "$(uptime | tr \'\\n\' \' \')" "${SHELL:-unknown}"',
    phase: 'context',
    mode: 'exec',
    parallelGroup: 'boost-context',
  },
];

const LEGACY_ROOT_STEPS = [
  { name: 'become-root', cmd: 'sudo su -' },
  { name: 'load-profile', cmd: 'source /etc/profile >/dev/null 2>&1 || true' },
  { name: 'print-context', cmd: 'echo "USER=$(whoami) HOST=$(hostname) PWD=$(pwd)"' },
];

const DEFAULT_PREPARE_PROFILES = [
  {
    profileId: 'linux-readonly-context',
    name: 'Linux Readonly Context',
    description: 'Collect current identity and host context without mutating shell state.',
    builtinVersion: 3,
    managedBy: 'system',
    version: DEFAULT_PREPARE_PROFILE_VERSION,
    steps: SAFE_CONTEXT_STEPS,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    profileId: 'linux-problem-localization-fast-path',
    name: 'Linux Problem Localization Fast Path',
    description: 'Prioritize shell readiness first, then parallelize read-only probes so issue localization can start faster after login.',
    builtinVersion: 3,
    managedBy: 'system',
    version: DEFAULT_PREPARE_PROFILE_VERSION,
    steps: LOCALIZATION_FAST_PATH_STEPS,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    profileId: 'linux-problem-localization-boost',
    name: 'Linux Problem Localization Boost',
    description: 'Warm the shell profile, parallelize safe context probes, and collect a broader runtime snapshot for deeper follow-up localization.',
    builtinVersion: 4,
    managedBy: 'system',
    version: DEFAULT_PREPARE_PROFILE_VERSION,
    steps: LOCALIZATION_BOOST_STEPS,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

function cloneSteps(steps) {
  return Array.isArray(steps) ? steps.map((step) => ({ ...step })) : [];
}

function materializeBuiltinProfile(profile, createdAt) {
  const now = Date.now();
  return {
    ...profile,
    steps: cloneSteps(profile.steps),
    createdAt: createdAt || now,
    updatedAt: now,
  };
}

function selectPrepareProfileSteps(profileOrSteps, stage = 'all') {
  const rawSteps = Array.isArray(profileOrSteps)
    ? profileOrSteps
    : Array.isArray(profileOrSteps?.steps)
      ? profileOrSteps.steps
      : [];

  const normalized = rawSteps
    .filter((step) => step && step.cmd)
    .map((step) => ({
      ...step,
      stage: step.phase === 'context' ? 'background' : 'essential',
    }));

  if (stage === 'background') {
    return normalized.filter((step) => step.stage === 'background');
  }
  if (stage === 'essential') {
    return normalized.filter((step) => step.stage === 'essential');
  }
  return normalized;
}

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

function mergeDefaultPrepareProfiles(profiles) {
  const current = Array.isArray(profiles) ? profiles : [];
  const builtinProfiles = new Map(DEFAULT_PREPARE_PROFILES.map((profile) => [profile.profileId, profile]));
  let changed = false;
  const merged = current.map((profile) => {
    const steps = Array.isArray(profile?.steps) ? profile.steps.map((step) => step?.cmd) : [];
    const isLegacyRootDefault =
      profile?.profileId === 'linux-root-default' &&
      JSON.stringify(steps) === JSON.stringify(LEGACY_ROOT_STEPS.map((step) => step.cmd));

    if (!isLegacyRootDefault) return profile;

    changed = true;
    return {
      ...profile,
      name: 'Linux Default Context',
      description: 'Collect current identity and host context without mutating shell state.',
      builtinVersion: 2,
      steps: cloneSteps(SAFE_CONTEXT_STEPS),
      updatedAt: Date.now(),
    };
  });

  const upgraded = merged.map((profile) => {
    const builtin = builtinProfiles.get(profile?.profileId);
    if (!builtin) return profile;

    const currentVersion = Number(profile?.builtinVersion || 0);
    const nextVersion = Number(builtin.builtinVersion || 0);
    if (currentVersion >= nextVersion) return profile;

    changed = true;
    return {
      ...profile,
      ...materializeBuiltinProfile(builtin, profile?.createdAt),
    };
  });

  const existingIds = new Set(upgraded.map((profile) => profile.profileId));

  for (const profile of DEFAULT_PREPARE_PROFILES) {
    if (existingIds.has(profile.profileId)) continue;
    upgraded.push(materializeBuiltinProfile(profile));
    changed = true;
  }

  return {
    profiles: upgraded,
    changed,
  };
}

function listNodes() {
  return readJson(NODE_FILE, []);
}

function getNode(nodeId) {
  return listNodes().find((node) => node.nodeId === nodeId) || null;
}

function saveNode(input) {
  const now = Date.now();
  const nodes = listNodes();
  const existingIndex = nodes.findIndex((node) => node.nodeId === input.nodeId);
  const nextNode = {
    aliases: [],
    tags: [],
    port: 22,
    ...input,
    updatedAt: now,
  };

  if (existingIndex >= 0) {
    nextNode.createdAt = nodes[existingIndex].createdAt || now;
    nodes[existingIndex] = { ...nodes[existingIndex], ...nextNode };
  } else {
    nextNode.createdAt = now;
    nodes.push(nextNode);
  }

  writeJson(NODE_FILE, nodes);
  return nextNode;
}

function updateNode(nodeId, patch) {
  const current = getNode(nodeId);
  if (!current) return null;
  return saveNode({ ...current, ...patch, nodeId });
}

function deleteNode(nodeId) {
  const nodes = listNodes();
  const next = nodes.filter((node) => node.nodeId !== nodeId);
  if (next.length === nodes.length) return false;
  writeJson(NODE_FILE, next);
  return true;
}

function resolveNode(query) {
  const text = String(query || '').trim().toLowerCase();
  if (!text) return null;

  return listNodes().find((node) => {
    const haystacks = [
      node.nodeId,
      node.name,
      node.host,
      ...(Array.isArray(node.aliases) ? node.aliases : []),
      ...(Array.isArray(node.tags) ? node.tags : []),
      node.role,
      node.env,
    ]
      .filter(Boolean)
      .map((item) => String(item).toLowerCase());

    return haystacks.some((item) => item === text || item.includes(text));
  }) || null;
}

function listPrepareProfiles() {
  const stored = readJson(PREPARE_FILE, DEFAULT_PREPARE_PROFILES);
  const { profiles, changed } = mergeDefaultPrepareProfiles(stored);
  if (changed) {
    writeJson(PREPARE_FILE, profiles);
  }
  return profiles;
}

function getPrepareProfile(profileId) {
  return listPrepareProfiles().find((profile) => profile.profileId === profileId) || null;
}

function savePrepareProfile(input) {
  const now = Date.now();
  const profiles = listPrepareProfiles();
  const existingIndex = profiles.findIndex((profile) => profile.profileId === input.profileId);
  const nextProfile = {
    description: '',
    steps: [],
    ...input,
    updatedAt: now,
  };

  if (existingIndex >= 0) {
    nextProfile.createdAt = profiles[existingIndex].createdAt || now;
    profiles[existingIndex] = { ...profiles[existingIndex], ...nextProfile };
  } else {
    nextProfile.createdAt = now;
    profiles.push(nextProfile);
  }

  writeJson(PREPARE_FILE, profiles);
  return nextProfile;
}

function updatePrepareProfile(profileId, patch) {
  const current = getPrepareProfile(profileId);
  if (!current) return null;
  return savePrepareProfile({ ...current, ...patch, profileId });
}

function deletePrepareProfile(profileId) {
  const profiles = listPrepareProfiles();
  const next = profiles.filter((profile) => profile.profileId !== profileId);
  if (next.length === profiles.length) return false;
  writeJson(PREPARE_FILE, next);
  return true;
}

module.exports = {
  DEFAULT_PREPARE_PROFILES,
  deleteNode,
  deletePrepareProfile,
  getNode,
  getPrepareProfile,
  listNodes,
  listPrepareProfiles,
  mergeDefaultPrepareProfiles,
  resolveNode,
  saveNode,
  savePrepareProfile,
  selectPrepareProfileSteps,
  updateNode,
  updatePrepareProfile,
};
