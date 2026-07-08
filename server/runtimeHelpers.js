const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3001;

function normalizeServerRuntimeOptions(options = {}) {
  const host = typeof options.host === 'string' && options.host.trim()
    ? options.host.trim()
    : DEFAULT_HOST;
  const port = Number.isInteger(options.port) ? options.port : DEFAULT_PORT;

  return { host, port };
}

function buildRuntimeUrls({ address, port }) {
  const hostname = typeof address === 'string' && address.trim() ? address.trim() : DEFAULT_HOST;
  const resolvedPort = Number.isInteger(port) ? port : DEFAULT_PORT;
  const httpBaseUrl = `http://${hostname}:${resolvedPort}`;

  return {
    httpBaseUrl,
    wsBaseUrl: `ws://${hostname}:${resolvedPort}/terminal`,
  };
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  normalizeServerRuntimeOptions,
  buildRuntimeUrls,
};
