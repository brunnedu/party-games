import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { decodoWordsSql } from '../../scripts/words-sql'
import { WORDS_DE } from '../../src/games/decodo/words.de'
import { createDatabase, createRoom, type TestDb } from './harness'

let t: TestDb
beforeAll(async () => {
  t = await createDatabase()
}, 60_000)

const RED = 0
const BLUE = 1

let unique = 0
const clues = () => [1, 2, 3].map(() => `Hinweis ${++unique}`)

/** users 0 and 2 are Rot, 1 and 3 are Blau (with 4 players). */
async function startGame(n = 4) {
  const room = await createRoom(t, n, 'decodo')
  const { users, roomId } = room
  const host = users[0]!
  for (const [i, user] of users.entries()) {
    await t.call(host, 'decodo_set_team', roomId, user, i % 2)
  }
  await t.call(host, 'decodo_start', roomId)

  const snap = (user: string = host) => t.call(user, 'decodo_snapshot', roomId)
  const state = async () => (await snap()).game
  const act = async (user: string, fn: string, ...args: unknown[]) =>
    t.call(user, `decodo_${fn}`, roomId, (await state()).step, ...args)

  const team = async (id: number): Promise<string[]> =>
    (await state())[id === RED ? 'red_ids' : 'blue_ids']
  const encryptor = async (id: number): Promise<string> =>
    (await state())[id === RED ? 'red_encryptor' : 'blue_encryptor']
  /** A member of the team other than its clue-giver. */
  const mate = async (id: number) => {
    const giver = await encryptor(id)
    return (await team(id)).find((p) => p !== giver)!
  }
  const codeOf = async (id: number): Promise<number[]> => (await snap(await encryptor(id))).code
  /** A guess that is certainly not the code. */
  const wrong = (c: number[]) => [c[1]!, c[0]!, c[2]!]

  const writeBoth = async () => {
    for (const id of [RED, BLUE]) {
      if ((await state()).phase !== 'writing') return
      await act(await encryptor(id), 'submit', clues())
    }
  }
  const guess = async (user: string, digits: number[]) => {
    for (let i = 0; i < 3; i++) await act(user, 'pick', i + 1, digits[i])
    await act(user, 'lock', digits)
  }
  /**
   * Plays the guessing for the team whose turn it is, then stays on the reveal.
   * `own`: whether the team decodes its own code; `intercept`: whether the other
   * team gets it.
   */
  const playTurn = async (own = true, intercept = false) => {
    const { turn, round_no } = await state()
    const c = await codeOf(turn)
    await guess(await mate(turn), own ? c : wrong(c))
    if (round_no > 1) {
      const other = (await team(1 - turn))[0]!
      await guess(other, intercept ? c : wrong(c))
    }
  }
  const next = async () => act(host, 'next')
  /** One full round. Each entry is [decodes own code, gets intercepted]. */
  const playRound = async (
    red: [boolean, boolean] = [true, false],
    blue: [boolean, boolean] = [true, false],
  ) => {
    await writeBoth()
    await playTurn(...red)
    await next()
    await playTurn(...blue)
    await next()
  }
  const goOffline = (ids: string[]) =>
    t.db.query(
      `update private.heartbeats set last_seen = now() - interval '2 minutes'
       where room_id = $1 and user_id = any($2)`,
      [roomId, ids],
    )
  return {
    ...room, host, snap, state, act, team, encryptor, mate, codeOf, wrong, writeBoth, guess,
    playTurn, playRound, next, goOffline,
  }
}

describe('words', () => {
  it('are 400 different German words in Swiss spelling', () => {
    expect(WORDS_DE).toHaveLength(400)
    expect(new Set(WORDS_DE.map((w) => w.toLowerCase())).size).toBe(400)
    expect(WORDS_DE.join(' ')).not.toContain('ß')
  })

  it('have a migration matching the source file', () => {
    const dir = new URL('../migrations/', import.meta.url)
    const latest = readdirSync(dir).filter((f) => f.endsWith('_decodo_words.sql')).sort().at(-1)!
    expect(readFileSync(new URL(latest, dir), 'utf8').replaceAll('\r', '')).toBe(decodoWordsSql())
  })
})

