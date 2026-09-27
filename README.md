# Afterglow

A personal calendar for the songs that take you back. Built with Next.js, Spotify, and Neon Postgres; deployed on Vercel.

## What it does

- Click an empty day, search Spotify, and give that chapter of your life a song.
- New memories span seven inclusive days, or end the day before the next song begins.
- Album artwork supplies the calendar color; you can also choose your own.
- Drag either edge of a memory to adjust its dates. Keyboard users can focus an edge and use left/right for one day, up/down for one week. Neighboring songs never overlap.
- Choose the start and end of your favorite section. Clicking a day plays that clip using Spotify's Web Playback SDK.
- Sign in with Spotify to save a private calendar and sync across browsers/devices. Changes refresh on focus and every 30 seconds; concurrent changes are detected rather than overwritten.
- The signed-out example calendar is interactive and resets on reload. It is clearly marked as a demo; it does not play music or save to an account.

## Run locally

Requires Node.js 22+ and a Spotify Premium account.

```sh
npm install
cp .env.example .env.local
npm run dev
```

Set the four values in `.env.local`:

| Variable            | Purpose                                                               |
| ------------------- | --------------------------------------------------------------------- |
| `APP_URL`           | `http://127.0.0.1:3000` locally; canonical HTTPS domain in production |
| `SPOTIFY_CLIENT_ID` | Public client ID from your Spotify developer app                      |
| `DATABASE_URL`      | A Neon Postgres connection string                                     |
| `SESSION_SECRET`    | A random secret of at least 32 characters, kept stable across deploys |

Generate a secret with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and store it only in environment variables. Never commit `.env.local`.

In the [Spotify developer dashboard](https://developer.spotify.com/dashboard), enable Web API and Web Playback SDK, and register exactly:

- `http://127.0.0.1:3000/api/auth/callback`
- `https://YOUR-PRODUCTION-DOMAIN/api/auth/callback`

Open `http://127.0.0.1:3000`, not `localhost`, so the OAuth cookie and redirect origin match. PKCE is used; no Spotify client secret is required.

Database tables are created idempotently on the first authenticated database request. Calendar and session queries are scoped to the signed-in Spotify user.

## Deploy

Import this repository into Vercel as a Next.js project. Add the four environment variables, register the production callback in Spotify, and deploy. Keep `SESSION_SECRET` stable: it encrypts stored Spotify credentials. An isolated Neon database can be attached through Vercel Storage.

## Spotify requirements

The app owner and listeners need Spotify Premium for browser playback. New Development Mode apps are limited to five explicitly allowed users. Add intended accounts in the Spotify app's Users and Access page. A public website does not remove this Spotify restriction; broader availability requires Spotify approval. See [current quota rules](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

Clips control Spotify playback; audio is never downloaded or stored. Stop timing uses the browser SDK and is approximate. Background tab throttling and network/device behavior may delay stopping. Spotify's browser player also requires protected media support.

## Verification

```sh
npm test
npm run typecheck
npm run build
```

Tests cover seven-day defaults, neighboring ranges, month/leap-year boundaries, resizing, input validation, artwork URL restrictions, revision conflicts, encryption, and origin checks. Playback is also checked with a mock Spotify SDK. Live listening requires a real authorized Premium account.

## Security and privacy

Spotify login uses PKCE plus expiring encrypted state, HttpOnly SameSite cookies, opaque hashed sessions, and server-encrypted refresh tokens. Browser SDK access tokens are short-lived and returned only to an authenticated session. Calendar writes validate origin, payload size, dates, clips, track URLs, overlap, and revision. No personal calendars, account tokens, or database credentials are included in this repository.
