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
  }, {
    // Automatic, timestamped SQLite backups (safe online backup via better-sqlite3).
    // Fork-mode, non-restarting: it runs once when PM2 starts and then hourly via
    // cron_restart, so `npm run start:prod` gives you backups with no separate command or
    // crontab entry. The script no-ops under NODE_ENV=development, so `start:dev` does not
    // produce backups even though this ecosystem file is shared by both.
    name: "veud-backup",
    script: "scripts/backup-db.mjs",
    autorestart: false,
    cron_restart: "0 * * * *",

    env_production: {
      NODE_ENV: "production",
    },
    env_development: {
      NODE_ENV: "development",
    },
  }]
}
