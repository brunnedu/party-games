// All "Der wahre Walter" text. Swiss spelling: "ss" instead of the sharp s.
export const s = {
  name: 'Der wahre Walter',
  description:
    'Bluff- und Kennenlernspiel: Erfindet Antworten im Namen der Sphinx. Welcher ist der wahre Walter?',

  gap: 'WALTER',
  round: (n: number, total: number) => `Runde ${n} von ${total}`,
  youAreSphinx: 'Du bist die Sphinx!',
  isSphinx: (name: string) => `${name} ist die Sphinx`,

  chooseTitle: 'Wähle deinen Satz',
  waitingForChoice: (name: string) => `${name} wählt einen Satz …`,

  truthLabel: 'Deine wahre Antwort',
  truthWarning:
    'Du kannst sie danach nicht mehr ändern, weil du anschliessend die Fälschungen siehst.',
  submitTruth: 'Wahrheit festlegen',
  fakeLabel: (name: string) => `Was würde ${name} schreiben?`,
  fakeHelp: 'Erfinde eine Antwort, die man der Sphinx zutraut. Sie bleibt genau so, wie du sie tippst.',
  submit: 'Antwort abgeben',
  change: 'Antwort ändern',
  yourAnswer: (answer: string) => `Abgegeben: «${answer}»`,
  progress: (done: number, total: number) => `${done} von ${total} Antworten sind da`,

  practiceTitle: 'Alle Antworten',
  practiceHelp:
    'Nur du siehst das. Lies alles einmal für dich, damit du jede Antwort so vorlesen kannst, als wäre sie deine.',
  realMark: 'deine echte Antwort',
  shuffle: 'Mischen',
  startReading: 'Vorlesen starten',
  waitingForAnswers: 'Warte, bis alle Antworten da sind.',

  readTitle: 'Lies jetzt vor',
  readHelp: 'Sag zu jeder Antwort die Nummer. Und verrate dich nicht!',
  listen: (name: string) => `${name} liest vor. Hör gut zu!`,
  voteTitle: 'Welche Nummer ist der wahre Walter?',
  own: 'deine',
  ownNumber: (n: number) => `Deine Antwort hat die Nummer ${n}.`,
  vote: 'Stimme abgeben',
  changeVote: 'Stimme ändern',
  votedFor: (n: number) => `Deine Stimme: Nummer ${n}`,
  votesIn: (done: number, total: number) => `${done} von ${total} haben abgestimmt`,
  watching: 'Du spielst ab der nächsten Runde mit.',

  revealStart: 'Auflösung starten',
  revealVoters: 'Weiter: Wer war es?',
  revealNext: 'Nächste Antwort',
  revealWaiting: (name: string) => `${name} löst auf …`,
  number: (n: number) => `Nr. ${n}`,
  votedBy: 'Darauf getippt:',
  noVotes: 'Niemand hat darauf getippt.',
  writtenBy: (names: string) => `Geschrieben von ${names}`,
  stamp: 'Der wahre Walter!',
  alsoWrote: (names: string) => `Genau so auch geschrieben von ${names}`,
  twinNote: 'Gleiche Antworten geben ihren Verfassern keine Punkte.',

  roundPoints: 'Punkte dieser Runde',
  noPoints: 'In dieser Runde gab es keine Punkte.',
  foul: 'Alle haben die Wahrheit erkannt: Die Sphinx bekommt diesmal nichts.',
  gained: (n: number) => `+${n}`,
  scores: 'Punktestand',
  nextRound: 'Nächste Runde',
  finish: 'Zur Rangliste',
  waitingForNext: 'Gleich geht es weiter …',
  joinNow: (code: string) => `Jetzt können neue Leute beitreten. Raumcode: ${code}`,

  gameOver: 'Spiel vorbei!',
  winners: (names: string, several: boolean) => `${names} ${several ? 'gewinnen' : 'gewinnt'}!`,
  noWinner: 'Diesmal gab es keine Punkte.',
  history: 'Die wahren Walter',
  playAgain: 'Zurück zur Lobby',
  waitingForRematch: 'Der Host kann euch zurück in die Lobby bringen.',

  hostTools: 'Host-Optionen',
  forceContinue: 'Ohne offline Personen weiter',
  forceReveal: 'Auflösen (Sphinx ist offline)',
  skipRound: 'Runde ersetzen (zählt nicht)',
  confirmSkipRound: 'Diese Runde wirklich ersetzen?',
  abort: 'Spiel abbrechen',
  confirmAbort: 'Spiel wirklich abbrechen und zurück zur Lobby? Die Punkte gehen verloren.',

  unknownPlayer: 'Ehemalige Person',
}
