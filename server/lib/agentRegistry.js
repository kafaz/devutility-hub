const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const NODE_FILE = path.join(DATA_DIR, 'agent-nodes.json');
const PREPARE_FILE = path.join(DATA_DIR, 'prepare-profiles.json');

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
  return readJson(PREPARE_FILE, [
    {
      profileId: 'linux-root-default',
      name: 'Linux Root Default',
      description: 'Become root, load profile, and print current context.',
      steps: [
        { name: 'become-root', cmd: 'sudo su -' },
        { name: 'load-profile', cmd: 'source /etc/profile >/dev/null 2>&1 || true' },
        { name: 'print-context', cmd: 'echo "USER=$(whoami) HOST=$(hostname) PWD=$(pwd)"' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ]);
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

module.exports = {
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
