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
