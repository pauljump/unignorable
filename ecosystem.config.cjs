const path = require('path');

const cwd = __dirname;

module.exports = {
  apps: [{
    name: 'unignorable',
    cwd,
    script: 'node',
    args: 'server.js',
    env: {
      PORT: '8000',
      PUBLIC_ORIGIN: 'https://unignorable.polyfeeds.dev',
      DATA_DIR: path.join(cwd, 'data'),
      NODE_ENV: 'production',
    },
  }],
};
