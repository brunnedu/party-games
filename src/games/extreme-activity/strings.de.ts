// UI text of Extreme Activity. Swiss spelling: "ss" instead of the sharp s.
const words = (n: number) => `${n} ${n === 1 ? 'Wort' : 'Wörter'}`

export const s = {
  name: 'Extreme Activity',
  description:
    'Zwei Teams, eigene Wörter und ein Handy, das reihum geht: erklären, ein Wort, Pantomime, Standbild, Geräusch.',
  playersLabel: 'ab 4 Personen',

  teams: ['Team Rot', 'Team Blau'] as const,

  /** Index 0 is mode 1. */
  modes: [
    {
      name: 'Erklären',
      rule: 'Erkläre das Wort, ohne es oder Teile davon zu sagen. Auch keine verwandten Wörter oder Übersetzungen.',
    },
    { name: 'Ein Wort', rule: 'Sag nur ein einziges Wort. Keine Gesten.' },
    { name: 'Pantomime', rule: 'Spiel es vor. Keine Geräusche und nicht auf Dinge zeigen.' },
    {
      name: 'Standbild',
      rule: 'Eine einzige Pose, die du nicht mehr bewegst oder änderst. Keine Geräusche.',
    },
    { name: 'Geräusch', rule: 'Nur Geräusche, keine Wörter und Gesten. Summen ist erlaubt.' },
  ],
  phaseOf: (mode: number) => `Phase ${mode} von 5`,
  unlimited: 'Raten dürft ihr beliebig oft.',

  settingsTitle: 'Einstellungen',
  gamePhone: 'Spielhandy',
  gamePhoneHelp:
    'Dieses Handy geht beim Spielen reihum und zeigt die Wörter. Alle sitzen abwechselnd: Rot, Blau, Rot, Blau …',
  gamePhoneIs: (name: string) => `Spielhandy: ${name}`,
  gamePhoneYours: 'Dein Handy ist das Spielhandy.',
  maxWords: 'Höchstens so viele Wörter pro Person',

  writeTitle: 'Deine Wörter',
  writeTitleFor: 'Nächste Person',
  writeHelp: (max: number) =>
    `${max === 1 ? '1 Wort' : `1 bis ${max} Wörter`}, auch Namen oder kurze Begriffe. Niemand sieht sie, und nach dem Speichern kannst du sie nicht mehr ändern.`,
  yourName: 'Dein Name',
  wordLabel: (n: number) => `Wort ${n}`,
  optional: 'freiwillig',
  save: 'Speichern',
  cancel: 'Abbrechen',
  saved: 'Gespeichert!',
  nextPerson: 'Nächste Person an diesem Handy',
  total: (n: number, people: number) =>
    `${words(n)} von ${people} ${people === 1 ? 'Person' : 'Personen'}`,
  target: 'Ideal sind etwa 20–30 Wörter.',
  writerCount: (name: string, n: number) => `${name} (${n})`,
  missing: (names: string) => `Noch ohne Wörter: ${names}`,
  startPlaying: 'Alle fertig, losspielen',
  confirmPlay: (n: number, missing: string) => ({
    title: `Mit ${n === 1 ? '1 Wort' : `${n} Wörtern`} losspielen?`,
    text:
      'Danach kann niemand mehr Wörter eingeben.' +
      (missing ? ` Noch ohne Wörter: ${missing}.` : '') +
      ' Auch an geteilten Handys sollten alle fertig sein.',
    confirmLabel: 'Losspielen',
  }),
  waitingForPlay: 'Der Host startet, wenn alle fertig sind.',

  passFirst: 'Gebt das Handy an jemanden von',
  passNext: 'Gib das Handy an die nächste Person von',
  start: 'Start',
  score: (red: number, blue: number) => `Rot ${red} · Blau ${blue}`,
  inBucket: (n: number) => `${n} im Topf`,
  guessed: 'Erraten',
  pause: 'Pause',
  paused: 'Pause',
  resume: 'Weiter',
  timeLeft: (time: string) => `Noch ${time}`,
  modeDone: 'Phase geschafft!',
  nextMode: 'Jetzt:',
  allBack: 'Alle Wörter sind wieder im Topf.',
  undoLast: 'Zurück: letztes Wort war nicht erraten',

  timeUp: 'Zeit ist um!',
  allDone: 'Alle Wörter geschafft!',
  summaryHelp: 'Falsch getippt? Antippen zum Ändern.',
  counted: 'erraten',
  notCounted: 'doch erraten?',
  turnPoints: (n: number, team: string) => `+${n} für ${team}`,
  continuesWith: (mode: string) => `Weiter geht es mit: ${mode}`,
  passOn: 'Weitergeben',
  toResult: 'Zum Ergebnis',

  turnOf: (team: string) => `${team} ist dran`,
  states: {
    ready: 'Das Handy wird weitergegeben.',
    playing: 'Die Zeit läuft.',
    paused: 'Pause.',
    new_mode: 'Neue Phase, gleich geht es weiter.',
    summary: 'Runde wird abgeschlossen.',
  },
  turnPointsSoFar: (n: number) => `Diese Runde: ${n} erraten`,
  scoreTitle: 'Punktestand',
  total_: 'Total',

  gameOver: 'Spielende',
  winner: (team: string) => `${team} gewinnt!`,
  tie: 'Unentschieden!',
  allWords: 'Alle Wörter',
  playAgain: 'Nochmal spielen',
  waitingForRematch: 'Der Host kann ein neues Spiel starten.',

  hostTools: 'Host-Werkzeuge',
  changePhoneHelp: 'Beim Wechsel wird eine laufende Zeit pausiert.',
  abort: 'Spiel abbrechen',
  confirmAbort: {
    title: 'Spiel abbrechen?',
    text: 'Alle kehren zur Lobby zurück. Alle Wörter und Punkte gehen verloren.',
    confirmLabel: 'Spiel abbrechen',
  },
}
