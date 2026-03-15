const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const NODE_FILE = path.join(DATA_DIR, 'agent-nodes.json');
const PREPARE_FILE = path.join(DATA_DIR, 'prepare-profiles.json');

const SAFE_CONTEXT_STEPS = [
  { name: 'whoami', cmd: 'whoami' },
  { name: 'host', cmd: 'hostname' },
  { name: 'pwd', cmd: 'pwd' },
  { name: 'uptime', cmd: 'uptime' },
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
    steps: SAFE_CONTEXT_STEPS,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

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
      steps: SAFE_CONTEXT_STEPS,
      updatedAt: Date.now(),
    };
  });
  const existingIds = new Set(merged.map((profile) => profile.profileId));

  for (const profile of DEFAULT_PREPARE_PROFILES) {
    if (existingIds.has(profile.profileId)) continue;
    merged.push(profile);
    changed = true;
  }

  return {
    profiles: merged,
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
  deleteNode,
  deletePrepareProfile,
  getNode,
  getPrepareProfile,
  listNodes,
  listPrepareProfiles,
  resolveNode,
  saveNode,
  savePrepareProfile,
  updateNode,
  updatePrepareProfile,
};
