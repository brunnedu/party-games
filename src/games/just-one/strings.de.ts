// All Just One text. Swiss spelling: "ss" instead of the sharp s.
export const s = {
  name: 'Just One',
  description:
    'Kooperatives Wortratespiel: Gebt je einen Hinweis. Doch gleiche Hinweise streichen sich!',

  card: (n: number, total: number) => `Karte ${n} von ${total}`,
  score: (n: number) => `Punkte: ${n}`,
  youGuess: 'Du rätst!',
  isGuessing: (name: string) => `${name} rät`,

  theWord: 'Das Geheimwort',
  chooseHint: 'Kennen alle das Wort? Sonst überspringt es. Das kostet keine Karte.',
  acceptWord: 'Wort ist okay',
  skipWord: 'Wort überspringen',
  guesserWaitsWord: 'Die anderen schauen sich das Wort an …',

  yourClue: 'Dein Hinweis (ein Wort)',
  submitClue: 'Hinweis abgeben',
  changeClue: 'Hinweis ändern',
  clueSaved: (clue: string) => `Abgegeben: «${clue}»`,
  guesserWaitsClues: 'Die anderen schreiben ihre Hinweise …',
  progress: (done: number, total: number) => `${done} von ${total} Hinweisen sind da`,
  waitingFor: (names: string) => `Es fehlt noch: ${names}`,

  reviewTitle: 'Hinweise prüfen',
  reviewHint:
    'Tippt auf Hinweise, die zu ähnlich oder ungültig sind (z. B. «Hund» und «Hunde» oder eine Form des Geheimworts).',
  autoCancelled: 'automatisch gestrichen',
  manualCancelled: 'gestrichen',
  confirm: 'Auswahl bestätigen',
  confirmed: 'Bestätigt, warte auf die anderen …',
  confirmStatus: (n: number, needed: number) =>
    `${n} von ${needed} nötigen Bestätigungen (der Host kann allein bestätigen)`,
  guesserWaitsReview: 'Die anderen prüfen die Hinweise …',

  cluesForYou: 'Deine Hinweise',
  noClues: 'Alle Hinweise wurden gestrichen.',
  yourGuess: 'Deine Antwort',
  guess: 'Raten',
  pass: 'Passen',
  confirmPass: 'Wirklich passen? Die Karte ist dann weg.',
  waitingForGuess: (name: string) => `${name} überlegt …`,

  resultCorrect: 'Richtig! Ein Punkt.',
  resultWrong: 'Leider falsch.',
  resultPass: 'Gepasst. Die Karte ist weg.',
  wrongPenalty: 'Diese und die nächste Karte sind weg.',
  wrongPenaltyLast: 'Das war die letzte Karte: Ihr verliert einen Punkt.',
  guessWas: (guess: string) => `Antwort: «${guess}»`,
  acceptAnyway: 'Trotzdem gelten lassen',
  nextRound: 'Nächste Runde',
  finish: 'Zum Ergebnis',
  waitingForNext: 'Gleich geht es weiter …',

  gameOver: 'Spiel vorbei!',
  endedEarly: 'Das Spiel wurde vorzeitig beendet, weil weniger als 3 Personen übrig sind.',
  finalScore: (n: number, total: number) => `${n} von ${total}`,
  rating: (score: number) => {
    if (score >= 13) return 'Perfekt! Besser geht es nicht.'
    if (score === 12) return 'Unglaublich! Eure Freunde werden staunen.'
    if (score === 11) return 'Grossartig! Das ist eine Feier wert.'
    if (score >= 9) return 'Wow, nicht schlecht!'
    if (score >= 7) return 'Solider Durchschnitt. Da geht noch mehr!'
    if (score >= 4) return 'Ein guter Anfang. Versucht es nochmal!'
    return 'Übung macht den Meister. Gleich nochmal?'
  },
  history: 'Alle Karten',
  playAgain: 'Zurück zur Lobby',
  waitingForRematch: 'Der Host kann euch zurück in die Lobby bringen.',

  hostTools: 'Host-Optionen',
  forceContinue: 'Ohne fehlende Personen weiter',
  skipRound: 'Runde überspringen (Karte verfällt)',
  confirmSkipRound: 'Diese Karte wirklich verwerfen?',
  abort: 'Spiel abbrechen',
  confirmAbort: 'Spiel wirklich abbrechen und zurück zur Lobby?',

  unknownPlayer: 'Ehemalige Person',
}
