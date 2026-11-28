// All Liar's Dice text. Swiss spelling: "ss" instead of the sharp s.
const dice = (n: number) => `${n} Würfel`

export const s = {
  name: "Liar's Dice",
  description:
    'Bluff mit Würfeln: Bietet auf die Würfel aller, auch wenn ihr nur eure eigenen seht.',
  dice,

  startDice: 'Würfel pro Person',

  round: (n: number) => `Runde ${n}`,
  totalDice: (n: number) => `${n} Würfel im Spiel`,
  starts: (name: string) => `${name} beginnt`,
  youStart: 'Du beginnst!',
  bidHelp:
    'Bietet reihum laut, z. B. «mindestens drei Vieren». Jedes Gebot braucht mehr Würfel, oder gleich viele mit höherer Zahl. Einsen zählen nur als Einsen.',

  roll: 'Würfeln',
  rolling: 'Die Würfel rollen …',
  waitingForRolls: (names: string) => `Noch nicht gewürfelt: ${names}`,
  showDice: 'Meine Würfel zeigen',
  hideDice: 'Verstecken',
  hidden: 'Deine Würfel sind versteckt',
  yourDice: (values: string) => `Deine Würfel: ${values}`,

  doubt: 'Anzweifeln!',
  doubtHelp: 'Nur wenn du an der Reihe bist: Du zweifelst das Gebot vor dir an.',
  confirmDoubt: (name: string) => ({
    title: 'Anzweifeln?',
    text: `Du zweifelst an der Aussage von ${name}. Danach werden alle Würfel aufgedeckt.`,
    confirmLabel: 'Anzweifeln',
  }),

  doubts: (doubter: string, accused: string) => `${doubter} zweifelt an ${accused}!`,
  summary: 'Alle Würfel',
  summaryHelp: 'Tippe auf eine Zahl, um die passenden Würfel hervorzuheben.',
  faceCount: (face: number, count: number) => `${count} mal die ${face}`,
  verdictTitle: 'Wer verliert einen Würfel?',
  doubterLoses: 'Die Aussage stimmte: Ich verliere einen Würfel',
  accusedLoses: (name: string) => `Die Aussage war falsch: ${name} verliert einen Würfel`,
  // The same two choices, worded for the host judging for somebody else.
  doubterLosesNamed: (name: string) => `Die Aussage stimmte: ${name} verliert einen Würfel`,
  verdictShown: (loser: string) => `Entscheidung: ${loser} verliert einen Würfel.`,
  verdictPending: (name: string) => `${name} entscheidet …`,
  verdictChangeHint: 'Falsch getippt? Bis zur nächsten Runde kann man es ändern.',
  nextRound: 'Würfel abgeben und weiter',
  finish: 'Zur Rangliste',

  players: 'Reihenfolge',
  out: 'ausgeschieden',
  spectating: 'Du bist ausgeschieden und schaust zu.',

  gameOver: 'Spiel vorbei!',
  winner: (name: string) => `${name} gewinnt!`,
  ranking: 'Rangliste',
  playAgain: 'Zurück zur Lobby',
  waitingForRematch: 'Der Host kann euch zurück in die Lobby bringen.',

  hostTools: 'Host-Optionen',
  reroll: 'Neu würfeln (niemand verliert)',
  confirmReroll: {
    title: 'Neu würfeln?',
    text: 'Diese Runde startet neu. Niemand verliert einen Würfel.',
    confirmLabel: 'Neu würfeln',
  },
  abort: 'Spiel abbrechen',
  confirmAbort: {
    title: 'Spiel abbrechen?',
    text: 'Alle kehren zur Lobby zurück.',
    confirmLabel: 'Spiel abbrechen',
  },

  unknownPlayer: 'Ehemalige Person',
}
