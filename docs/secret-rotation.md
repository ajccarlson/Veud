# Rotating secrets

Every secret this deployment holds, what breaks when it changes, and the order
that keeps the breakage brief.

## Where they live

```
/media/sde/veud-production/config/application.env   application and provider secrets
/media/sde/veud-production/config/postgres.env      database connection details
```

Both are read at process start. Nothing re-reads them while running, so **every
rotation needs a restart of whatever uses that secret** — that is the whole
reason this document has an order to it.

## Rotate on a schedule

| Secret                     | Rotate                              | Blast radius                                |
| -------------------------- | ----------------------------------- | ------------------------------------------- |
| `SESSION_SECRET`           | Yearly, or immediately on suspicion | Every signed-in session ends                |
| `HONEYPOT_SECRET`          | Yearly                              | In-flight form submissions fail once        |
| `INTERNAL_COMMAND_TOKEN`   | Yearly                              | Internal commands rejected until updated    |
| `VERIFICATION_SECRET_KEYS` | Yearly                              | Outstanding verification links stop working |
| Database password          | Yearly                              | Everything, briefly                         |
| Provider API keys          | On provider request or suspicion    | That provider's catalog worker only         |

## The order that matters

**Application secrets** (`SESSION_SECRET`, `HONEYPOT_SECRET`,
`INTERNAL_COMMAND_TOKEN`):

1. Generate a value of real length — these are rejected below a minimum in
   production, which is deliberate:
   ```bash
   openssl rand -base64 48
   ```
2. Edit `application.env`.
3. `pm2 restart veud`
4. Confirm the site answers and that you can still sign in:
   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4021/resources/healthcheck
   node scripts/preflight-production.mjs
   ```

Rotating `SESSION_SECRET` signs everyone out. That is the intended effect when
you are rotating because you suspect exposure, and an unwelcome surprise when
you are rotating on schedule. Choose the hour accordingly.

`VERIFICATION_SECRET_KEYS` accepts a list, so a rotation can keep the previous
key valid while links already sent are still being clicked. Add the new key
first, remove the old one on the next rotation.

**Database password:**

1. Change it in PostgreSQL first.
2. Update `DATABASE_URL` in `postgres.env`.
3. Restart the application **and** the backup worker — the backup opens its own
   connection and will otherwise fail on its next hourly run, which is the kind
   of failure nobody notices for six hours:
   ```bash
   pm2 restart veud veud-backup
   ```
4. Force a backup and confirm it completes, rather than waiting to find out:
   ```bash
   pm2 restart veud-backup && sleep 60
   tail -5 /media/sde/veud-production/app/current/out.log
   ```

**Provider API keys** (`TMDB_API_KEY`, MAL, MangaUpdates, Trakt):

1. Update `application.env`.
2. `pm2 restart veud`
3. Run the affected worker once by hand instead of waiting for its timer:
   ```bash
   systemctl --user start veud-production-tmdb-watch-providers.service
   journalctl --user -u veud-production-tmdb-watch-providers.service -n 20 --no-pager
   ```

A provider key that is wrong fails quietly in the sense that the site keeps
working — only the catalog stops updating. Check the worker rather than the
site.

## After any rotation

- `node scripts/preflight-production.mjs`
- Confirm the next hourly backup completed
- Confirm the writer timers ran on their next schedule

## If a secret has leaked

Rotate first and investigate second. In particular, rotate `SESSION_SECRET`
immediately — it signs session cookies, so anyone holding it can mint a session
for any account, and that access does not expire on its own.
