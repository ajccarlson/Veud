# Contributing to Veud

Thanks for your interest in improving Veud! It's a [Remix](https://remix.run/) app built on
the [Epic Stack](https://github.com/epicweb-dev/epic-stack), backed by SQLite via Prisma.

## Local setup

1. **Prerequisites:** Node.js (see the `engines` field in `package.json`) and npm.
2. **Install:** `npm install`
3. **Environment:** `cp .env.example .env`, then fill in the values — the third-party API
   credentials you need (TMDB, MyAnimeList, AniList, Trakt) and the session/auth secrets.
   `.env` (and other `.env.*` files) are git-ignored.
4. **Database:** `npx prisma migrate deploy` to create the local SQLite database, then
   `npx prisma db seed` for sample data.
5. **Run:** `npm run dev` and open the printed URL.

## Checks before opening a PR

- `npm run typecheck` — must be clean.
- `npm run test` — the Vitest suite must pass.
- Keep changes focused, and describe the intent (plus any migration or rollout steps) in the
  PR description.

## Database changes

Schema edits require a Prisma migration: generate one with
`npx prisma migrate dev --name <short-description>` and commit the generated
`prisma/migrations/**` folder. Migrations that drop or transform columns are destructive —
call that out in the PR, and make sure existing data is preserved or intentionally removed.

## Reporting security issues

Please don't file public issues for security problems — see [`SECURITY.md`](./SECURITY.md).
