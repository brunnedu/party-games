import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createDatabase, createRoom, type TestDb } from './harness'

let t: TestDb
beforeAll(async () => {
  t = await createDatabase()
}, 60_000)

async function startGame(n = 4) {
  const room = await createRoom(t, n)
  const { users, roomId } = room
  await t.call(users[0]!, 'just_one_start', roomId)
  const snap = (user: string) => t.call(user, 'just_one_snapshot', roomId)
  const state = async () => (await snap(users[0]!)).game
  const roles = async () => {
    const game = await state()
    return {
      game,
      guesser: game.guesser_id as string,
      givers: users.filter((u) => u !== game.guesser_id),
    }
  }
  const word = async () => {
    const { givers } = await roles()
    return (await snap(givers[0]!)).word as string
  }
  const act = async (user: string, fn: string, ...args: unknown[]) =>
    t.call(user, `just_one_${fn}`, roomId, (await state()).round_no, ...args)

  /** Brings the current round to the guessing phase. */
  const toGuessing = async () => {
    const { givers } = await roles()
    await act(givers[0]!, 'accept_word')
    for (const [i, g] of givers.entries()) await act(g, 'submit_clue', `Hinweis${i}`)
    for (const g of givers) {
      if ((await state()).phase === 'reviewing_clues') await act(g, 'confirm_review')
    }
  }
  const playRound = async (outcome: 'correct' | 'wrong' | 'pass') => {
    await toGuessing()
    const { guesser, givers } = await roles()
    const guess = outcome === 'pass' ? null : outcome === 'wrong' ? 'falsch geraten' : await word()
    await act(guesser, 'submit_guess', guess)
    await act(givers[0]!, 'next_round')
  }
  return { ...room, snap, state, roles, word, act, toGuessing, playRound }
}

/** Starts games until the host is (or isn't) the first guesser. */
async function startGameWhere(hostGuesses: boolean, n = 4) {
  let g = await startGame(n)
  while (((await g.state()).guesser_id === g.users[0]) !== hostGuesses) g = await startGame(n)
  return g
}

describe('rooms', () => {
  it('creates codes without ambiguous characters', async () => {
    for (let i = 0; i < 5; i++) {
      const { code } = await createRoom(t, 1)
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{5}$/)
    }
  })

  it('hides rooms from non-members', async () => {
    const { code, roomId } = await createRoom(t, 3)
    const outsider = randomUUID()
    expect(await t.call(outsider, 'room_snapshot', code)).toBeNull()
    expect(await t.as(outsider, 'select * from players where room_id = $1', [roomId])).toEqual([])
    expect(await t.as(outsider, 'select * from rooms where id = $1', [roomId])).toEqual([])
    const info = await t.as(outsider, 'select * from get_room_info($1)', [code.toLowerCase()])
    expect(info).toEqual([
      { game_type: 'just-one', status: 'lobby', joinable: true, access_required: false },
    ])
  })

  it('blocks direct writes and anonymous calls', async () => {
    const { users, roomId, code } = await createRoom(t, 3)
    for (const sql of [
      'update rooms set host_id = gen_random_uuid() where id = $1',
      'delete from players where room_id = $1',
      'delete from rooms where id = $1',
    ]) {
      await expect(t.as(users[1]!, sql, [roomId])).rejects.toThrow(/permission denied/)
    }
    await expect(t.as(null, 'select * from get_room_info($1)', [code])).rejects.toThrow(
      /permission denied/,
    )
  })

  it('validates joining', async () => {
    const { code, users } = await createRoom(t, 10)
    await expect(t.call(randomUUID(), 'join_room', code, 'Neu')).rejects.toThrow('room_full')
    // Members can always come back.
    await expect(t.call(users[3]!, 'join_room', code, 'egal')).resolves.toBeTruthy()
    const small = await createRoom(t, 2)
    await expect(t.call(randomUUID(), 'join_room', small.code, 'spieler 1')).rejects.toThrow(
      'name_taken',
    )
    await expect(t.call(randomUUID(), 'join_room', small.code, '   ')).rejects.toThrow(
      'invalid_name',
    )
    await expect(t.call(randomUUID(), 'join_room', 'ZZZZZ', 'Neu')).rejects.toThrow(
      'room_not_found',
    )
  })

  it('lets only the host kick, and kicked players stay out', async () => {
    const { users, roomId, code } = await createRoom(t, 3)
    await expect(t.call(users[1]!, 'kick_player', roomId, users[2])).rejects.toThrow('not_host')
    await t.call(users[0]!, 'kick_player', roomId, users[2])
    await expect(t.call(users[2]!, 'join_room', code, 'Wieder')).rejects.toThrow('kicked')
  })

  it('transfers the host role when the host leaves or goes silent', async () => {
    const { users, roomId, code } = await createRoom(t, 3)
    await expect(t.call(users[1]!, 'claim_host', roomId)).rejects.toThrow('host_still_here')
    await t.db.query(
      `update private.heartbeats set last_seen = now() - interval '2 minutes'
       where room_id = $1 and user_id = $2`,
      [roomId, users[0]],
    )
    await t.call(users[2]!, 'claim_host', roomId)
    expect((await t.call(users[2]!, 'room_snapshot', code)).room.host_id).toBe(users[2])
    await t.call(users[2]!, 'leave_room', roomId)
    expect((await t.call(users[1]!, 'room_snapshot', code)).room.host_id).toBe(users[1])
  })

  it('deletes empty and old rooms', async () => {
    const empty = await createRoom(t, 1)
    await t.call(empty.users[0]!, 'leave_room', empty.roomId)
    const old = await createRoom(t, 3)
    await t.call(old.users[0]!, 'just_one_start', old.roomId)
    await t.db.query(
      `update public.rooms set last_activity_at = now() - interval '2 days' where id = $1`,
      [old.roomId],
    )
    await t.db.query(
      `update private.heartbeats set last_seen = now() - interval '2 days' where room_id = $1`,
      [old.roomId],
    )
    await t.db.exec('select private.cleanup_old_rooms()')
    const left = await t.db.query('select 1 from public.rooms where id = any($1)', [
      [empty.roomId, old.roomId],
    ])
    expect(left.rows).toEqual([])
  })
})

