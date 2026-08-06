# Restoring production from a backup

The document you otherwise write badly, during an outage, from memory.

Read it once now so the first time you follow it is not also the first time you
have seen it.

## Before anything

**Do not start by restoring.** A restore replaces the live database, and the
most common cause of "we need a restore" turns out not to need one. Establish
which of these you are in:

| Symptom                            | Likely cause                    | Restore needed?                |
| ---------------------------------- | ------------------------------- | ------------------------------ |
| Site returns 502, database is fine | Application failed to start     | No — redeploy                  |
| Catalog rows missing, users intact | A writer or a repair went wrong | Usually no — re-run the writer |
| A table is empty or truncated      | Migration or manual error       | Probably                       |
| Database will not start            | Storage or corruption           | Yes                            |

If you are unsure, take a **fresh backup first**. A backup of a damaged database
is still evidence, and restoring destroys the state that would tell you what
happened.

```bash
pm2 restart veud-backup    # takes one immediately
```

## What exists to restore from

Primary, on the same machine as the live data:

```
/media/sde/veud-production/backups/postgres-<timestamp>.dump
```

Offsite, on a separate physical disk:

```
/media/sdd/veud-production-backups/postgres-<timestamp>.dump
```

Every dump has a companion `.restore-verified.json` receipt. **A dump without
its receipt was never restore-tested and should not be your first choice.** The
backup pipeline writes the dump under a `.partial-<pid>` name and only renames
it once verification passes, so a file with the final name has at least been
written completely.

Retention is tiered: every snapshot for the recent window, then one a day, then
one a week. Reaching back further than a few days means looking for a daily or
weekly survivor, not an hourly one.

## Restoring

1. **Stop everything that writes.** The catalog cutover already knows how; use
   it rather than stopping processes by hand, because it also disables the
   writer timers that would otherwise fire mid-restore.

   ```bash
   systemctl --user stop 'veud-production-*.timer'
   pm2 stop veud veud-backup
   ```

2. **Confirm the archive you are about to trust.**

   ```bash
   ls -la /media/sde/veud-production/backups/postgres-<timestamp>.dump*
   cat /media/sde/veud-production/backups/postgres-<timestamp>.dump.restore-verified.json
   ```

   The receipt records the row counts the archive restored with. If those
   numbers look wrong for the moment you are restoring to, you have the wrong
   archive.

3. **Restore into the disposable verification database first**, never straight
   over production. This is what the backup pipeline already does on every run,
   so the path is well travelled.

4. **Restore into production**, with the connection details from
   `/media/sde/veud-production/config/postgres.env`:

   ```bash
   "$PG_RESTORE_BIN" --clean --if-exists --no-owner --no-privileges \
     --dbname "$DATABASE_URL" /media/sde/veud-production/backups/postgres-<timestamp>.dump
   ```

5. **Check the row counts before letting anything start.** Compare against the
   receipt from step 2.

6. **Start the application, then the writers** — in that order, so a writer
   cannot mutate a database the application has not yet proved it can read.

   ```bash
   pm2 start veud
   curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4021/resources/healthcheck
   node scripts/preflight-production.mjs
   systemctl --user start 'veud-production-*.timer'
   ```

## Afterwards

Write down what happened while it is fresh: which archive, which timestamp, what
the row counts were before and after. The next person following this document
benefits more from one honest account than from any amount of generalised
advice.

If the restore lost data that had been written since the archive, say so
explicitly rather than quietly. A restore is a decision to lose the difference,
and that is worth recording.

## What this document does not cover

- **Point-in-time recovery.** There is no WAL archiving, so restores land on
  whole snapshots. The gap between the last snapshot and the failure is lost.
- **Restoring to a different machine.** The paths and units here assume this
  host.
