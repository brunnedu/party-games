import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { pointsBreakdown } from '../../src/games/walter/breakdown'
import { createDatabase, createRoom, type TestDb } from './harness'

let t: TestDb
beforeAll(async () => {
  t = await createDatabase()
}, 60_000)

async function startGame(n = 4) {
  const room = await createRoom(t, n, 'walter')
  const { users, roomId } = room
  const host = users[0]!
  await t.call(host, 'walter_start', roomId)

  const snap = (user: string) => t.call(user, 'walter_snapshot', roomId)
  const state = async () => (await snap(host)).game
  const act = async (user: string, fn: string, ...args: unknown[]) =>
    t.call(user, `walter_${fn}`, roomId, (await state()).round_no, ...args)
  const roles = async () => {
    const game = await state()
    const sphinx = game.sphinx_id as string
    return { sphinx, others: (game.player_ids as string[]).filter((p) => p !== sphinx) }
  }
  const choose = async () => {
    const { sphinx } = await roles()
    const options = (await snap(sphinx)).options as string[]
    await act(sphinx, 'choose', options[0])
  }
  /** Chooses a sentence; the Sphinx answers `truth`, the others `fakes` in order. */
  const write = async (truth = 'die Wahrheit', fakes: string[] = []) => {
    await choose()
    const { sphinx, others } = await roles()
    await act(sphinx, 'submit', truth)
    for (const [i, user] of others.entries()) {
      await act(user, 'submit', fakes[i] ?? `Fälschung ${i}`)
    }
  }
  const startReading = async () => act((await roles()).sphinx, 'start_reading')
  const numberOf = async (user: string) => (await snap(user)).own.number as number
  /** Each guesser votes for the answer written by `picks[i]`. */
  const voteFor = async (...picks: string[]) => {
    const { others } = await roles()
    for (const [i, user] of others.entries()) {
      await act(user, 'vote', await numberOf(picks[i]!))
    }
  }
  const revealStep = async () => {
    const game = await state()
    await act(game.sphinx_id, 'reveal_next', game.reveal_step)
  }
  const revealAll = async () => {
    for (;;) {
      const game = await state()
      if (game.reveal_step >= game.reveal_steps) return
      await revealStep()
    }
  }
  const points = async () => (await state()).round_points as Record<string, number>
  const goOffline = (ids: string[]) =>
    t.db.query(
      `update private.heartbeats set last_seen = now() - interval '2 minutes'
       where room_id = $1 and user_id = any($2)`,
      [roomId, ids],
    )
  return {
    ...room, host, snap, state, act, roles, choose, write, startReading, numberOf,
    voteFor, revealStep, revealAll, points, goOffline,
  }
}

async function startGameWhere(hostIsSphinx: boolean, n = 4) {
  let g = await startGame(n)
  while (((await g.roles()).sphinx === g.host) !== hostIsSphinx) g = await startGame(n)
  return g
}

describe('matching answers', () => {
  it('ignores only capitals, punctuation and spaces', async () => {
    const normalize = async (words: string[]) => {
      const { rows } = await t.db.query<{ n: string }>(
        'select private.walter_normalize(w) as n from unnest($1::text[]) w',
        [words],
      )
      return rows.map((r) => r.n)
    }
    const same = await normalize([
      'Klavier spielen', '  klavier   SPIELEN. ', '«Klavier» spielen!', 'Klavier-spielen …',
    ])
    expect(new Set(same).size).toBe(1)
    const different = await normalize(['Klavier', 'Piano', 'schwarzes Klavier', 'Klaviere', 'Klaviar'])
    expect(new Set(different).size).toBe(5)
    expect(new Set(await normalize(['geht’s', "geht's", 'gehts'])).size).toBe(1)
    expect(new Set(await normalize(['Bär', 'Bar'])).size).toBe(2)
    // Swiss spelling has no sharp s, so it counts as "ss".
    expect(new Set(await normalize(['Fussball', 'Fußball', 'FUẞBALL', 'fussball!'])).size).toBe(1)
    expect(new Set(await normalize(['Masse', 'Maße', 'Mase'])).size).toBe(2)
    // An answer of only punctuation stays as it is.
    expect(await normalize(['?!', '...'])).toEqual(['?!', '...'])
  })
})

