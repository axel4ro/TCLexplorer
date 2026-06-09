module.exports = {
  apps: [
    {
      name: "tcl-api",
      script: "server.js",
      cwd: "/opt/tcl-api",
      instances: 2,
      exec_mode: "cluster",
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
        PORT: 4000,
        // ADMIN_SECRET loaded from /opt/tcl-api/.env
      },
      env_file: "/opt/tcl-api/.env",
      error_file: "/var/log/tcl-api-error.log",
      out_file: "/var/log/tcl-api-out.log",
      time: true,
      restart_delay: 3000,
      max_restarts: 10,
    },
  ],
};
