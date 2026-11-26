// All Wavelength text. Swiss spelling: "ss" instead of the sharp s.
const points = (n: number) => n.toLocaleString('de-CH', { maximumFractionDigits: 1 })

export const s = {
  name: 'Wavelength',
  description:
    'Kooperatives Einschätzspiel: Wo liegt der Hinweis auf der Skala? Trefft die Wellenlänge!',

  points,
  round: (n: number, total: number) => `Runde ${n} von ${total}`,
  score: (n: number) => `Punkte: ${points(n)}`,
  youGive: 'Du gibst den Hinweis!',
  isGiving: (name: string) => `${name} gibt den Hinweis`,

  dialLabel: 'Zeiger auf der Skala',
  holdToPeek: 'Gedrückt halten, um das Ziel zu sehen',
  releaseToHide: 'Loslassen zum Verstecken',

  yourClue: 'Dein Hinweis (freiwillig)',
  cluePlaceholder: 'Eintippen oder laut sagen',
  modeLabel: 'So wird diese Runde geraten',
  modes: { shared: 'Gemeinsam', individual: 'Einzeln' },
  modeHelp: {
    shared: 'Alle stellen zusammen einen Zeiger ein.',
    individual: 'Alle tippen geheim. Es zählt der Durchschnitt der Punkte.',
  },
  giveTyped: 'Hinweis senden',
  giveSpoken: 'Hinweis gegeben',
  waitingForClue: (name: string) => `${name} überlegt sich einen Hinweis …`,

  clue: 'Der Hinweis',
  spokenClue: 'Wurde laut gesagt',

  sharedHelp: 'Zieht den Zeiger gemeinsam an die richtige Stelle. Alle müssen bestätigen.',
  confirm: 'Position bestätigen',
  confirmed: 'Bestätigt, warte auf die anderen …',
  confirmedCount: (n: number, total: number) => `${n} von ${total} haben bestätigt`,
  individualHelp: 'Stelle deinen eigenen Zeiger ein. Die anderen sehen ihn noch nicht.',
  submit: 'Tipp abgeben',
  change: 'Tipp ändern',
  submitted: 'Tipp abgegeben',
  submittedCount: (n: number, total: number) => `${n} von ${total} haben getippt`,
  giverWaits: 'Lass dir nichts anmerken!',
  watching: 'Du spielst ab der nächsten Runde mit.',

  verdict: (p: number) => {
    if (p >= 4) return 'Volltreffer!'
    if (p >= 3) return 'Ganz nah dran!'
    if (p >= 2) return 'Nicht schlecht!'
    if (p > 0) return 'Teilweise getroffen'
    return 'Daneben!'
  },
  roundPoints: (p: number) => `+${points(p)} ${p === 1 ? 'Punkt' : 'Punkte'}`,
  averageNote: 'Durchschnitt aller Tipps',
  guessPoints: (p: number) => `${p} ${p === 1 ? 'Punkt' : 'Punkte'}`,
  nextRound: 'Nächste Runde',
  finish: 'Zum Ergebnis',
  waitingForNext: 'Gleich geht es weiter …',
  joinNow: (code: string) => `Jetzt können neue Leute beitreten. Raumcode: ${code}`,

  gameOver: 'Spiel vorbei!',
  endedEarly: 'Das Spiel wurde vorzeitig beendet, weil weniger als 2 Personen übrig sind.',
  finalScore: (n: number, max: number) => `${points(n)} von ${max} Punkten`,
  percent: (n: number) => `${n}%`,
  rating: (percent: number) => {
    if (percent >= 90) return 'Unheimlich! Könnt ihr Gedanken lesen?'
    if (percent >= 75) return 'Fantastisch! Voll auf einer Wellenlänge.'
    if (percent >= 60) return 'Stark! Ihr versteht euch gut.'
    if (percent >= 40) return 'Ordentlich, aber da geht noch mehr.'
    if (percent >= 20) return 'Leichte Funkstörungen. Gleich nochmal?'
    return 'Kein Empfang! Ihr sendet auf ganz anderen Frequenzen.'
  },
  history: 'Alle Runden',
  playAgain: 'Zurück zur Lobby',
  waitingForRematch: 'Der Host kann euch zurück in die Lobby bringen.',

  hostTools: 'Host-Optionen',
  forceReveal: 'Ohne offline Personen aufdecken',
  skipRound: 'Runde ersetzen (zählt nicht)',
  confirmSkipRound: 'Diese Runde wirklich ersetzen?',
  abort: 'Spiel abbrechen',
  confirmAbort: 'Spiel wirklich abbrechen und zurück zur Lobby? Die Punkte gehen verloren.',

  unknownPlayer: 'Ehemalige Person',
}
