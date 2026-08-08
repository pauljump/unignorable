// The portfolio control plane owns production process definitions. This wrapper
// keeps project-local PM2 commands usable without creating a second definition.
const controlPlane = require('/Users/mini-home/Desktop/Monorepo/control-plane/deploy/pm2/ecosystem.config.cjs');

module.exports = {
  apps: controlPlane.apps.filter(app => app.name === 'unignorable-canonical'),
};
