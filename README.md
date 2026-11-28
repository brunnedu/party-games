# 🎲 Party Games

**One room, everyone's phone, no app to install.**

**[▶ Open the games](https://brunnedu.github.io/party-games/)**\
*Hosting needs a password, so ask me for it. Guests just scan a QR code.*

## Why I built this

Ever been on a trip with friends and wished you had that one game with you? Or got together and
realised that nobody had brought it? That kept annoying me. I also thought some of our favourite
games could use a little twist now and then.

So I built this: for more good times with friends and family, and for never missing out on a game
again just because I forgot to bring it.

I built it in my free time, with the help of [Claude Code](https://claude.com/claude-code).

## The games

| Game | Players | The idea |
|---|---|---|
| **Wavelength** | 2–10 | Guess where a clue falls between two opposites, together or against each other |
| **Der wahre Walter** | 3–10 | Fake your friend's answer so well that the others fall for it |
| **Liar's Dice** | 2–10 | Bluff about the dice, and know when to call someone else's bluff |
| **Just One** | 3–10 | Give one-word clues to help one player guess, but matching clues cancel out |
| **Imposter** | 3–10 | Everyone knows the secret word, except one of you |
| **Extreme Activity** | 4+ | Two teams explain, act, pose and make noises |

The games are in German (Swiss spelling).

## How to play

1. Someone picks a game and creates a room.
2. Friends scan the QR code and enter their names.
3. Start playing. You do the talking, and the phones handle the cards, dice and secrets.

For Extreme Activity, a single phone passed around is enough.

## Under the hood

React, TypeScript, Supabase and GitHub Pages.

- Live rooms keep everyone's phone in step.
- The game rules run in the database, so nobody can peek at hidden cards or dice.
- Automated tests check the game rules.

## Rules

<details>
<summary><b>Wavelength</b></summary>

- 2–10 players, **cooperative** or **competitive** (at least 3). The host chooses in the lobby, and
  the choice is fixed once the game starts.
- Everyone gives the same number of clues: 3 each with 2–3 players, 2 with 4–6, 1 with 7–10. The
  number of rounds is fixed when the game starts.
- The clue-giver holds a button to see the target. Typing the clue is optional.
- Cooperative: for each round, the clue-giver picks **shared** (one dial; all must confirm, moving it
  resets confirmations) or **individual** (secret guesses; the round is worth the average of their
  points).
- Competitive: everyone guesses secretly and keeps the points of their guess. The clue-giver gets the
  average of the guesses that are in, to one decimal. Most points win. People who are skipped
  because they are offline get nothing; late joiners give fewer clues.
- Distance from the target on a scale of 0–100: up to 4 earns 4 points, up to 11 earns 3, up to 18
  earns 2.
- The host can reveal without people who are offline, or replace a round (it doesn't count). New
  players can join between rounds.
- If the clue-giver leaves, the round is replaced. The game ends below 2 players, or below 3 in a
  competitive game.

</details>

<details>
<summary><b>Der wahre Walter</b></summary>

- 3–10 players. Everyone is the Sphinx equally often: twice with 3–5 players, once with 6–10.
- The Sphinx picks one of three sentences and answers truthfully. The others write fakes. Answers stay
  as typed.
- The Sphinx's answer is then locked. Only the Sphinx sees all answers, can practise and shuffle
  them, and reads them aloud with their numbers. Others vote by number.
- You can't vote for your own answer, unless somebody wrote the same.
- Answers match if they differ only in capitals, punctuation, spaces, or "ß" for "ss".
- Points: 1 for picking the truth; 1 per vote on your fake; the Sphinx gets 1 per correct vote.
  Everyone who wrote one of several matching answers gets nothing for it (the truth included).
- With 4 or more players, the Sphinx gets nothing if every vote finds the truth, provided at least
  two votes are in. (The original rulebook has this for any number of players; it also penalizes
  revealing reading, which is left to the group.) After each round, the app shows where every point
  came from.
- Reveal order: fakes with votes (fewest first), the truth, then fakes without votes.
- The host can go on without people who are offline, or replace a round before the reveal. New players
  can join between rounds. If the Sphinx leaves before the reveal, the round is replaced. Below 3
  players the game ends.

The game idea is by Urs Hostettler (Fata Morgana Spiele). Sentences and artwork here are our own.

</details>

<details>
<summary><b>Liar's Dice</b></summary>

- 2–10 players. The host sets the seating order and 1–6 starting dice (default 5) in the lobby.
- Bids are spoken: "at least N of a number". Each bid needs more dice, or the same count of a higher
  number. Ones are not wild. There is no "exactly" call.
- On your turn, you may instead doubt the previous bid (you're asked to confirm; the first doubt
  counts). All dice are then revealed, with a count per number. Until then, your dice are only yours
  to see.
- The doubter (or the host) picks who loses a die and can change it until the next round starts.
- The loser starts the next round; if out, the next player does. The last player with dice wins.
- The host can reroll a round without penalty. Leaving removes your dice and rerolls the round. Nobody
  can join a running game.

</details>

<details>
<summary><b>Just One</b> (with house rules)</summary>

- 3–10 players. Players can only join in the lobby.
- Skipping an unknown word (before any clues) costs no card.
- Identical clues and the mystery word itself are cancelled automatically. Clue-givers can cancel
  more; the host (if giving clues) or a majority confirms.
- A wrong guess also loses the next card. On the last card, it costs one point instead.
- If the guesser leaves, the round is replayed with the next player. Below 3 players the game ends.

</details>

<details>
<summary><b>Imposter</b></summary>

- 3–10 players (best with 4 or more), always one imposter.
- Everyone sees 16 words of one category. All but the imposter know the secret one. Hold the card to
  see your role.
- Hints are said out loud, in the order shown. The host opens the vote.
- Everyone votes for someone else. A tie leads to one run-off; another tie lets the imposter escape.
- Points: escaped, the imposter gets 2. Caught but guessing the word, the imposter gets 1. Caught and
  guessing wrong, everyone else gets 1.
- The host ends the game. New players can join between rounds.
- If the imposter leaves, the round is cancelled. Below 3 players the game ends.

</details>

<details>
<summary><b>Extreme Activity</b></summary>

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

</details>

---

*A hobby project. Some of the games are my own take on published party games, and this project isn't
affiliated with their creators or publishers.*
