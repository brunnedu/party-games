// All Imposter text. Swiss spelling: "ss" instead of the sharp s.
export const s = {
  name: 'Imposter',
  description:
    'Bluffspiel: Alle kennen das Geheimwort, nur eine Person nicht. Findet ihr sie?',

  round: (n: number) => `Runde ${n}`,
  category: 'Kategorie',

  holdToReveal: 'Gedrückt halten, um deine Rolle zu sehen',
  holdWarning: 'Pass auf, dass niemand auf deinen Bildschirm schaut.',
  youAreImposter: 'Du bist der Imposter!',
  imposterHint: 'Bluffe mit und finde das Wort heraus.',
  theWord: 'Das Geheimwort',

  hintsTitle: 'Sagt reihum je ein Wort',
  hintsHelp:
    'Gebt einen Hinweis zum Geheimwort, aber verratet nicht zu viel. Ein oder zwei Runden, dann wird abgestimmt.',
  starts: 'beginnt',
  openVoting: 'Abstimmung starten',
  waitingForVoting: 'Wenn ihr bereit seid, startet der Host die Abstimmung.',

  voteTitle: 'Wer ist der Imposter?',
  runoffTitle: 'Gleichstand! Stichwahl',
  runoffHelp: 'Stimmt nochmals ab. Bei erneutem Gleichstand entkommt der Imposter.',
  vote: 'Stimme abgeben',
  changeVote: 'Stimme ändern',
  votedFor: (name: string) => `Deine Stimme: ${name}`,
  votesIn: (n: number, total: number) => `${n} von ${total} haben abgestimmt`,
  firstVote: 'Erste Abstimmung',
  votes: 'Stimmen',
  votedLine: (voter: string, target: string) => `${voter} → ${target}`,

  caught: (name: string) => `Erwischt! ${name} ist der Imposter.`,
  lastChance: 'Letzte Chance: Tippe auf das Geheimwort.',
  confirmGuess: (word: string) => `«${word}» raten`,
  waitingForGuess: (name: string) => `${name} darf noch das Geheimwort raten …`,

  wasImposter: (name: string) => `${name} war der Imposter.`,
  outcome: {
    escaped: 'Der Imposter ist entkommen!',
    caught_guessed: 'Erwischt, aber das Wort erraten!',
    caught_missed: 'Der Imposter ist entlarvt!',
    cancelled: 'Runde abgebrochen',
  },
  points: {
    escaped: (name: string) => `${name} bekommt 2 Punkte.`,
    caught_guessed: (name: string) => `${name} bekommt 1 Punkt.`,
    caught_missed: () => 'Alle anderen bekommen 1 Punkt.',
    cancelled: () => 'Diese Runde gibt es keine Punkte.',
  },
  guessWas: (word: string) => `Tipp: «${word}»`,
  accused: (name: string) => `Verdächtigt wurde ${name}.`,

  scores: 'Punktestand',
  nextRound: 'Nächste Runde',
  endGame: 'Spiel beenden',
  confirmEndGame: 'Spiel wirklich beenden und die Rangliste zeigen?',
  waitingForNext: 'Der Host startet die nächste Runde.',
  joinNow: (code: string) => `Jetzt können neue Leute beitreten. Raumcode: ${code}`,
  watching: 'Du spielst ab der nächsten Runde mit.',

  gameOver: 'Spiel vorbei!',
  winners: (names: string, several: boolean) => `${names} ${several ? 'gewinnen' : 'gewinnt'}!`,
  noWinner: 'Diesmal gab es keine Punkte.',
  playAgain: 'Zurück zur Lobby',
  waitingForRematch: 'Der Host kann euch zurück in die Lobby bringen.',

  hostTools: 'Host-Optionen',
  closeVoting: 'Ohne offline Personen auszählen',
  skipGuess: 'Tipp überspringen (Imposter offline)',
  cancelRound: 'Runde abbrechen (keine Punkte)',
  confirmCancelRound: 'Diese Runde wirklich abbrechen?',
  abort: 'Spiel abbrechen',
  confirmAbort: 'Spiel wirklich abbrechen und zurück zur Lobby? Die Punkte gehen verloren.',

  unknownPlayer: 'Ehemalige Person',
}
