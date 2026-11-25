# Party Games

Browser party games: one person creates a room, everyone else joins with their phone by QR code or
5-character code. First game: **Just One**. The UI is in German (Swiss spelling).

Vite + React + TypeScript, Supabase (Postgres, Realtime, anonymous sign-ins), GitHub Pages.

## Setup

Needs Node.js 22.18 or newer.

### 1. Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. **Authentication → Sign In / Providers:** enable **Allow anonymous sign-ins**.
3. **SQL Editor:** run each file in [`supabase/migrations/`](supabase/migrations) **in filename
   order**. Paste the whole file and click *Run*. Run each file only once.
4. Check the hourly cleanup job: `select jobname from cron.job;` should list `cleanup-old-rooms`.
   If it doesn't, enable the `pg_cron` extension (**Database → Extensions**), then run:

   ```sql
   select cron.schedule('cleanup-old-rooms', '17 * * * *', 'select private.cleanup_old_rooms()');
   ```

Do **not** add the `private` schema to the exposed schemas in the API settings. It holds the card
decks.

### 2. Run locally

```bash
npm install
cp .env.example .env   # then fill in the project URL and anon / publishable key
npm run dev
```

Open <http://localhost:5173/party-games/>.

Never use the `service_role` (secret) key here: it bypasses all access rules.

**Several players on one computer:** normal tabs share one login. In development, add
`?player=2`, `?player=3`, … **before** the `#`:

```
http://localhost:5173/party-games/?player=2#/join/ABCDE
```

**Phones on the same Wi-Fi:** run `npm run dev:lan` and open the printed *Network* address on the
computer too, so that the QR code points to it. Windows may ask to allow Node.js through the
firewall (private networks are enough).

### 3. Deploy to GitHub Pages

1. **Settings → Pages → Source:** *GitHub Actions*.
2. **Settings → Secrets and variables → Actions → Variables:** add the repository variables
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Both end up in the public website, so they
   don't need to be secrets.
3. Push to `main`. The [workflow](.github/workflows/deploy.yml) tests, builds and deploys to
   `https://<user>.github.io/party-games/`.

If you rename the repository, change `base` in [`vite.config.ts`](vite.config.ts).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm test` | Database rules and security tests |
| `npm run build` | Type check and production build |
| `npm run words` | New migration after editing the Just One word list |

`npm test` runs the real migrations in [PGlite](https://pglite.dev) (embedded Postgres) with a
small stand-in for Supabase's auth. It needs no Supabase project. It does not cover Realtime,
Presence or the cleanup schedule.

## How it works

- **The database is the referee.** Clients can only read. Every change goes through a Postgres
  function that checks who is calling and which phase the game is in.
- **Secrets are protected by Row Level Security**, not by the UI. The guesser can't read the word
  until the round is over, and sees only surviving clues once guessing starts. No client can read
  the deck.
- **Live updates:** only the `rooms` table is published. Each change bumps `rooms.version`, and
  clients re-fetch what they are allowed to see. As a fallback they also re-fetch every 8 seconds.
- **Presence** shows who is online. Host takeover is checked by the database using heartbeats
  (a player counts as gone after 45 seconds).
- **Reconnect:** the anonymous login is kept in `localStorage`, so reloading puts you back in your
  room. Clearing site data or switching browsers creates a new player.
- Rooms idle for 24 hours are deleted. Free Supabase projects pause after 7 days without activity;
  resume them in the dashboard.

### House rules

- 3–10 players. Players can only join in the lobby.
- Skipping an unknown word (before any clues) costs no card.
- Identical clues and the mystery word itself are cancelled automatically. Clue-givers can cancel
  more; the host (if giving clues) or a majority confirms.
- A wrong guess also loses the next card. On the last card, it costs one point instead.
- If the guesser leaves, the round is replayed with the next player. Below 3 players the game ends.

## Adding a game

1. Create `src/games/<id>/` with the game's components, its text file (`strings.de.ts`) and an
   `index.ts` that exports a `GameDefinition` ([`src/core/game.ts`](src/core/game.ts)).
2. Add it to [`src/games/registry.ts`](src/games/registry.ts).
3. Add a migration in `supabase/migrations/` that:
   - inserts the game into `game_types` (same id and player limits),
   - creates its tables with Row Level Security. Revoke all rights from `anon` and
     `authenticated`, then grant only `select`. Anything no client may read goes in `private`,
   - adds a `<game>_start` function that checks host, lobby status and player count, and sets the
     room to `playing`,
   - changes data only in `security definer` functions that use `private.lock_room` and call
     `private.touch` afterwards. Set the room to `finished` when the game ends,
   - handles players leaving mid-game (trigger on `players`; see `just_one_player_removed`),
   - revokes `execute` from `public, anon` on new functions and grants it to `authenticated`.
4. Add tests in `supabase/tests/`.

The hub, lobby, QR code, joining, reconnecting, Presence and host transfer come for free.

## Possible next steps

Timer, custom word lists, statistics, a shared-screen view for a TV, sound, and more games.
