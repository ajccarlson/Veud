# Contributing to Veud

Thanks for your interest in improving Veud. It is a React Router application
using Prisma, SQLite for local development and tests, and PostgreSQL in
production.

## Local setup

1. Install Node.js 22 and npm.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and add only the credentials you need.
4. Run `npm run prisma:generate:sqlite`, `npx prisma migrate deploy`, and
   `npx prisma db seed`.
5. Run `npm run dev`.

## Checks before opening a PR

- `npm run lint`
- `npm run typecheck`
- `npm run test -- --run`

Run the relevant Playwright tests for interface or browser behavior changes.
Keep changes focused and document migrations or rollout requirements.

## Database changes

Schema edits require synchronized SQLite and PostgreSQL migrations. See
[Architecture](docs/architecture.md#database-schemas) before changing either
schema. Call out destructive transformations and preserve existing data unless
removal is intentional.

## Reporting security issues

Please don't file public issues for security problems — see
[`SECURITY.md`](./SECURITY.md).