describe('secrets', () => {
  it('never exposes the deck or the word pool', async () => {
    const { users } = await startGame()
    for (const table of ['private.just_one_decks', 'private.just_one_words']) {
      await expect(t.as(users[0]!, `select * from ${table}`)).rejects.toThrow(/permission denied/)
    }
  })

  it('does not let clients call internal functions', async () => {
    const { users, roomId } = await startGame()
    await expect(t.as(users[0]!, 'select private.just_one_draw($1)', [roomId])).rejects.toThrow(
      /permission denied/,
    )
  })

  it('reveals word and clues step by step', async () => {
    const g = await startGameWhere(true)
    const { guesser, givers } = await g.roles()
    const [a, b, c] = givers as [string, string, string]
    const wordRows = (u: string) =>
      t.as(u, 'select * from just_one_secrets where room_id = $1', [g.roomId])
    const clueRows = (u: string) =>
      t.as(u, 'select clue from just_one_clues where room_id = $1 order by clue', [g.roomId])
    const clues = async (u: string) => (await clueRows(u)).map((r) => r.clue)

    expect(await wordRows(guesser)).toEqual([])
    expect((await g.snap(guesser)).word).toBeNull()
    expect(await wordRows(a)).toHaveLength(1)

    await g.act(a, 'accept_word')
    await g.act(a, 'submit_clue', 'Gleich')
    await g.act(b, 'submit_clue', ' gleich ')
    expect(await clues(a)).toEqual(['Gleich'])
    expect(await clues(b)).toEqual(['gleich'])
    expect(await clues(guesser)).toEqual([])

    await g.act(c, 'submit_clue', 'Anders')
    expect((await g.state()).phase).toBe('reviewing_clues')
    expect(await clues(a)).toHaveLength(3)
    expect(await clues(guesser)).toEqual([])
    expect((await g.snap(guesser)).clues).toEqual([])
    expect(await wordRows(guesser)).toEqual([])

    await g.act(a, 'confirm_review')
    await g.act(b, 'confirm_review')
    expect((await g.state()).phase).toBe('guessing')
    expect(await clues(guesser)).toEqual(['Anders'])
    expect(await wordRows(guesser)).toEqual([])

    await g.act(guesser, 'submit_guess', null)
    expect(await wordRows(guesser)).toHaveLength(1)
    expect(await clues(guesser)).toHaveLength(3)
  })

  it('hides the next word from the next guesser', async () => {
    const g = await startGame()
    await g.playRound('pass')
    const { guesser, game } = await g.roles()
    const rows = await t.as<{ round_no: number }>(
      guesser,
      'select round_no from just_one_secrets where room_id = $1',
      [g.roomId],
    )
    expect(rows.map((r) => r.round_no)).not.toContain(game.round_no)
  })
})

