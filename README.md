<p align="center">
  <a href="https://www.veud.net/">
    <img src="app/components/ui/icons/logoV3.webp" alt="Veud" width="250">
  </a>
</p>

# Veud

Veud is a media tracker for movies, television, anime, and manga. It combines
configurable watchlists with catalog discovery, social profiles,
recommendations, and AI-assisted search.

## Core features

- Detailed desktop watchlist grids and compact mobile list cards
- Movie, television, anime, and manga catalog search
- Tip of My Tongue text and image matching
- Ratings, progress, diary history, reviews, collections, and favorites
- Profiles, follows, activity, notifications, and moderation tools
- Local TMDB and MyAnimeList catalog ingestion

## Technology

Veud uses React Router, React, TypeScript, Prisma, PostgreSQL, SCSS, Tailwind,
AG Grid, Vitest, and Playwright. Local development and tests use SQLite;
production uses PostgreSQL.

## Local development

Requirements:

- Node.js 22
- npm

```sh
npm install
cp .env.example .env
npm run prisma:generate:sqlite
npx prisma migrate deploy
npx prisma db seed
npm run dev
```

Fill in only the provider credentials needed for the feature being developed.
Never commit `.env` files or credentials.

## Validation

```sh
npm run lint
npm run typecheck
npm run test -- --run
PORT=4122 npm run test:e2e:run
```

The complete release gate is:

```sh
npm run validate:release
```

See [Testing](docs/testing.md) for browser ports, visual baselines, and
PostgreSQL validation.

## Documentation

- [Architecture](docs/architecture.md)
- [Catalog operations and provider policy](docs/catalog-operations.md)
- [Deployment and operations](docs/deployment.md)
- [Testing](docs/testing.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

Host-specific commands remain beside their implementation:

- [Local staging](ops/local-staging/README.md)
- [Local PostgreSQL production](ops/local-production/README.md)

## Data sources

Veud uses metadata from [TMDB](https://www.themoviedb.org/),
[MyAnimeList](https://myanimelist.net/), [AniList](https://anilist.co/), and
[Trakt](https://trakt.tv/). Provider attribution and source links are preserved
in the application.

## Maintainer

[Aaron Carlson](https://github.com/ajccarlson)
