const path = require('path');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3001;

function normalizeServerRuntimeOptions(options = {}) {
  const host = typeof options.host === 'string' && options.host.trim()
    ? options.host.trim()
    : DEFAULT_HOST;
  const port = Number.isInteger(options.port) ? options.port : DEFAULT_PORT;
  const staticDir = typeof options.staticDir === 'string' && options.staticDir.trim()
    ? path.resolve(options.staticDir)
    : null;

  return {
    host,
    port,
    staticDir,
  };
}

function buildRuntimeUrls({ address, port }) {
  const hostname = typeof address === 'string' && address.trim() ? address.trim() : DEFAULT_HOST;
  const resolvedPort = Number.isInteger(port) ? port : DEFAULT_PORT;
  const httpBaseUrl = `http://${hostname}:${resolvedPort}`;
  const wsProtocol = httpBaseUrl.startsWith('https://') ? 'wss' : 'ws';

  return {
    httpBaseUrl,
    wsBaseUrl: `${wsProtocol}://${hostname}:${resolvedPort}/terminal`,
  };
}

function shouldServeAppShell(requestPath) {
  if (!requestPath || requestPath === '/terminal') {
    return false;
  }

  if (requestPath === '/' || requestPath === '/index.html') {
    return true;
  }

  if (requestPath.startsWith('/api/')) {
    return false;
  }

  const ext = path.extname(requestPath);
  if (ext) {
    return false;
  }

  return true;
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  normalizeServerRuntimeOptions,
  buildRuntimeUrls,
  shouldServeAppShell,
};