describe('Just One rules', () => {
  it('normalizes umlauts, sharp s, case and spaces', async () => {
    const { rows } = await t.db.query<{ n: string }>(
      `select private.normalize_word(w) as n
       from unnest(array['  BÄR ', 'Baer', 'Fuß', 'fuss', 'Öl   Über', 'oel ueber']) w`,
    )
    expect(rows.map((r) => r.n)).toEqual([
      'baer', 'baer', 'fuss', 'fuss', 'oel ueber', 'oel ueber',
    ])
  })

  it('cancels the mystery word itself and lets clue-givers cancel more', async () => {
    const g = await startGameWhere(true)
    const { givers, guesser } = await g.roles()
    const [a, b, c] = givers as [string, string, string]
    const secret = await g.word()
    await g.act(a, 'accept_word')
    await g.act(a, 'submit_clue', secret.toUpperCase())
    await g.act(b, 'submit_clue', 'Hunde')
    await g.act(c, 'submit_clue', 'Hund')
    const find = async (u: string) => (await g.snap(a)).clues.find((x: any) => x.player_id === u)
    expect((await find(a)).auto_cancelled).toBe(true)
    await g.act(a, 'toggle_clue', b)
    await g.act(a, 'toggle_clue', a) // automatic cancellations can't be undone
    expect((await find(b)).manual_cancelled).toBe(true)
    expect((await find(a)).manual_cancelled).toBe(false)

    await g.act(a, 'confirm_review')
    await g.act(b, 'toggle_clue', c) // changing the selection resets confirmations
    expect((await g.state()).confirmed_ids).toEqual([])
    await g.act(b, 'toggle_clue', c)
    await g.act(b, 'confirm_review')
    await g.act(c, 'confirm_review')
    expect((await g.snap(guesser)).clues.map((x: any) => x.clue)).toEqual(['Hund'])
  })

  it('lets the host end the review alone', async () => {
    const g = await startGameWhere(false)
    const { givers } = await g.roles()
    await g.act(givers[0]!, 'accept_word')
    for (const [i, u] of givers.entries()) await g.act(u, 'submit_clue', `x${i}`)
    await g.act(g.users[0]!, 'confirm_review')
    expect((await g.state()).phase).toBe('guessing')
  })

  it('enforces roles, phases and round numbers', async () => {
    const g = await startGame()
    const { guesser, givers } = await g.roles()
    await expect(g.act(guesser, 'accept_word')).rejects.toThrow('wrong_role')
    await expect(g.act(givers[0]!, 'submit_clue', 'x')).rejects.toThrow('wrong_phase')
    await expect(g.act(guesser, 'submit_guess', 'x')).rejects.toThrow('wrong_phase')
    await expect(t.call(givers[0]!, 'just_one_accept_word', g.roomId, 99)).rejects.toThrow(
      'wrong_phase',
    )
    await expect(
      t.call(randomUUID(), 'just_one_accept_word', g.roomId, 1),
    ).rejects.toThrow('not_in_room')
    await g.toGuessing()
    await expect(g.act(givers[0]!, 'submit_guess', 'x')).rejects.toThrow('wrong_role')
    await g.act(guesser, 'submit_guess', 'x')
    await expect(g.act(guesser, 'accept_guess')).rejects.toThrow('wrong_role')
  })

  it('skips a word only once and without using a card', async () => {
    const g = await startGame()
    const { givers } = await g.roles()
    const first = await g.word()
    await g.act(givers[0]!, 'skip_word', first)
    const second = await g.word()
    await g.act(givers[1]!, 'skip_word', first) // late double click
    expect(second).not.toBe(first)
    expect(await g.word()).toBe(second)
    expect((await g.state()).cards_used).toBe(0)
  })

  it('scores correct, pass, wrong and accept-anyway', async () => {
    const g = await startGame()
    await g.playRound('correct')
    expect(await g.state()).toMatchObject({ score: 1, cards_used: 1 })
    await g.playRound('pass')
    expect(await g.state()).toMatchObject({ score: 1, cards_used: 2 })
    await g.playRound('wrong')
    expect(await g.state()).toMatchObject({ score: 1, cards_used: 4 })

    await g.toGuessing()
    const { guesser, givers } = await g.roles()
    await g.act(guesser, 'submit_guess', 'Tippfehler')
    await g.act(givers[0]!, 'accept_guess')
    await g.act(givers[1]!, 'accept_guess') // must not count twice
    await g.act(givers[0]!, 'next_round')
    expect(await g.state()).toMatchObject({ score: 2, cards_used: 5 })
  })

  it('rotates the guesser by seat', async () => {
    const g = await startGame()
    const order: string[] = []
    for (let i = 0; i < 5; i++) {
      order.push((await g.state()).guesser_id)
      await g.playRound('pass')
    }
    const start = g.users.indexOf(order[0]!)
    expect(order).toEqual([0, 1, 2, 3, 4].map((i) => g.users[(start + i) % 4]))
  })

  it('ends after 13 cards, and play again starts fresh', async () => {
    const g = await startGame(3)
    for (let i = 0; i < 13; i++) await g.playRound('correct')
    expect(await g.state()).toMatchObject({ phase: 'game_over', score: 13, cards_used: 13 })
    expect((await t.call(g.users[0]!, 'room_snapshot', g.code)).room.status).toBe('finished')
    expect((await g.snap(g.users[1]!)).history).toHaveLength(13)

    await t.call(g.users[0]!, 'return_to_lobby', g.roomId)
    await t.call(g.users[0]!, 'just_one_start', g.roomId)
    expect(await g.state()).toMatchObject({ round_no: 1, score: 0, cards_used: 0 })
    expect((await g.snap(g.users[1]!)).history).toEqual([])
  }, 60_000)

  it('takes a point for a wrong guess on the last card', async () => {
    const g = await startGame(3)
    for (let i = 0; i < 12; i++) await g.playRound('correct')
    await g.playRound('wrong')
    expect(await g.state()).toMatchObject({ phase: 'game_over', score: 11, cards_used: 13 })
  }, 60_000)

  it('needs three players to start', async () => {
    const { users, roomId } = await createRoom(t, 2)
    await expect(t.call(users[0]!, 'just_one_start', roomId)).rejects.toThrow('not_enough_players')
  })
})

