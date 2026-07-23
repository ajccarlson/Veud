# Notification preferences and digests

Signed-in members can control the social and release-reminder events shown in
their Veud inbox. Email summaries are separately opt-in and disabled by
default. Account verification, password recovery, and other security mail are
not affected by these preferences.

## Preference contract

- Inbox and email channels have independent social and release-reminder
  controls.
- Email delivery requires at least one opted-in category and a daily or weekly
  frequency.
- Delivery uses the member's stored IANA time zone, local hour, and weekly day.
- Invalid or absent records normalize to an enabled inbox and disabled email.
- Preferences and delivery history are private, included in the member data
  export, and cascade-delete with the account.
- Disabling an inbox category hides matching events without deleting the
  canonical notification history.

## Delivery behavior

`npm run notifications:digests` previews due deliveries without sending mail.
Use `npm run notifications:digests -- --commit` to claim and deliver them.
`--limit` accepts 1 through 500 and defaults to 50.

Each delivery window has a unique owner/start/end record. Workers claim pending
or failed deliveries atomically, skip completed windows, and recover claims
that have remained in `sending` for more than 30 minutes. Successful and empty
windows advance the member's next scheduled delivery transactionally. Provider
errors and transport exceptions are retained for a later retry. This yields
at-least-once delivery after the stale-claim timeout; operators should inspect a
provider before manually replaying an ambiguous delivery.

The local PostgreSQL staging deployment installs a 15-minute user-systemd
timer. It is enabled only when `RESEND_API_KEY` is present. Inspect it with:

```sh
systemctl --user status veud-staging-notification-digests.timer
journalctl --user -u veud-staging-notification-digests.service
```

`VEUD_ORIGIN` controls links in digest mail and defaults to
`https://veud.net`.

## Quality boundaries

Unit and route tests protect safe defaults, schedule calculation, category
selection, durable delivery history, idempotent schedule advancement, settings
validation, inbox filtering, and data export. Production-browser coverage
protects persistence, mobile layout, inbox enforcement, and the signed-in WCAG
surface.