describe('lobby', () => {
  async function teams(roomId: string) {
    const { rows } = await t.db.query<{ team: number; n: number }>(
      `select team, count(*)::int as n from public.decodo_members
       where room_id = $1 group by team order by team`,
      [roomId],
    )
    return rows.map((r) => r.n)
  }

  it('splits newcomers into teams of equal size, or off by one', async () => {
    for (const n of [4, 5, 8]) {
      const room = await createRoom(t, n, 'decodo')
      const sizes = await teams(room.roomId)
      expect(sizes[0]! + sizes[1]!).toBe(n)
      expect(Math.abs(sizes[0]! - sizes[1]!)).toBeLessThanOrEqual(1)
    }
    const full = await createRoom(t, 8, 'decodo')
    await expect(t.call(randomUUID(), 'join_room', full.code, 'Neun')).rejects.toThrow('room_full')
  })

  it('lets only the host move people or shuffle', async () => {
    const { users, roomId } = await createRoom(t, 5, 'decodo')
    await expect(t.call(users[1]!, 'decodo_set_team', roomId, users[1], 0)).rejects.toThrow(
      'not_host',
    )
    await expect(t.call(users[1]!, 'decodo_shuffle_teams', roomId)).rejects.toThrow('not_host')
    await expect(t.call(users[0]!, 'decodo_set_team', roomId, users[1], 2)).rejects.toThrow(
      'invalid_action',
    )
    await t.call(users[0]!, 'decodo_shuffle_teams', roomId)
    expect((await teams(roomId)).sort()).toEqual([2, 3])
    // Everyone in the room may see the teams, nobody else.
    const seen = await t.call(users[1]!, 'decodo_lobby', roomId)
    expect(Object.keys(seen).sort()).toEqual([...users].sort())
    expect(await t.call(randomUUID(), 'decodo_lobby', roomId)).toEqual({})
  })

  it('starts only with four or more people in fair teams', async () => {
    const three = await createRoom(t, 3, 'decodo')
    await expect(t.call(three.users[0]!, 'decodo_start', three.roomId)).rejects.toThrow(
      'not_enough_players',
    )
    const { users, roomId } = await createRoom(t, 6, 'decodo')
    for (const [i, user] of users.entries()) {
      await t.call(users[0]!, 'decodo_set_team', roomId, user, i < 4 ? 0 : 1)
    }
    await expect(t.call(users[0]!, 'decodo_start', roomId)).rejects.toThrow('uneven_teams')
  })

  it('does not let anyone join a running game', async () => {
    const g = await startGame()
    await expect(t.call(randomUUID(), 'join_room', g.code, 'Spät')).rejects.toThrow('game_running')
  })
})

