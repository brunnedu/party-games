// All Wavelength text. Swiss spelling: "ss" instead of the sharp s.
const points = (n: number) => n.toLocaleString('de-CH', { maximumFractionDigits: 1 })

export const s = {
  name: 'Wavelength',
  description:
    'Einschätzspiel, miteinander oder gegeneinander: Wo liegt der Hinweis auf der Skala? Trefft die Wellenlänge!',

  points,

  variantTitle: 'Spielart',
  variants: { cooperative: 'Kooperativ', competitive: 'Wettkampf' },
  variantHelp: {
    cooperative: 'Ihr sammelt gemeinsam Punkte.',
    competitive:
      'Alle tippen einzeln und sammeln eigene Punkte. Wer den Hinweis gibt, bekommt den Durchschnitt der anderen. Ab 3 Personen.',
  },
  ownScore: (n: number) => `Deine Punkte: ${points(n)}`,
  competitiveHelp:
    'Alle tippen geheim und behalten ihre Punkte. Du bekommst den Durchschnitt.',
  giverGets: (name: string) => `${name} gab den Hinweis und bekommt den Durchschnitt.`,
  youGave: 'Du hast den Hinweis gegeben und bekommst den Durchschnitt.',
  giverTag: 'Hinweis',
  satOut: 'Diesmal ohne Tipp',
  scores: 'Punktestand',
  winners: (names: string, several: boolean) => `${names} ${several ? 'gewinnen' : 'gewinnt'}!`,
  noWinner: 'Diesmal gab es keine Punkte.',
  endedEarlyCompetitive:
    'Das Spiel wurde vorzeitig beendet, weil weniger als 3 Personen übrig sind.',
  average: (n: number) => `Ø ${points(n)}`,

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
  guessPoints: (p: number) => `${points(p)} ${p === 1 ? 'Punkt' : 'Punkte'}`,
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
  confirmSkipRound: {
    title: 'Runde ersetzen?',
    text: 'Es beginnt eine neue Runde. Diese zählt nicht.',
    confirmLabel: 'Ersetzen',
  },
  abort: 'Spiel abbrechen',
  confirmAbort: {
    title: 'Spiel abbrechen?',
    text: 'Alle kehren zur Lobby zurück. Die Punkte gehen verloren.',
    confirmLabel: 'Spiel abbrechen',
  },

  unknownPlayer: 'Ehemalige Person',
}