describe('a round', () => {
  it('gives only the Sphinx three sentences to choose from', async () => {
    const g = await startGame()
    const { sphinx, others } = await g.roles()
    const options = (await g.snap(sphinx)).options as string[]
    expect(new Set(options).size).toBe(3)
    for (const sentence of options) expect(sentence).toContain('WALTER')
    for (const user of others) {
      expect((await g.snap(user)).options).toBeNull()
      expect(await t.as(user, 'select * from walter_choices where room_id = $1', [g.roomId])).toEqual([])
    }
    await expect(g.act(others[0]!, 'choose', options[0])).rejects.toThrow('wrong_role')
    await expect(g.act(sphinx, 'choose', 'Etwas WALTER anderes')).rejects.toThrow('invalid_action')
    await g.act(sphinx, 'choose', options[1])
    expect(await g.state()).toMatchObject({ phase: 'writing', sentence: options[1] })
  })

  it('keeps answers as typed and locks the Sphinx’s answer', async () => {
    const g = await startGame()
    await g.choose()
    const { sphinx, others } = await g.roles()
    await g.act(others[0]!, 'submit', '  ganz  kurz.  ')
    expect((await g.snap(others[0]!)).own.answer).toBe('ganz  kurz.')
    await g.act(others[0]!, 'submit', 'geändert')
    await g.act(sphinx, 'submit', 'wahr')
    await expect(g.act(sphinx, 'submit', 'doch anders')).rejects.toThrow('answer_locked')
    await expect(g.act(others[1]!, 'submit', '   ')).rejects.toThrow('invalid_answer')
    await expect(g.act(others[1]!, 'submit', 'x'.repeat(101))).rejects.toThrow('invalid_answer')
    await expect(g.startReading()).rejects.toThrow('answers_missing')
    await expect(g.act(others[0]!, 'start_reading')).rejects.toThrow('wrong_role')
  })
})

describe('secrets', () => {
  it('shows other answers only to the Sphinx, after their own, without authors', async () => {
    const g = await startGame()
    await g.choose()
    const { sphinx, others } = await g.roles()
    await g.act(others[0]!, 'submit', 'geheim eins')
    // Not before the Sphinx has answered.
    expect((await g.snap(sphinx)).private.sphinx_answers).toBeNull()
    await g.act(sphinx, 'submit', 'die Wahrheit')
    const list = (await g.snap(sphinx)).private.sphinx_answers
    expect(list.map((a: any) => a.answer).sort()).toEqual(['die Wahrheit', 'geheim eins'])
    for (const a of list) expect(Object.keys(a).sort()).toEqual(['answer', 'is_real', 'number'])

    for (const [i, user] of others.slice(1).entries()) await g.act(user, 'submit', `geheim ${i + 2}`)
    const check = async () => {
      for (const user of others) {
        const own = (await g.snap(user)).own.answer
        const everything = JSON.stringify(await g.snap(user))
        for (const text of ['die Wahrheit', 'geheim eins', 'geheim 2', 'geheim 3']) {
          if (text !== own) expect(everything).not.toContain(text)
        }
        for (const table of ['walter_answers', 'walter_votes']) {
          const rows = await t.as<any>(user, `select * from ${table} where room_id = $1`, [g.roomId])
          expect(rows.every((r) => (r.player_id ?? r.voter_id) === user)).toBe(true)
        }
      }
    }
    await check()
    await g.startReading()
    await check()
    // Even the Sphinx can't read the rows with the authors.
    expect(await t.as(sphinx, 'select * from walter_answers where room_id = $1', [g.roomId])).toHaveLength(1)
    await g.voteFor(sphinx, sphinx, sphinx)
    await check() // voting is over, nothing is revealed yet
    expect((await g.snap(g.host)).scores).toEqual({})
    expect((await g.state()).round_points).toBeNull()
  })

  it('blocks writes, outsiders and internals', async () => {
    const g = await startGame()
    const tables = ['games', 'choices', 'answers', 'votes', 'reveals', 'scores', 'history']
    for (const table of tables.map((n) => `walter_${n}`)) {
      expect(await t.as(randomUUID(), `select * from ${table}`)).toEqual([])
      await expect(t.as(g.users[1]!, `delete from ${table}`)).rejects.toThrow(/permission denied/)
    }
    for (const table of ['private.walter_sentences', 'private.walter_plan']) {
      await expect(t.as(g.host, `select * from ${table}`)).rejects.toThrow(/permission denied/)
    }
    await expect(t.as(g.host, 'select private.walter_award($1)', [g.roomId])).rejects.toThrow(
      /permission denied/,
    )
    expect(await t.call(randomUUID(), 'walter_private_view', g.roomId)).toBeNull()
  })
})