describe('missing players', () => {
  it('replays the round when the guesser leaves', async () => {
    const g = await startGame()
    const { guesser, givers } = await g.roles()
    await t.call(guesser, 'leave_room', g.roomId)
    const game = (await g.snap(givers[0]!)).game
    expect(game).toMatchObject({ phase: 'choosing_word', round_no: 2, cards_used: 0 })
    expect(game.guesser_id).not.toBe(guesser)
  })

  it('moves on when the last missing clue-giver leaves', async () => {
    const g = await startGameWhere(false)
    const { givers } = await g.roles()
    const slow = givers.find((u) => u !== g.users[0])!
    await g.act(g.users[0]!, 'accept_word')
    for (const u of givers) if (u !== slow) await g.act(u, 'submit_clue', u.slice(0, 8))
    await t.call(g.users[0]!, 'kick_player', g.roomId, slow)
    expect((await g.state()).phase).toBe('reviewing_clues')
  })

  it('ends the game below three players', async () => {
    const g = await startGame(3)
    await t.call(g.users[2]!, 'leave_room', g.roomId)
    expect((await g.state()).phase).toBe('game_over')
  })

  it('stops a guesser-host from cutting off players who are still there', async () => {
    const g = await startGameWhere(true)
    const { givers } = await g.roles()
    await g.act(givers[0]!, 'accept_word')
    await g.act(givers[0]!, 'submit_clue', 'eins')
    await expect(g.act(g.users[0]!, 'force_continue')).rejects.toThrow('players_still_here')
    await t.db.query(
      `update private.heartbeats set last_seen = now() - interval '2 minutes'
       where room_id = $1 and user_id = any($2)`,
      [g.roomId, givers.slice(1)],
    )
    await g.act(g.users[0]!, 'force_continue')
    expect((await g.state()).phase).toBe('reviewing_clues')
  })

  it('lets the host skip a stuck round', async () => {
    const g = await startGame()
    await expect(g.act(g.users[1]!, 'skip_round')).rejects.toThrow('not_host')
    await g.act(g.users[0]!, 'skip_round')
    expect((await g.state()).phase).toBe('round_result')
  })
})

describe('word list', () => {
  it('matches the latest word migration, with 300+ unique Swiss-spelled words', async () => {
    const { ALL_WORDS_DE } = await import('../../src/games/just-one/words.de')
    const { rows } = await t.db.query<{ word: string }>('select word from private.just_one_words')
    expect(rows.map((r) => r.word).sort()).toEqual([...ALL_WORDS_DE].sort())
    expect(new Set(ALL_WORDS_DE).size).toBe(ALL_WORDS_DE.length)
    expect(ALL_WORDS_DE.length).toBeGreaterThanOrEqual(300)
    expect(ALL_WORDS_DE.join('')).not.toContain('ß')
  })
})
