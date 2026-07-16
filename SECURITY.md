# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in Veud, please report it privately so it can be
addressed before public disclosure.

- **Preferred:** open a private security advisory on GitHub
  (repository → **Security** → **Report a vulnerability**).
- Alternatively, contact the maintainer directly through the contact details on their
  GitHub profile.

Please include:

- a description of the issue and its potential impact,
- steps to reproduce (a proof of concept if possible),
- any relevant logs or configuration, with secrets redacted.

Please do **not** open a public issue for security reports, and do not test against any
instance you do not own.

## Scope

Veud stores personal watchlist data and integrates with third-party APIs (TMDB, MyAnimeList,
AniList, Trakt) using server-held credentials. Reports concerning authentication, session
handling, the media proxy (`/media/fetch-data`), credential exposure, or access control are
especially welcome.

## Response

This is a small, community-maintained project, so responses are best-effort. You can expect
an acknowledgement of a valid report and a good-faith effort to resolve confirmed issues in a
timely manner.
