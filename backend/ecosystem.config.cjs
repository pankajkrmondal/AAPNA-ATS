/**
 * PM2 ecosystem config for the ATS backend + resume worker.
 *
 * Defines apps for three environments — local, staging, production — each with
 * two processes: the HTTP server (src/server.js) and the BullMQ resume worker
 * (src/workers/resumeWorker.js).
 *
 * The app loads its `.env.<NODE_ENV>` file automatically (see src/config/index.js),
 * so PM2 only needs to set NODE_ENV correctly. `cwd` points at each server's
 * deploy directory so PM2 resolves the right .env.<env> and logs.
 *
 * NOTE: this file is .cjs (CommonJS) because the package is "type": "module".
 *
 * Usage — start only the apps for the current machine by name:
 *
 *   Local       : pm2 start ecosystem.config.cjs --only ats-local-backend,ats-local-worker
 *   Staging     : pm2 start ecosystem.config.cjs --only ats-staging-backend,ats-staging-worker
 *   Production  : pm2 start ecosystem.config.cjs --only ats-prod-backend,ats-prod-worker
 *
 *   pm2 save            # persist process list across reboots
 *   pm2 startup         # generate the boot script (run once per server)
 *   pm2 logs <name>     # tail logs
 *   pm2 reload <name>   # zero-downtime reload after a deploy
 */

// Deploy directories per environment (keyed by NODE_ENV).
// Adjust if your server layout differs.
const PATHS = {
  // On the developer machine PM2 runs from the repo checkout.
  // Local uses NODE_ENV=development, matching the existing .env.development file.
  development: __dirname,
  staging: '/var/www/html/ats-platform-staging/backend',
  production: '/var/www/html/ats-platform-prod/backend',
};

// Shared defaults applied to every process.
const common = {
  script: 'src/server.js',
  instances: 1,
  exec_mode: 'fork',
  autorestart: true,
  max_memory_restart: '500M',
  // Restart loop protection: if it crashes 10x within min_uptime, stop trying.
  min_uptime: '10s',
  max_restarts: 10,
  // Combine timestamped logs; PM2 writes to <cwd>/logs by default here.
  time: true,
};

/** Build a backend (HTTP server) app definition for an environment. */
function backend(env, nodeEnv) {
  return {
    ...common,
    name: `ats-${env}-backend`,
    cwd: PATHS[nodeEnv],
    script: 'src/server.js',
    env: { NODE_ENV: nodeEnv },
    error_file: `logs/pm2-${env}-backend-error.log`,
    out_file: `logs/pm2-${env}-backend-out.log`,
  };
}

/** Build a resume worker app definition for an environment. */
function worker(env, nodeEnv) {
  return {
    ...common,
    name: `ats-${env}-worker`,
    cwd: PATHS[nodeEnv],
    script: 'src/workers/resumeWorker.js',
    env: { NODE_ENV: nodeEnv },
    error_file: `logs/pm2-${env}-worker-error.log`,
    out_file: `logs/pm2-${env}-worker-out.log`,
  };
}

module.exports = {
  apps: [
    // Local development (NODE_ENV=development)
    backend('local', 'development'),
    worker('local', 'development'),

    // Staging server
    backend('staging', 'staging'),
    worker('staging', 'staging'),

    // Production server
    backend('prod', 'production'),
    worker('prod', 'production'),
  ],
};