describe('secrets', () => {
  it('shows each team only its own four words', async () => {
    const g = await startGame()
    const words: string[][] = []
    for (const user of g.users) words.push((await g.snap(user)).words)
    expect(words[0]).toHaveLength(4)
    expect(words[2]).toEqual(words[0])
    expect(words[3]).toEqual(words[1])
    expect(new Set([...words[0]!, ...words[1]!]).size).toBe(8)
    for (const user of g.users) {
      expect(await t.as(user, 'select * from public.decodo_keywords')).toHaveLength(1)
    }
    expect((await g.state()).final_words).toBeNull()
  })

  it('shows a code and unrevealed clues only to the clue-giver', async () => {
    const g = await startGame()
    for (const id of [RED, BLUE]) {
      const c = await g.codeOf(id)
      expect(new Set(c).size).toBe(3)
      for (const digit of c) expect([1, 2, 3, 4]).toContain(digit)
      expect((await g.snap(await g.mate(id))).code).toBeNull()
    }
    const giver = await g.encryptor(RED)
    await g.act(giver, 'submit', ['Alpha', 'Beta', 'Gamma'])
    expect((await g.snap(giver)).pending).toEqual(['Alpha', 'Beta', 'Gamma'])
    for (const user of g.users.filter((u) => u !== giver)) {
      expect(JSON.stringify(await g.snap(user))).not.toContain('Alpha')
    }
    expect((await g.snap()).history).toEqual([])
  })

  it('shows Blau’s clues only when it is Blau’s turn', async () => {
    const g = await startGame()
    await g.act(await g.encryptor(RED), 'submit', ['R1', 'R2', 'R3'])
    await g.act(await g.encryptor(BLUE), 'submit', ['B1', 'B2', 'B3'])
    expect((await g.snap()).history.map((h: any) => h.team)).toEqual([RED])
    expect(JSON.stringify(await g.snap(await g.mate(RED)))).not.toContain('B1')
    await g.playTurn()
    await g.next()
    expect(await g.state()).toMatchObject({ phase: 'guessing', turn: BLUE })
    expect((await g.snap()).history.map((h: any) => h.team)).toEqual([RED, BLUE])
  })

  it('keeps each guess within its team, without the clue-giver', async () => {
    const g = await startGame()
    await g.playRound()
    await g.writeBoth()
    const redMate = await g.mate(RED)
    await g.act(redMate, 'pick', 1, 3)
    expect((await g.snap(redMate)).guess).toEqual([3, 0, 0])
    // The clue-giver must not even see it.
    expect((await g.snap(await g.encryptor(RED))).guess).toBeNull()
    for (const blue of await g.team(BLUE)) {
      expect((await g.snap(blue)).guess).toEqual([0, 0, 0])
    }
    expect((await g.state()).locked).toEqual([false, false])
  })
})

describe('clues', () => {
  it('must be three different ones, not own keywords and not used before', async () => {
    const g = await startGame()
    const giver = await g.encryptor(RED)
    const [own] = (await g.snap(giver)).words as string[]
    const theirs = (await g.snap(await g.encryptor(BLUE))).words[0] as string
    const submit = (c: string[]) => g.act(giver, 'submit', c)
    await expect(submit(['a', 'b'])).rejects.toThrow('invalid_action')
    await expect(submit(['a', ' ', 'c'])).rejects.toThrow('decodo_invalid_clue')
    await expect(submit(['a', 'x'.repeat(61), 'c'])).rejects.toThrow('decodo_invalid_clue')
    await expect(submit(['Quarkhaus', ' quark-haus! ', 'c'])).rejects.toThrow('repeated_clue')
    await expect(submit([`${own!.toUpperCase()}!`, 'b', 'c'])).rejects.toThrow('clue_is_keyword')
    // The other team's words aren't checked: that would give them away.
    await submit([theirs, 'Beta', 'Gamma'])
    await expect(g.act(await g.mate(RED), 'submit', clues())).rejects.toThrow('wrong_role')
  })

  it('can change until both are in, and not repeat in a later round', async () => {
    const g = await startGame()
    const giver = await g.encryptor(RED)
    await g.act(giver, 'submit', ['Alt', 'Beta', 'Gamma'])
    await g.act(giver, 'submit', ['Neu', 'Beta', 'Gamma'])
    await g.act(await g.encryptor(BLUE), 'submit', ['Neu', 'x', 'y'])
    expect((await g.snap()).history[0].clues).toEqual(['Neu', 'Beta', 'Gamma'])
    await g.playTurn()
    await g.next()
    await g.playTurn()
    await g.next()
    await expect(g.act(await g.encryptor(RED), 'submit', ['a', 'NEU', 'b'])).rejects.toThrow(
      'repeated_clue',
    )
    // Only used by this team, never submitted: free to use.
    await g.act(await g.encryptor(RED), 'submit', ['Alt', 'x', 'y'])
  })

  it('starts a 30 second timer with the first set', async () => {
    const g = await startGame()
    expect((await g.snap()).timer_left).toBeNull()
    await g.act(await g.encryptor(RED), 'submit', clues())
    expect((await g.snap()).timer_left).toBeGreaterThan(28)
    await t.db.query(
      `update public.decodo_games set timer_started_at = timer_started_at - interval '1 minute'
       where room_id = $1`,
      [g.roomId],
    )
    expect((await g.snap()).timer_left).toBe(0)
    // Nobody is cut off.
    await g.act(await g.encryptor(BLUE), 'submit', clues())
    expect((await g.state()).phase).toBe('guessing')
  })
})

