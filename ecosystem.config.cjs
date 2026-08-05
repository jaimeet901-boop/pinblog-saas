/**
 * PM2 process definition for non-Docker API deployments.
 *
 * Env loading parity:
 * - PM2 (this file): node --env-file=.env with cwd ./apps/api
 * - Local npm:       apps/api/package.json "start" uses node --env-file=.env
 * - Docker Compose:  docker-compose.prod.yml env_file injects apps/api/.env
 *                    (Dockerfile.api CMD is node src/main.js without --env-file)
 */
module.exports = {
  apps: [
    {
      name: 'horizons-api',
      cwd: './apps/api',
      script: 'src/main.js',
      node_args: '--env-file=.env',
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
