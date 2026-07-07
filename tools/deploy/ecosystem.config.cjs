/* eslint-env node */
/* global module */
module.exports = {
  apps: [
    { name: 'docmee-api', script: 'apps/api/dist/index.js', max_memory_restart: '512M', env: { PORT: 3001 } },
    { name: 'docmee-workers', script: 'apps/workers/dist/index.js', max_memory_restart: '256M' },
    { name: 'docmee-inboxos', script: 'apps/inboxos/server.js', max_memory_restart: '256M', env: { PORT: 3000 } },
    { name: 'docmee-licensekit', script: 'apps/licensekit/dist/index.js', max_memory_restart: '128M', env: { PORT: 3002 } }
  ]
}
