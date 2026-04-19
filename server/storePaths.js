const path = require('path');

function getServerDataDir() {
  const configured = process.env.DEVUTILITY_DATA_DIR;
  if (configured && configured.trim()) {
    return path.resolve(configured.trim());
  }
  return path.join(__dirname, 'data');
}

module.exports = {
  getServerDataDir,
};