describe('guessing and tokens', () => {
  it('has no interception in the first round', async () => {
    const g = await startGame()
    await g.writeBoth()
    const blue = await g.mate(BLUE)
    await expect(g.act(blue, 'pick', 1, 1)).rejects.toThrow('wrong_role')
    await expect(g.act(await g.encryptor(RED), 'pick', 1, 1)).rejects.toThrow('wrong_role')
    await g.playTurn()
    expect(await g.state()).toMatchObject({
      phase: 'reveal', misses: [0, 0], interceptions: [0, 0],
    })
  })

  it('moves a number instead of using it twice, and locks only what is seen', async () => {
    const g = await startGame()
    await g.writeBoth()
    const user = await g.mate(RED)
    await g.act(user, 'pick', 1, 2)
    await g.act(user, 'pick', 3, 2)
    expect((await g.snap(user)).guess).toEqual([0, 0, 2])
    await expect(g.act(user, 'lock', [0, 0, 2])).rejects.toThrow('guess_incomplete')
    await g.act(user, 'pick', 1, 1)
    await g.act(user, 'pick', 2, 3)
    await expect(g.act(user, 'lock', [1, 3, 4])).rejects.toThrow('guess_changed')
    await expect(g.act(user, 'pick', 4, 1)).rejects.toThrow('invalid_action')
    await expect(g.act(user, 'pick', 1, 5)).rejects.toThrow('invalid_action')
  })

  it('reveals only when both teams have locked, and gives the tokens', async () => {
    const g = await startGame()
    await g.playRound()
    await g.writeBoth()
    const c = await g.codeOf(RED)
    const redMate = await g.mate(RED)
    await g.guess(redMate, g.wrong(c))
    expect((await g.state()).phase).toBe('guessing')
    await expect(g.act(redMate, 'pick', 1, 1)).rejects.toThrow('guess_locked')
    // Blau's clue-giver may help intercept.
    await g.guess(await g.encryptor(BLUE), c)
    expect(await g.state()).toMatchObject({
      phase: 'reveal', misses: [1, 0], interceptions: [0, 1],
    })
    expect((await g.snap(await g.mate(BLUE))).history.at(-1)).toMatchObject({
      team: RED, code: c, own_guess: g.wrong(c), other_guess: c,
    })
  })

  it('lets the host or that turn’s clue-giver move on', async () => {
    const g = await startGame()
    await g.writeBoth()
    await g.playTurn()
    const giver = await g.encryptor(RED)
    const outsider = g.users.find((u) => u !== g.host && u !== giver)!
    await expect(g.act(outsider, 'next')).rejects.toThrow('not_host')
    await g.act(giver, 'next')
    expect((await g.state()).turn).toBe(BLUE)
  })

  it('passes the clue-giver role around each team', async () => {
    const g = await startGame()
    const first = [await g.encryptor(RED), await g.encryptor(BLUE)]
    await g.playRound()
    expect((await g.state()).round_no).toBe(2)
    expect(await g.encryptor(RED)).not.toBe(first[RED])
    expect(await g.encryptor(BLUE)).not.toBe(first[BLUE])
    await g.playRound()
    expect([await g.encryptor(RED), await g.encryptor(BLUE)]).toEqual(first)
  })
})

