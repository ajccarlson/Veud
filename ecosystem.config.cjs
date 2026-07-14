module.exports = {
  apps : [{
    name   : "veud",
    script: "npm",
    instances: 2,
    max_memory_restart: "300M",

    // Logging
    out_file: "./out.log",
    error_file: "./error.log",
    merge_logs: true,
    log_date_format: "DD-MM HH:mm:ss Z",
    log_type: "json",

    // Env Specific Config
    env_production: {
      args : "start",
      exec_mode: "cluster_mode",
    },
    env_development: {
      args : "dev",
      watch: true,
      watch_delay: 3000,
      ignore_watch: [
        "./node_modules",
        "./app/views",
        "./public",
        "./.DS_Store",
        "./package.json",
        "./yarn.lock",
        "./samples",
        "./src"
      ],
    },
  }]
}