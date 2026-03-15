const fs = require('fs');
const path = require('path');

const STORE_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(STORE_DIR, 'agent-login-presets.json');

function ensureStore() {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify({ presets: [] }, null, 2), 'utf8');
  }
}

function loadStore() {
  ensureStore();
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return { presets: Array.isArray(parsed.presets) ? parsed.presets : [] };
  } catch {
    return { presets: [] };
  }
}

function saveStore(store) {
  ensureStore();
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function sanitizePresetForList(preset) {
  return {
    id: preset.id,
    name: preset.name,
    host: preset.host,
    port: preset.port || 22,
    username: preset.username,
    authType: preset.authType,
    keyFilePath: preset.keyFilePath || '',
    agent: preset.agent || '',
    hasPassword: Boolean(preset.password),
    hasPassphrase: Boolean(preset.passphrase),
    jumpHost: preset.jumpHost ? {
      name: preset.jumpHost.name || '',
      host: preset.jumpHost.host,
      port: preset.jumpHost.port || 22,
      username: preset.jumpHost.username,
      authType: preset.jumpHost.authType,
      keyFilePath: preset.jumpHost.keyFilePath || '',
      agent: preset.jumpHost.agent || '',
      hasPassword: Boolean(preset.jumpHost.password),
      hasPassphrase: Boolean(preset.jumpHost.passphrase),
    } : undefined,
  };
}

function listPresets() {
  return loadStore().presets.map(sanitizePresetForList);
}

function getPresetById(id) {
  return loadStore().presets.find((preset) => preset.id === id) || null;
}

function savePreset(preset) {
  if (!preset.id || !preset.name || !preset.host || !preset.username || !preset.authType) {
    throw new Error('保存登录预设缺少必要字段');
  }

  const store = loadStore();
  const nextPreset = {
    port: 22,
    ...preset,
  };

  const index = store.presets.findIndex((item) => item.id === preset.id);
  if (index >= 0) {
    store.presets[index] = nextPreset;
  } else {
    store.presets.push(nextPreset);
  }

  saveStore(store);
  return sanitizePresetForList(nextPreset);
}

function deletePreset(id) {
  const store = loadStore();
  const before = store.presets.length;
  store.presets = store.presets.filter((preset) => preset.id !== id);
  saveStore(store);
  return before !== store.presets.length;
}

module.exports = {
  STORE_FILE,
  deletePreset,
  getPresetById,
  listPresets,
  savePreset,
};