describe('end of the game', () => {
  it('is won with two interceptions, after both codes of the round', async () => {
    const g = await startGame()
    await g.playRound()
    await g.playRound([true, true])
    await g.writeBoth()
    await g.playTurn(true, true)
    await g.next()
    // Rot's second code was intercepted, but the round goes on.
    expect(await g.state()).toMatchObject({ phase: 'guessing', turn: BLUE })
    await g.playTurn()
    await g.next()
    expect(await g.state()).toMatchObject({
      phase: 'game_over', outcome: { winner: BLUE, reason: 'interceptions' },
    })
    expect((await g.state()).final_words).toHaveLength(2)
    expect((await t.call(g.host, 'room_snapshot', g.code)).room.status).toBe('finished')
  })

  it('is lost with two miscommunications', async () => {
    const g = await startGame()
    await g.playRound([false, false])
    await g.playRound([false, false])
    expect(await g.state()).toMatchObject({
      phase: 'game_over', outcome: { winner: BLUE, reason: 'misses' },
    })
  })

  it('counts points if a team wins and loses at once', async () => {
    const g = await startGame()
    // Rot: 2 misses. Then Rot also intercepts Blau twice.
    await g.playRound([false, false])
    await g.playRound([true, false], [true, true])
    // Blau misses once too, so that the points differ.
    await g.playRound([false, false], [false, true])
    // Rot: 2 - 2 = 0. Blau: 0 - 1 = -1.
    expect(await g.state()).toMatchObject({
      interceptions: [2, 0], misses: [2, 1],
      phase: 'game_over', outcome: { winner: RED, reason: 'points' },
    })
  })

  async function tie() {
    const g = await startGame()
    // Both get their second miscommunication in the same round.
    await g.playRound([false, false], [false, false])
    await g.playRound([false, false], [false, false])
    expect((await g.state()).phase).toBe('tiebreak')
    return g
  }

  it('has each team guess the other’s words if the points are equal', async () => {
    const g = await tie()
    const [red, blue] = [(await g.team(RED))[0]!, (await g.team(BLUE))[0]!]
    const redWords = (await g.snap(red)).words as string[]
    await expect(g.act(red, 'tiebreak_guess', ['a', 'A!', 'b', 'c'])).rejects.toThrow(
      'repeated_word',
    )
    await expect(g.act(red, 'tiebreak_guess', ['a', '', 'b', 'c'])).rejects.toThrow(
      'decodo_invalid_word',
    )
    await g.act(red, 'tiebreak_guess', ['Geheim', 'b', 'c', 'd'])
    expect(JSON.stringify(await g.snap(blue))).not.toContain('Geheim')
    await g.act(blue, 'tiebreak_guess', redWords)
    expect((await g.state()).phase).toBe('judging')
    expect((await g.snap(blue)).tiebreak).toHaveLength(2)
    expect((await g.state()).final_words[RED]).toEqual(redWords)
    // Rot judges Blau's guesses, once.
    await g.act(red, 'judge', [true, true, true, true])
    await expect(g.act((await g.team(RED))[1]!, 'judge', [false, false, false, false]))
      .rejects.toThrow('wrong_phase')
    await g.act(blue, 'judge', [true, false, false, false])
    expect(await g.state()).toMatchObject({
      phase: 'game_over', outcome: { winner: BLUE, reason: 'words' },
    })
  })

  it('is shared if the words are tied too', async () => {
    const g = await tie()
    const [red, blue] = [(await g.team(RED))[0]!, (await g.team(BLUE))[0]!]
    await g.act(red, 'tiebreak_guess', ['a', 'b', 'c', 'd'])
    await g.act(blue, 'tiebreak_guess', ['a', 'b', 'c', 'd'])
    await g.act(red, 'judge', [false, true, false, false])
    await g.act(blue, 'judge', [true, false, false, false])
    expect((await g.state()).outcome).toEqual({ winner: null, reason: 'words' })
  })

  it('ends after round 8, decided by points', async () => {
    const g = await startGame()
    // One interception for Blau in round 2, then nothing happens.
    await g.playRound()
    await g.playRound([true, true])
    for (let round = 3; round <= 8; round++) {
      expect((await g.state()).round_no).toBe(round)
      await g.playRound()
    }
    expect((await g.state()).outcome).toEqual({ winner: BLUE, reason: 'points' })
  })

  it('deals eight new words in the next game of the room', async () => {
    const g = await startGame()
    const before = (await g.snap()).words as string[]
    await t.call(g.host, 'return_to_lobby', g.roomId)
    await t.call(g.host, 'decodo_start', g.roomId)
    expect((await g.snap()).words.filter((w: string) => before.includes(w))).toEqual([])
    expect((await g.snap()).history).toEqual([])
    const { rows } = await t.db.query<{ n: number }>(
      'select count(*)::int as n from private.decodo_used_words where room_id = $1',
      [g.roomId],
    )
    expect(rows[0]!.n).toBe(16)
  })
})