describe('numbers and voting', () => {
  it('numbers the answers in the practised order', async () => {
    const g = await startGame(5)
    await g.write()
    const { sphinx, others } = await g.roles()
    await g.act(sphinx, 'shuffle')
    await expect(g.act(others[0]!, 'shuffle')).rejects.toThrow('wrong_role')
    const practised = (await g.snap(sphinx)).private.sphinx_answers.map((a: any) => a.answer)
    await g.startReading()
    const numbered = (await g.snap(sphinx)).private.sphinx_answers
    expect(numbered.map((a: any) => a.number)).toEqual([1, 2, 3, 4, 5])
    expect(numbered.map((a: any) => a.answer)).toEqual(practised)
    await expect(g.act(others[0]!, 'submit', 'zu spät')).rejects.toThrow('wrong_phase')
  })

  it('allows your own number only if somebody wrote the same', async () => {
    const g = await startGame()
    await g.write('Wahrheit', ['Doppelt', 'doppelt!', 'Einzeln'])
    await g.startReading()
    const { sphinx, others } = await g.roles()
    const [a, b, c] = others as [string, string, string]
    expect((await g.snap(a)).private.has_twin).toBe(true)
    expect((await g.snap(c)).private.has_twin).toBe(false)
    await expect(g.act(c, 'vote', await g.numberOf(c))).rejects.toThrow('invalid_vote')
    await expect(g.act(c, 'vote', 5)).rejects.toThrow('invalid_vote')
    await expect(g.act(sphinx, 'vote', 1)).rejects.toThrow('wrong_role')
    await g.act(a, 'vote', await g.numberOf(a))
    await g.act(a, 'vote', await g.numberOf(b)) // changing is allowed
    expect((await g.snap(a)).own_vote).toBe(await g.numberOf(b))
    expect((await g.state()).phase).toBe('voting')
  })
})

describe('scoring', () => {
  it('rewards guessers, forgers and a recognizable Sphinx', async () => {
    const g = await startGame()
    await g.write()
    await g.startReading()
    const { sphinx, others } = await g.roles()
    const [a, b, c] = others as [string, string, string]
    await g.voteFor(sphinx, sphinx, a) // a, b find the truth; c falls for a
    await g.revealAll()
    expect(await g.points()).toEqual({ [a]: 2, [b]: 1, [sphinx]: 2 })
    expect((await g.snap(c)).scores).toEqual({ [a]: 2, [b]: 1, [sphinx]: 2 })
  })

  it('gives matching fakes nothing', async () => {
    const g = await startGame()
    await g.write('Wahrheit', ['Doppelt', 'DOPPELT.', 'Einzeln'])
    await g.startReading()
    const { sphinx, others } = await g.roles()
    const [a, b, c] = others as [string, string, string]
    await g.voteFor(c, a, b) // c's single fake gets one vote; the twins get two
    await g.revealAll()
    expect(await g.points()).toEqual({ [c]: 1 })
    expect(sphinx).toBeTruthy()
  })

  it('counts a copy of the truth as correct, but pays nobody who wrote it', async () => {
    const g = await startGame()
    await g.write('Schoggi', ['schoggi!', 'Käse', 'Brot'])
    await g.startReading()
    const { others } = await g.roles()
    const [a, b, c] = others as [string, string, string]
    // a picks the own copy (allowed), b picks that copy, c picks b's fake.
    await g.voteFor(a, a, b)
    await g.revealAll()
    expect(await g.points()).toEqual({ [a]: 1, [b]: 2 })
    expect(await g.state()).toMatchObject({ sphinx_foul: false })
    expect(c).toBeTruthy()
  })

  it('gives the Sphinx nothing if all guessers find the truth, with 4 or more players', async () => {
    const g = await startGame(4)
    await g.write()
    await g.startReading()
    const { sphinx, others } = await g.roles()
    await g.voteFor(sphinx, sphinx, sphinx)
    await g.revealAll()
    expect(await g.points()).toEqual(Object.fromEntries(others.map((o) => [o, 1])))
    expect(await g.state()).toMatchObject({ sphinx_foul: true })
  })

  it('does not apply that rule with 3 players', async () => {
    const g = await startGame(3)
    await g.write()
    await g.startReading()
    const { sphinx } = await g.roles()
    await g.voteFor(sphinx, sphinx)
    await g.revealAll()
    expect((await g.points())[sphinx]).toBe(2)
    expect(await g.state()).toMatchObject({ sphinx_foul: false })
  })
})

