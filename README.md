# Party Games

Browser party games: one person creates a room, everyone else joins with their phone by QR code or
5-character code. Games: **Just One**, **Imposter**, **Wavelength**, **Der wahre Walter**, **Liar's Dice** and **Extreme Activity**. The UI is in German (Swiss spelling).

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
decks and word lists.

**Updating an existing project:** the deploy workflow does not touch the database. When new files
appear in `supabase/migrations/`, run just those (in filename order) **before** pushing the code that
needs them.

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
| `npm run words` | New migration after editing a word list |

`npm test` runs the real migrations in [PGlite](https://pglite.dev) (embedded Postgres) with a
small stand-in for Supabase's auth. It needs no Supabase project. It does not cover Realtime,
Presence or the cleanup schedule.

## How it works

- **The database is the referee.** Clients can only read. Every change goes through a Postgres
  function that checks who is calling and which phase the game is in.
- **Secrets are protected by Row Level Security**, not by the UI. In Just One, the guesser can't read
  the word until the round is over, and sees only surviving clues once guessing starts. No client can
  read the deck. In Imposter, players can only ever read their own role, and votes are secret until
  everyone has voted. In Wavelength, only the clue-giver can read the target before the reveal, and
  individual guesses are secret until everyone has submitted. In Der wahre Walter, players can only
  read their own answer until it is revealed; the Sphinx gets the texts without the authors.
- **Live updates:** only the `rooms` table is published. Each change bumps `rooms.version`, and
  clients re-fetch what they are allowed to see. As a fallback they also re-fetch every 8 seconds.
- **Presence** shows who is online. Host takeover is checked by the database using heartbeats
  (a player counts as gone after 45 seconds).
- **Reconnect:** the anonymous login is kept in `localStorage`, so reloading puts you back in your
  room. Clearing site data or switching browsers creates a new player.
- Rooms idle for 24 hours are deleted. Free Supabase projects pause after 7 days without activity;
  resume them in the dashboard.

### Security

The website and its Supabase key are public, and anyone can sign in anonymously. What protects the
data are the database rules. [`permissions.test.ts`](supabase/tests/permissions.test.ts) fails if a
migration gives clients write access to a table, leaves a table without Row Level Security, or opens
up functions they shouldn't run.

[Pull requests are tested](.github/workflows/test.yml), and
[Dependabot](.github/dependabot.yml) proposes updates every week. Merging one deploys it, so check
that its tests pass first. The tests don't cover the browser, so after updating packages the app
runs on, also try it.

Set once, by the owner:

- Two-factor login for GitHub and Supabase. Both accounts can change the live site or its data.
- GitHub, in the repository's security settings: Dependabot alerts and security updates, secret
  scanning with push protection, and code scanning.
- Supabase: only anonymous sign-ins enabled (turn off email and other providers), and `private` not
  among the exposed schemas. Look at the Security Advisor now and then.

### Password and invites

Creating a room needs the site password. Joining needs the password or the room's invite, which the
QR code and the copied link carry, so guests who scan it type only their name. Anyone who has the
link can join while that room takes new players. Removing someone replaces the invite. The database
checks all of this. A browser enters the password once.

**Protection is off until you set a password**, in the SQL Editor. It needs at least 9 characters.
Pick one that is hard to guess (not a common word or name with a number) and that you use nowhere
else; several random words work well. Delete the saved query afterwards, because it contains the
password:

```sql
select private.set_app_password('...');       -- set or change; every browser has to enter it again
select private.remove_app_password();         -- protection off
select password_set from private.access_status; -- is it on?
```

Wrong attempts are limited to 10 per browser or address in 15 minutes, and 100 per hour in total.
Someone who uses up the total keeps new browsers from unlocking for a while; invites and unlocked
browsers still work. The password doesn't stop automated anonymous sign-ins or misuse of the
Realtime channels.

### Access log

The database records password attempts and room lookups, creations, joins and returns, with time,
account ID, IP address, browser, and name and room code where known. Just browsing the games isn't
recorded. Passwords never are. Only the project's owner can read it, in the SQL Editor:

```sql
select * from private.access_overview;                       -- one row per browser
select * from private.access_log order by at desc limit 100; -- every entry
select * from private.access_status;                         -- how full the log is
```

- IP addresses help to recognize visitors but can be misleading or faked.
- Repeats within an hour are left out, and there are limits per hour, so heavy traffic leaves gaps.
- **Entries are kept until you delete them.** At 100,000 entries new ones stop; the game keeps
  working. The app shows no notice about the log, so tell the people you play with. IP addresses with
  names are personal data, so delete what you no longer need, or what someone asks you to:

  ```sql
  delete from private.access_log where at < now() - interval '90 days';
  delete from private.access_log where user_id = '...';
  ```

### Just One house rules

- 3–10 players. Players can only join in the lobby.
- Skipping an unknown word (before any clues) costs no card.
- Identical clues and the mystery word itself are cancelled automatically. Clue-givers can cancel
  more; the host (if giving clues) or a majority confirms.
- A wrong guess also loses the next card. On the last card, it costs one point instead.
- If the guesser leaves, the round is replayed with the next player. Below 3 players the game ends.

### Imposter rules

- 3–10 players (best with 4 or more), always one imposter.
- Everyone sees 16 words of one category. All but the imposter know the secret one. Hold the card to
  see your role.
- Hints are said out loud, in the order shown. The host opens the vote.
- Everyone votes for someone else. A tie leads to one run-off; another tie lets the imposter escape.
- Points: escaped, the imposter gets 2. Caught but guessing the word, the imposter gets 1. Caught and
  guessing wrong, everyone else gets 1.
- The host ends the game. New players can join between rounds.
- If the imposter leaves, the round is cancelled. Below 3 players the game ends.

### Wavelength rules

- 2–10 players, cooperative. Everyone gives the same number of clues: 3 each with 2–3 players, 2 with
  4–6, 1 with 7–10. The number of rounds is fixed when the game starts.
- The clue-giver holds a button to see the target. Typing the clue is optional.
- For each round, the clue-giver picks **shared** (one dial; all must confirm, moving it resets
  confirmations) or **individual** (secret guesses; the round is worth the average of their points).
- Distance from the target on a scale of 0–100: up to 4 earns 4 points, up to 11 earns 3, up to 18
  earns 2.
- The host can reveal without people who are offline, or replace a round (it doesn't count). New
  players can join between rounds.
- If the clue-giver leaves, the round is replaced. Below 2 players the game ends.

While the shared dial is dragged, its position is previewed to others with Realtime **Broadcast**
(about 8 messages per second). Only the position at release is saved. The preview is cosmetic: anyone
who knew the room's internal ID could send fake movements, but couldn't change the saved dial.

### Der wahre Walter rules

- 3–10 players. Everyone is the Sphinx equally often: twice with 3–5 players, once with 6–10.
- The Sphinx picks one of three sentences and answers truthfully. The others write fakes. Answers stay
  as typed.
- The Sphinx's answer is then locked. Only the Sphinx sees all answers, can practise and shuffle
  them, and reads them aloud with their numbers. Others vote by number.
- You can't vote for your own answer, unless somebody wrote the same.
- Answers match if they differ only in capitals, punctuation and spaces.
- Points: 1 for picking the truth; 1 per vote on your fake; the Sphinx gets 1 per correct vote.
  Everyone who wrote one of several matching answers gets nothing for it (the truth included).
- With 4 or more players, the Sphinx gets nothing if every vote finds the truth. (The original
  rulebook has this for any number; it also penalizes revealing reading, which is left to the group.)
- Reveal order: fakes with votes (fewest first), the truth, then fakes without votes.
- The host can go on without people who are offline, or replace a round before the reveal. New players
  can join between rounds. If the Sphinx leaves before the reveal, the round is replaced. Below 3
  players the game ends.

The game idea is by Urs Hostettler (Fata Morgana Spiele). Sentences and artwork here are our own.

### Liar's Dice rules

- 2–10 players. The host sets the seating order and 1–6 starting dice (default 5) in the lobby.
- Bids are spoken: "at least N of a number". Each bid needs more dice, or the same count of a higher
  number. Ones are not wild. There is no "exactly" call.
- On a turn, a player may instead doubt the previous bid (button with confirmation; the first one
  counts). All dice are revealed with a count per number.
- The doubter (or the host) picks who loses a die and can change it until the next round starts.
- The loser starts the next round; if out, the next player does. The last player with dice wins.
- Dice are rolled by the database; others' dice are unreadable until a doubt.
- The host can reroll a round without penalty. Leaving removes your dice and rerolls the round. Nobody
  can join a running game.

### Extreme Activity rules

- At least 4 people in two teams, sitting alternately. The app knows only "Rot" and "Blau", not who
  is in which team.
- **Words:** everyone writes 1–3 words (the host can allow up to 6); about 20–30 in total work well.
  People can write on their own phone or borrow one and enter a name. Saved words aren't shown again
  until the end. One joined phone is enough; the host checks that everyone is done.
- **Playing:** one *game phone* is passed around (the host's, unless the host picks another). Only it
  shows the current word. A turn lasts 60 seconds; each guessed word is a point for the team. Words
  can't be skipped. The word left when time runs out goes back into the bucket.
- **Five modes**, each with all words once: explain (not the word or parts of it), one word,
  pantomime, statue (a single pose), sound. If the words of a mode run out during a turn, the same
  player continues in the next mode with the time left.
- After each turn, the words guessed in the last mode played can be corrected, and the open word can
  still be counted. Correct before tapping "Weitergeben".
- The host can change the game phone at any time (this pauses the clock). If the host's phone fails,
  another player can take over as host and continue.

## Adding a game

1. Create `src/games/<id>/` with the game's components, its text file (`strings.de.ts`) and a drawn
   logo (`Logo.tsx`) and an `index.ts` that exports a `GameDefinition` ([`src/core/game.ts`](src/core/game.ts)).
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
   - optionally sets `rooms.open_to_join` while it is safe for new players to join,
   - revokes `execute` from `public, anon` on new functions and grants it to `authenticated`,
   - if it adds functions to `private`, ends with
     `revoke execute on all functions in schema private from public, anon, authenticated;` and
     grants `private.is_member(uuid)` to `authenticated` again.
4. Add tests in `supabase/tests/`.

A game with settings in the lobby adds a `LobbySettings` component to its definition. The hub, lobby,
QR code, joining, reconnecting, Presence and host transfer come for free. Shared
game building blocks (waiting screens, avatars, confetti, styles) are in `src/core/ui/`.

## Possible next steps

Timer, custom word lists, statistics, a shared-screen view for a TV, sound, and more games.