describe('people going offline or leaving', () => {
  /** A 6-player game in which neither Red clue-giver is the host. */
  async function bigGame() {
    const g = await startGame(6)
    if ((await g.encryptor(RED)) === g.host) {
      await t.db.query(
        `update public.decodo_games set red_encryptor = red_ids[2] where room_id = $1`,
        [g.roomId],
      )
    }
    return g
  }

  it('replaces an offline clue-giver with a new code, keeping the other clues', async () => {
    const g = await bigGame()
    const gone = await g.encryptor(RED)
    const blueGiver = await g.encryptor(BLUE)
    await g.act(blueGiver, 'submit', ['x', 'y', 'z'])
    const step = (await g.state()).step
    await expect(g.act(g.host, 'replace_encryptor', RED)).rejects.toThrow('players_still_here')
    await g.goOffline([gone])
    await expect(g.act(blueGiver === g.host ? gone : blueGiver, 'replace_encryptor', RED))
      .rejects.toThrow('not_host')
    await g.act(g.host, 'replace_encryptor', RED)
    const now = await g.encryptor(RED)
    expect(now).not.toBe(gone)
    expect(await g.team(RED)).toContain(now)
    expect((await g.snap(now)).code).toHaveLength(3)
    expect((await g.snap(gone)).code).toBeNull()
    // No new screen, so Blau's clue-giver keeps what they are doing.
    expect((await g.state()).step).toBe(step)
    expect((await g.snap(blueGiver)).pending).toEqual(['x', 'y', 'z'])
    expect((await g.snap()).timer_left).toBeGreaterThan(28)
  })

  it('has a replaced Blau clue-giver write again after Rot’s turn', async () => {
    const g = await startGame(6)
    await g.writeBoth()
    const gone = await g.encryptor(BLUE)
    const host = gone === g.host ? null : g.host
    if (!host) await t.db.query('update public.rooms set host_id = $2 where id = $1', [
      g.roomId, (await g.team(RED))[0],
    ])
    const boss = host ?? (await g.team(RED))[0]!
    await g.goOffline([gone])
    await g.act(boss, 'replace_encryptor', BLUE)
    await expect(g.act(boss, 'replace_encryptor', RED)).rejects.toThrow('invalid_action')
    await g.playTurn()
    await g.act(boss, 'next')
    expect(await g.state()).toMatchObject({
      phase: 'writing', turn: BLUE, red_submitted: true, blue_submitted: false,
    })
    // No leftover timer.
    expect((await g.snap()).timer_left).toBeNull()
    await expect(g.act(await g.encryptor(RED), 'submit', clues())).rejects.toThrow('wrong_role')
    await g.act(await g.encryptor(BLUE), 'submit', clues())
    expect((await g.state()).phase).toBe('guessing')
  })

  it('goes on without a guess only if nobody who may make it is online', async () => {
    const g = await startGame()
    await g.writeBoth()
    const guesser = await g.mate(RED)
    if (guesser === g.host) {
      await t.db.query('update public.rooms set host_id = $2 where id = $1', [
        g.roomId, await g.encryptor(RED),
      ])
    }
    const boss = guesser === g.host ? await g.encryptor(RED) : g.host
    await expect(g.act(boss, 'skip_guess', BLUE)).rejects.toThrow('invalid_action')
    await expect(g.act(boss, 'skip_guess', RED)).rejects.toThrow('players_still_here')
    await g.goOffline([guesser])
    await g.act(boss, 'skip_guess', RED)
    expect(await g.state()).toMatchObject({ phase: 'reveal', misses: [1, 0] })
    expect((await g.snap()).history[0].own_guess).toBeNull()
  })

  it('replaces a clue-giver who leaves before the reveal', async () => {
    const g = await startGame(6)
    const gone = await g.encryptor(RED)
    await g.act(gone, 'submit', ['Weg', 'b', 'c'])
    await t.call(gone, 'leave_room', g.roomId)
    const host = (await t.db.query<{ host_id: string }>(
      'select host_id from public.rooms where id = $1', [g.roomId],
    )).rows[0]!.host_id
    const viewer = await t.call(host, 'decodo_snapshot', g.roomId)
    expect(viewer.game.red_ids).not.toContain(gone)
    expect(viewer.game.red_encryptor).not.toBe(gone)
    expect(viewer.game.red_submitted).toBe(false)
    expect((await t.call(viewer.game.red_encryptor, 'decodo_snapshot', g.roomId)).pending).toBeNull()
  })

  it('keeps the revealed clues and code, and the turn order, when a clue-giver leaves', async () => {
    const g = await startGame(6)
    await g.writeBoth()
    const order = await g.team(RED)
    const gone = await g.encryptor(RED)
    const next = order[(order.indexOf(gone) + 1) % order.length]
    const code = await g.codeOf(RED)
    await t.call(gone, 'leave_room', g.roomId)
    const host = (await t.db.query<{ host_id: string }>(
      'select host_id from public.rooms where id = $1', [g.roomId],
    )).rows[0]!.host_id
    const as = async (user: string, fn: string, ...args: unknown[]) => {
      const snapshot = await t.call(host, 'decodo_snapshot', g.roomId)
      return t.call(user, `decodo_${fn}`, g.roomId, snapshot.game.step, ...args)
    }
    const read = async () => t.call(host, 'decodo_snapshot', g.roomId)
    const guesser = (await read()).game.red_ids[0] as string
    for (let i = 0; i < 3; i++) await as(guesser, 'pick', i + 1, code[i])
    await as(guesser, 'lock', code)
    expect((await read()).game).toMatchObject({ phase: 'reveal', misses: [0, 0] })
    await as(host, 'next')
    const blue = (await read()).game
    const blueMate = blue.blue_ids.find((p: string) => p !== blue.blue_encryptor)
    for (let i = 0; i < 3; i++) await as(blueMate, 'pick', i + 1, i + 1)
    await as(blueMate, 'lock', [1, 2, 3])
    await as(host, 'next')
    expect((await read()).game).toMatchObject({ round_no: 2, red_encryptor: next })
  })

  it('ends without a winner when a team drops below two', async () => {
    const g = await startGame()
    const gone = (await g.team(BLUE)).find((p) => p !== g.host)!
    await t.call(gone, 'leave_room', g.roomId)
    expect(await g.state()).toMatchObject({
      phase: 'game_over', outcome: { winner: null, reason: 'left' },
    })
  })

  it('does not get in the way of leaving a lobby', async () => {
    const { users, roomId } = await createRoom(t, 4, 'decodo')
    await t.call(users[1]!, 'leave_room', roomId)
    const { rows } = await t.db.query('select 1 from public.decodo_members where room_id = $1', [
      roomId,
    ])
    expect(rows).toHaveLength(3)
  })
})

describe('outsiders', () => {
  it('see nothing and can do nothing', async () => {
    const g = await startGame()
    await g.writeBoth()
    const outsider = randomUUID()
    expect(await t.call(outsider, 'decodo_snapshot', g.roomId)).toBeNull()
    for (const table of [
      'members', 'games', 'keywords', 'codes', 'pending', 'clues', 'guesses', 'tiebreak',
    ]) {
      expect(await t.as(outsider, `select * from public.decodo_${table}`)).toEqual([])
    }
    const { step } = await g.state()
    await expect(t.call(outsider, 'decodo_pick', g.roomId, step, 1, 1)).rejects.toThrow(
      'not_in_room',
    )
    await expect(t.as(g.host, 'select * from private.decodo_words')).rejects.toThrow(
      'permission denied',
    )
  })
})