describe('everyone finds the truth, when only some votes are in', () => {
  /** Four players or more; `voters` guessers pick the truth, the rest are offline. */
  async function withVotes(voters: number) {
    const g = await startGameWhere(false, 5)
    await g.write()
    await g.startReading()
    const { sphinx, others } = await g.roles()
    // The host must be among those who voted.
    const order = [g.host, ...others.filter((u) => u !== g.host)]
    for (const u of order.slice(0, voters)) await g.act(u, 'vote', await g.numberOf(sphinx))
    await g.goOffline(order.slice(voters))
    await g.act(g.host, 'force_continue')
    await g.revealAll()
    return { g, sphinx, voted: order.slice(0, voters) }
  }

  it('does not punish the Sphinx for a single vote', async () => {
    const { g, sphinx, voted } = await withVotes(1)
    expect(await g.points()).toEqual({ [voted[0]!]: 1, [sphinx]: 1 })
    expect(await g.state()).toMatchObject({ sphinx_foul: false })
  })

  it('still gives the Sphinx nothing with two correct votes', async () => {
    const { g, voted } = await withVotes(2)
    expect(await g.points()).toEqual(Object.fromEntries(voted.map((u) => [u, 1])))
    expect(await g.state()).toMatchObject({ sphinx_foul: true })
  })
})

describe('the explanation of the points', () => {
  /** What the app would show, added up per person, next to what was awarded. */
  async function compare(g: Awaited<ReturnType<typeof startGame>>) {
    const { game, reveals } = await g.snap(g.host)
    const explained = pointsBreakdown(reveals, game.sphinx_id, game.sphinx_foul)
    const totals = Object.fromEntries(
      Object.entries(explained).map(([id, b]) => [id, b.truth + b.fake + b.sphinx]),
    )
    expect(totals).toEqual(game.round_points)
    return explained
  }

  it('names the source of every point', async () => {
    const g = await startGame(5)
    await g.write()
    await g.startReading()
    const { sphinx, others } = await g.roles()
    const [a, b, c, d] = others as [string, string, string, string]
    await g.voteFor(sphinx, sphinx, a, a) // a, b: truth; c, d: a's fake
    await g.revealAll()
    expect(await compare(g)).toEqual({
      [a]: { truth: 1, fake: 2, sphinx: 0 },
      [b]: { truth: 1, fake: 0, sphinx: 0 },
      [sphinx]: { truth: 0, fake: 0, sphinx: 2 },
    })
    expect([c, d]).toHaveLength(2)
  })

  it('agrees with the database in many random rounds, matching answers included', async () => {
    // A few possible texts, so that answers often match each other or the truth.
    const texts = ['Wahr', 'Fussball', 'Fußball', 'Brot', 'Käse', 'Tee', 'Zug']
    let seed = 7
    const random = (n: number) => (seed = (seed * 48271) % 2147483647) % n
    for (let round = 0; round < 25; round++) {
      const g = await startGame(3 + random(4))
      const { others } = await g.roles()
      await g.write('Wahr', others.map(() => texts[random(texts.length)]!))
      await g.startReading()
      const { sphinx } = await g.roles()
      const everyoneRight = random(5) === 0
      for (const voter of others) {
        const own = await g.numberOf(voter)
        let pick = everyoneRight ? await g.numberOf(sphinx) : 1 + random(others.length + 1)
        // One's own answer only counts if there is a twin; otherwise take another.
        const twin = (await g.snap(voter)).private.has_twin
        if (pick === own && !twin) pick = (pick % (others.length + 1)) + 1
        await g.act(voter, 'vote', pick)
      }
      await g.revealAll()
      await compare(g)
    }
  }, 120_000)
})

