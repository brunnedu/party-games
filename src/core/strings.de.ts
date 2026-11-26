// All shared UI text. Swiss spelling: "ss" instead of the sharp s.
export const t = {
  appName: 'Party Games',
  tagline: 'Spielt zusammen, jeder mit dem eigenen Handy.',
  players: (min: number, max: number) => `${min}–${max} Personen`,
  loading: 'Laden …',
  back: 'Zur Übersicht',
  moreGames: 'Weitere Spiele folgen',

  createGame: 'Spiel erstellen',
  joinGame: 'Spiel beitreten',
  yourName: 'Dein Name',
  roomCode: 'Raumcode',
  join: 'Beitreten',
  rejoin: (code: string) => `Zurück in Raum ${code}`,
  joinRoomTitle: (code: string) => `Raum ${code} beitreten`,

  scanOrEnter: 'QR-Code scannen oder Raumcode eingeben',
  copyLink: 'Link kopieren',
  copied: 'Link kopiert!',
  playersInRoom: (n: number) => `Im Raum (${n})`,
  you: 'du',
  host: 'Host',
  offline: 'offline',
  kick: 'Entfernen',
  confirmKick: (name: string) => `${name} wirklich aus dem Raum entfernen?`,
  startGame: 'Spiel starten',
  needPlayers: (n: number) => `Noch ${n} ${n === 1 ? 'Person' : 'Personen'} nötig`,
  waitingForHost: 'Warte, bis der Host das Spiel startet …',
  leave: 'Raum verlassen',
  confirmLeave: 'Raum wirklich verlassen?',
  confirmLeaveRunning:
    'Raum wirklich verlassen? Während eines laufenden Spiels kannst du nicht wieder einsteigen.',
  hostOffline: (name: string) => `${name} (Host) ist offline.`,
  claimHost: 'Host übernehmen',

  notInRoom: 'Du bist nicht mehr in diesem Raum.',

  setupMissing:
    'Supabase ist noch nicht eingerichtet. Lege eine Datei .env an (Vorlage: .env.example) und starte den Server neu.',

  errors: {
    room_not_found: 'Diesen Raum gibt es nicht.',
    room_full: 'Der Raum ist voll.',
    game_running: 'Das Spiel läuft schon. Versuche es später nochmal.',
    invalid_vote: 'Für diese Person kannst du nicht stimmen.',
    no_votes_yet: 'Es gibt noch keine Stimme.',
    dial_moved: 'Der Zeiger wurde gerade bewegt. Prüfe die Position nochmal.',
    no_guesses_yet: 'Es gibt noch keinen Tipp.',
    clue_too_long: 'Der Hinweis darf höchstens 40 Zeichen lang sein.',
    name_taken: 'Dieser Name ist im Raum schon vergeben.',
    invalid_name: 'Bitte gib einen Namen mit 1 bis 20 Zeichen ein.',
    kicked: 'Du wurdest aus diesem Raum entfernt.',
    not_in_room: 'Du bist nicht in diesem Raum.',
    not_host: 'Das darf nur der Host.',
    host_still_here: 'Der Host ist noch da. Versuche es gleich nochmal.',
    not_enough_players: 'Es braucht mehr Mitspielende.',
    too_many_rooms: 'Zu viele neue Räume. Versuche es später nochmal.',
    wrong_phase: 'Das Spiel ist schon weiter.',
    wrong_role: 'Das darfst du gerade nicht.',
    invalid_clue: 'Der Hinweis muss 1 bis 30 Zeichen lang sein.',
    invalid_guess: 'Die Antwort muss 1 bis 40 Zeichen lang sein.',
    no_clues_yet: 'Es gibt noch keinen Hinweis.',
    players_still_here:
      'Das geht erst, wenn die fehlenden Personen offline sind (und du selbst alles erledigt hast).',
    unknown: 'Etwas ist schiefgelaufen. Prüfe deine Verbindung und versuche es nochmal.',
  },
}

export type ErrorCode = keyof typeof t.errors
