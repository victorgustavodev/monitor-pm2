module.exports = {
  apps: [
    {
      name: "ati-dev-cockpit",
      script: "./apps/backend/dist/main.js",
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "150M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