describe('the reveal', () => {
  it('goes from the least popular fake to the truth, then the unpicked fakes', async () => {
    const g = await startGame(6)
    await g.write()
    await g.startReading()
    const { sphinx, others } = await g.roles()
    const [a, b, c, d, e] = others as [string, string, string, string, string]
    // a: 1 vote, b: 3 votes, truth: 1 vote; c, d, e: none
    await g.voteFor(b, a, b, b, sphinx)
    const reveals = async () => (await g.snap(others[0]!)).reveals as any[]
    expect((await g.state()).reveal_steps).toBe(9)

    const textOf = async (u: string) => (await g.snap(u)).own.answer
    await g.revealStep()
    // Step one: answer and voters, but not the author.
    let list = await reveals()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ resolved: false, is_truth: null })
    expect(list[0].entries).toEqual([{ number: await g.numberOf(a), answer: await textOf(a) }])
    expect(list[0].votes).toEqual([{ voter_id: b, number: await g.numberOf(a) }])
    await g.revealStep()
    expect((await reveals())[0]).toMatchObject({ resolved: true, is_truth: false })
    expect((await reveals())[0].entries[0].player_id).toBe(a)

    await g.revealStep()
    await g.revealStep()
    expect((await reveals())[1].entries[0].player_id).toBe(b)
    await g.revealStep()
    expect((await reveals())[2].resolved).toBe(false)
    expect((await g.state()).round_points).toBeNull()
    await g.revealStep()
    expect((await reveals())[2]).toMatchObject({ resolved: true, is_truth: true })
    expect((await reveals())[2].entries[0]).toMatchObject({ player_id: sphinx, is_real: true })

    // The three unpicked fakes take one step each, author included.
    for (let i = 0; i < 3; i++) await g.revealStep()
    list = await reveals()
    expect(list).toHaveLength(6)
    expect(list.slice(3).map((r) => r.entries[0].player_id).sort()).toEqual([c, d, e].sort())
    expect((await g.state()).round_points).not.toBeNull()
  })

  it('reveals matching answers together, also with the truth', async () => {
    const g = await startGame(5)
    await g.write('Wahr', ['wahr', 'Zwilling', 'zwilling', 'Solo'])
    await g.startReading()
    const { sphinx, others } = await g.roles()
    const [, b, , d] = others as [string, string, string, string]
    await g.voteFor(b, d, d, sphinx)
    await g.revealAll()
    const list = (await g.snap(g.host)).reveals as any[]
    expect(list.map((r) => [r.entries.length, r.is_truth])).toEqual(
      expect.arrayContaining([[2, true], [2, false], [1, false]]),
    )
    expect(list).toHaveLength(3)
    expect(list.at(-1).is_truth).toBe(true)
  })

  it('advances once per tap, and only for the Sphinx while they are there', async () => {
    const g = await startGameWhere(false)
    await g.write()
    await g.startReading()
    const { sphinx } = await g.roles()
    await g.voteFor(sphinx, sphinx, sphinx)
    const other = (await g.roles()).others.find((u) => u !== g.host)!
    await expect(g.act(other, 'reveal_next', 0)).rejects.toThrow('not_host')
    await expect(g.act(g.host, 'reveal_next', 0)).rejects.toThrow('players_still_here')
    await g.act(sphinx, 'reveal_next', 0)
    await expect(g.act(sphinx, 'reveal_next', 0)).rejects.toThrow('wrong_phase')
    await expect(g.act(sphinx, 'next_round')).rejects.toThrow('wrong_phase')
    await g.goOffline([sphinx])
    await g.act(g.host, 'reveal_next', 1)
    expect((await g.state()).reveal_step).toBe(2)
  })
})

describe('whole games', () => {
  it('makes everyone the Sphinx equally often', async () => {
    for (const [players, rounds] of [[3, 6], [5, 10], [6, 6], [10, 10]]) {
      const g = await startGame(players)
      expect((await g.state()).rounds_total).toBe(rounds)
    }
  })

  it('plays to the end and starts fresh again', async () => {
    const g = await startGame(3)
    const sphinxes: string[] = []
    const sentences: string[] = []
    for (let i = 0; i < 6; i++) {
      await g.write()
      sphinxes.push((await g.roles()).sphinx)
      sentences.push((await g.state()).sentence)
      await g.startReading()
      const { sphinx, others } = await g.roles()
      await g.voteFor(sphinx, others[0]!)
      await g.revealAll()
      await g.act(g.host, 'next_round')
    }
    for (const user of g.users) expect(sphinxes.filter((x) => x === user)).toHaveLength(2)
    expect(new Set(sentences).size).toBe(6)
    expect(await g.state()).toMatchObject({ phase: 'game_over', rounds_played: 6 })
    const history = (await g.snap(g.users[1]!)).history
    expect(history).toHaveLength(6)
    expect(history[0].truth).toBe('die Wahrheit')

    await t.call(g.host, 'return_to_lobby', g.roomId)
    await t.call(g.host, 'walter_start', g.roomId)
    expect(await g.state()).toMatchObject({ round_no: 1, rounds_played: 0, phase: 'choosing' })
    expect((await g.snap(g.host)).scores).toEqual({})
    expect((await g.snap(g.host)).history).toEqual([])
  }, 60_000)

  it('lets new players join only after the reveal', async () => {
    const g = await startGame()
    await g.write()
    await g.startReading()
    const { sphinx } = await g.roles()
    await g.voteFor(sphinx, sphinx, sphinx)
    await g.revealStep()
    await expect(t.call(randomUUID(), 'join_room', g.code, 'Spät')).rejects.toThrow('game_running')
    await g.revealAll()
    const late = randomUUID()
    await t.call(late, 'join_room', g.code, 'Spät')
    expect((await g.snap(late)).reveals.length).toBeGreaterThan(0)
    await g.act(g.host, 'next_round')
    expect((await g.state()).player_ids).toContain(late)
  })
})

