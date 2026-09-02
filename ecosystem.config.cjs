module.exports = {
  apps: [
    {
      name: "urban-alert",
      cwd: "/home/kim/urban-alert",
      script: "node_modules/next/dist/bin/next",
      args: "start --port 3001",
      env: {
        NODE_ENV: "production",
        PORT: "3001",
        POLL_ENABLED: "1",
        NER_URL: "http://127.0.0.1:3002",
      },
      max_restarts: 5,
      min_uptime: "10s",
      restart_delay: 4000,
    },
    {
      name: "urban-alert-ner",
      cwd: "/home/kim/urban-alert",
      script: "train/ner_server.py",
      interpreter: "/home/kim/urban-alert/models/.venv/bin/python",
      env: {
        NER_MODEL: "/home/kim/urban-alert/models/koelectra-ner",
        NER_HOST: "127.0.0.1",
        NER_PORT: "3002",
      },
      max_restarts: 5,
      min_uptime: "15s",
      restart_delay: 4000,
    },
  ],
};