describe('missing players', () => {
  it('replaces the round if the Sphinx leaves before the reveal', async () => {
    const g = await startGameWhere(false)
    await g.write()
    const { sphinx } = await g.roles()
    await t.call(sphinx, 'leave_room', g.roomId)
    expect(await g.state()).toMatchObject({ phase: 'choosing', round_no: 2, rounds_played: 0 })
  })

  it('keeps a leaver’s answer once reading has started, and counts the rest', async () => {
    const g = await startGameWhere(false, 5)
    await g.write()
    await g.startReading()
    const { sphinx, others } = await g.roles()
    const slow = others.find((u) => u !== g.host)!
    for (const u of others) if (u !== slow) await g.act(u, 'vote', await g.numberOf(sphinx))
    await t.call(slow, 'leave_room', g.roomId)
    expect(await g.state()).toMatchObject({ phase: 'reveal', answer_count: 5 })
    await g.revealAll()
    expect((await g.snap(g.host)).reveals.flatMap((r: any) => r.entries)).toHaveLength(5)
  })

  it('lets the host continue without offline writers and voters only', async () => {
    const g = await startGameWhere(false, 5)
    await g.choose()
    const { sphinx, others } = await g.roles()
    const slow = others.find((u) => u !== g.host)!
    await g.act(sphinx, 'submit', 'wahr')
    for (const u of others) if (u !== slow) await g.act(u, 'submit', `f ${u}`)
    await expect(g.act(g.host, 'force_continue')).rejects.toThrow('players_still_here')
    await g.goOffline([slow])
    await g.act(g.host, 'force_continue')
    expect((await g.state()).player_ids).not.toContain(slow)
    await g.startReading()

    const voters = (await g.roles()).others
    await expect(g.act(g.host, 'force_continue')).rejects.toThrow('players_still_here')
    await g.act(g.host, 'vote', await g.numberOf(sphinx))
    await g.goOffline(voters.filter((u) => u !== g.host))
    await g.act(g.host, 'force_continue')
    expect((await g.state()).phase).toBe('reveal')
  })

  it('does not continue without the Sphinx’s truth', async () => {
    const g = await startGameWhere(false)
    await g.choose()
    const { sphinx, others } = await g.roles()
    for (const u of others) await g.act(u, 'submit', `f ${u}`)
    await g.goOffline([sphinx])
    await expect(g.act(g.host, 'force_continue')).rejects.toThrow('answers_missing')
    await g.act(g.host, 'skip_round')
    expect(await g.state()).toMatchObject({ phase: 'choosing', rounds_played: 0 })
  })

  it('ends the game below three players', async () => {
    const g = await startGame(3)
    await t.call(g.users[2]!, 'leave_room', g.roomId)
    expect((await g.state()).phase).toBe('game_over')
  })
})

describe('sentences', () => {
  it('match the latest migration: about 200, each with one gap, Swiss spelling', async () => {
    const { SENTENCES_DE } = await import('../../src/games/walter/sentences.de')
    const { rows } = await t.db.query<{ sentence: string }>(
      'select sentence from private.walter_sentences',
    )
    expect(rows.map((r) => r.sentence).sort()).toEqual([...SENTENCES_DE].sort())
    expect(new Set(SENTENCES_DE).size).toBe(SENTENCES_DE.length)
    expect(SENTENCES_DE.length).toBeGreaterThanOrEqual(180)
    for (const sentence of SENTENCES_DE) expect(sentence.split('WALTER')).toHaveLength(2)
    expect(SENTENCES_DE.join('')).not.toContain('ß')
  })
})
