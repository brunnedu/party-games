import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createDatabase, createRoom, type TestDb } from './harness'

let t: TestDb
beforeAll(async () => {
  t = await createDatabase()
}, 60_000)

async function startGame(n = 4) {
  const room = await createRoom(t, n, 'imposter')
  const { users, roomId } = room
  const host = users[0]!
  await t.call(host, 'imposter_start', roomId)

  const snap = (user: string) => t.call(user, 'imposter_snapshot', roomId)
  const state = async () => (await snap(host)).game
  const act = async (user: string, fn: string, ...args: unknown[]) =>
    t.call(user, `imposter_${fn}`, roomId, (await state()).round_no, ...args)

  /** Who is who, read directly from the database (no client could do this). */
  const secret = async () => {
    const { round_no, player_ids } = await state()
    const { rows } = await t.db.query<any>(
      'select * from public.imposter_roles where room_id = $1 and round_no = $2',
      [roomId, round_no],
    )
    const imposter = rows.find((r) => r.is_imposter).player_id as string
    return {
      imposter,
      word: rows.find((r) => r.word).word as string,
      others: (player_ids as string[]).filter((p) => p !== imposter),
    }
  }

  const vote = async (voter: string, target: string) => {
    const { vote_no } = await state()
    return act(voter, 'vote', vote_no, target)
  }
  /** Everyone votes for `target`; the target votes for someone else. */
  const voteFor = async (target: string) => {
    const { player_ids } = await state()
    for (const p of player_ids as string[]) {
      await vote(p, p === target ? player_ids.find((o: string) => o !== p) : target)
    }
  }
  /** Two against two in a room of four: a and b each get two votes. */
  const tie = async (a: string, b: string) => {
    const [c, d] = (await state()).player_ids.filter((p: string) => p !== a && p !== b)
    await vote(a, b)
    await vote(b, a)
    await vote(c, a)
    await vote(d, b)
  }
  const openVoting = () => act(host, 'open_voting')
  const scoreOf = async (user: string) => (await snap(host)).scores[user] ?? 0
  const goOffline = (ids: string[]) =>
    t.db.query(
      `update private.heartbeats set last_seen = now() - interval '2 minutes'
       where room_id = $1 and user_id = any($2)`,
      [roomId, ids],
    )
  return { ...room, host, snap, state, act, secret, vote, voteFor, tie, openVoting, scoreOf, goOffline }
}

/** Starts games until the host is (or isn't) the imposter. */
async function startGameWhere(hostIsImposter: boolean, n = 4) {
  let g = await startGame(n)
  while (((await g.secret()).imposter === g.host) !== hostIsImposter) g = await startGame(n)
  return g
}

describe('a new round', () => {
  it('has one imposter, a 16-word grid and everyone in the speaking order', async () => {
    const g = await startGame(5)
    const game = await g.state()
    const { word, others } = await g.secret()
    expect(game.grid).toHaveLength(16)
    expect(game.grid).toContain(word)
    expect([...game.player_ids].sort()).toEqual([...g.users].sort())
    expect(others).toHaveLength(4)
    expect(game).toMatchObject({ phase: 'hints', imposter_id: null, word: null })
    expect(game).not.toHaveProperty('used_categories')
  })

  it('does not repeat a category until all were played', async () => {
    const g = await startGame(3)
    const seen: string[] = []
    for (let i = 0; i < 25; i++) {
      seen.push((await g.state()).category)
      await g.act(g.host, 'cancel_round')
      await g.act(g.host, 'next_round')
    }
    expect(new Set(seen).size).toBe(25)
    expect((await g.state()).category).not.toBe(seen.at(-1))
  }, 60_000)
})

describe('secrets', () => {
  it('lets players read only their own role, even directly', async () => {
    const g = await startGame()
    const { imposter, word, others } = await g.secret()
    for (const user of g.users) {
      const rows = await t.as<any>(user, 'select * from imposter_roles where room_id = $1', [
        g.roomId,
      ])
      expect(rows).toHaveLength(1)
      expect(rows[0].player_id).toBe(user)
    }
    expect((await g.snap(imposter)).role).toEqual({ is_imposter: true, word: null })
    expect((await g.snap(others[0]!)).role).toEqual({ is_imposter: false, word })
    // Nothing the imposter can fetch says which grid word it is.
    const seen = await g.snap(imposter)
    expect(seen.game.word).toBeNull()
    expect(seen.votes).toEqual([])
  })

  it('keeps others’ roles hidden after the round', async () => {
    const g = await startGame()
    await g.act(g.host, 'cancel_round')
    const rows = await t.as(g.users[1]!, 'select * from imposter_roles where room_id = $1', [
      g.roomId,
    ])
    expect(rows).toHaveLength(1)
  })

  it('shows nothing to outsiders and blocks writes and internals', async () => {
    const g = await startGame()
    const outsider = randomUUID()
    for (const table of ['imposter_games', 'imposter_roles', 'imposter_votes', 'imposter_scores']) {
      expect(await t.as(outsider, `select * from ${table}`)).toEqual([])
      await expect(t.as(g.users[1]!, `delete from ${table}`)).rejects.toThrow(/permission denied/)
    }
    await expect(
      t.as(g.users[1]!, 'select * from private.imposter_categories'),
    ).rejects.toThrow(/permission denied/)
    await expect(
      t.as(g.users[1]!, `select private.imposter_finish($1, 'escaped')`, [g.roomId]),
    ).rejects.toThrow(/permission denied/)
  })

  it('keeps votes secret until everyone has voted', async () => {
    const g = await startGame()
    const [a, b, c, d] = g.users as [string, string, string, string]
    await g.openVoting()
    await g.vote(a, b)
    await g.vote(b, c)
    expect((await g.snap(a)).votes).toEqual([{ vote_no: 1, voter_id: a, target_id: b }])
    expect((await g.snap(c)).votes).toEqual([])
    expect((await g.state()).voted_ids).toEqual([a, b])
    await g.vote(c, b)
    await g.vote(d, b)
    expect((await g.snap(c)).votes).toHaveLength(4)
  })
})

describe('voting and scoring', () => {
  it('gives the imposter 2 points for escaping', async () => {
    const g = await startGame()
    const { imposter, word, others } = await g.secret()
    await g.openVoting()
    await g.voteFor(others[0]!)
    expect(await g.state()).toMatchObject({
      phase: 'round_result', outcome: 'escaped', imposter_id: imposter,
      accused_id: others[0], word,
    })
    expect(await g.scoreOf(imposter)).toBe(2)
    for (const o of others) expect(await g.scoreOf(o)).toBe(0)
  })

  it('lets a caught imposter guess, without revealing the word first', async () => {
    const g = await startGame()
    const { imposter, word, others } = await g.secret()
    await g.openVoting()
    await g.voteFor(imposter)
    expect(await g.state()).toMatchObject({ phase: 'guessing', imposter_id: imposter, word: null })
    expect((await g.snap(imposter)).role.word).toBeNull()
    await expect(g.act(others[0]!, 'guess', word)).rejects.toThrow('wrong_role')
    await expect(g.act(imposter, 'guess', 'nicht im Raster')).rejects.toThrow('invalid_guess')
    await expect(g.act(g.host, 'cancel_round')).rejects.toThrow('wrong_phase')
    await g.act(imposter, 'guess', word)
    expect(await g.state()).toMatchObject({ outcome: 'caught_guessed', guess: word, word })
    expect(await g.scoreOf(imposter)).toBe(1)
    for (const o of others) expect(await g.scoreOf(o)).toBe(0)
  })

  it('gives everyone else a point when the guess is wrong, adding up over rounds', async () => {
    const g = await startGame()
    for (let round = 0; round < 2; round++) {
      const { imposter, word } = await g.secret()
      await g.openVoting()
      await g.voteFor(imposter)
      const wrong = (await g.state()).grid.find((w: string) => w !== word)
      await g.act(imposter, 'guess', wrong)
      expect((await g.state()).outcome).toBe('caught_missed')
      if (round === 0) await g.act(g.host, 'next_round')
    }
    const total = Object.values<number>((await g.snap(g.host)).scores).reduce((a, b) => a + b, 0)
    expect(total).toBe(6)
  })

  it('holds a run-off after a tie; a second tie lets the imposter escape', async () => {
    const g = await startGame()
    const [a, b, c, d] = g.users as [string, string, string, string]
    const { imposter } = await g.secret()
    await g.openVoting()
    await g.tie(a, b)
    const game = await g.state()
    expect(game).toMatchObject({ phase: 'voting', vote_no: 2, voted_ids: [] })
    expect([...game.candidate_ids].sort()).toEqual([a, b].sort())
    // The first vote is visible now; the run-off only offers the tied players.
    expect((await g.snap(c)).votes).toHaveLength(4)
    await expect(g.vote(a, c)).rejects.toThrow('invalid_vote')
    await expect(g.act(d, 'vote', 1, a)).rejects.toThrow('wrong_phase')

    await g.tie(a, b)
    expect(await g.state()).toMatchObject({ phase: 'round_result', outcome: 'escaped' })
    expect(await g.scoreOf(imposter)).toBe(2)
  })

  it('validates votes and allows changing them', async () => {
    const g = await startGame()
    const [a, b, c] = g.users as [string, string, string]
    await expect(g.vote(a, b)).rejects.toThrow('wrong_phase')
    await expect(g.act(b, 'open_voting')).rejects.toThrow('not_host')
    await g.openVoting()
    await expect(g.vote(a, a)).rejects.toThrow('invalid_vote')
    await expect(g.vote(a, randomUUID())).rejects.toThrow('invalid_vote')
    await g.vote(a, b)
    await g.vote(a, c)
    expect((await g.snap(a)).votes).toEqual([{ vote_no: 1, voter_id: a, target_id: c }])
    expect((await g.state()).voted_ids).toEqual([a])
  })
})

describe('between rounds', () => {
  it('lets new players join only between rounds, starting at zero', async () => {
    const g = await startGame()
    const late = randomUUID()
    const joinable = async () =>
      (await t.as<any>(late, 'select * from get_room_info($1)', [g.code]))[0].joinable
    expect(await joinable()).toBe(false)
    await expect(t.call(late, 'join_room', g.code, 'Spät')).rejects.toThrow('game_running')

    await g.act(g.host, 'cancel_round')
    expect(await joinable()).toBe(true)
    await t.call(late, 'join_room', g.code, 'Spät')
    expect((await g.snap(late)).role).toBeNull()

    await g.act(g.host, 'next_round')
    expect((await g.state()).player_ids).toContain(late)
    expect(await joinable()).toBe(false)
    expect(await g.scoreOf(late)).toBe(0)
  })

  it('ends the game on request and starts fresh from the lobby', async () => {
    const g = await startGame()
    await expect(g.act(g.host, 'end_game')).rejects.toThrow('wrong_phase')
    const { others } = await g.secret()
    await g.openVoting()
    await g.voteFor(others[0]!)
    await expect(g.act(g.users[1]!, 'end_game')).rejects.toThrow('not_host')
    await g.act(g.host, 'end_game')
    expect((await g.state()).phase).toBe('game_over')
    expect((await t.call(g.host, 'room_snapshot', g.code)).room.status).toBe('finished')
    await expect(t.call(randomUUID(), 'join_room', g.code, 'Zu spät')).rejects.toThrow(
      'game_running',
    )
    await t.call(g.host, 'return_to_lobby', g.roomId)
    await t.call(g.host, 'imposter_start', g.roomId)
    expect(await g.state()).toMatchObject({ round_no: 1, phase: 'hints' })
    expect((await g.snap(g.host)).scores).toEqual({})
  })

  it('does not let a Just One room start Imposter', async () => {
    const { users, roomId } = await createRoom(t, 3)
    await expect(t.call(users[0]!, 'imposter_start', roomId)).rejects.toThrow('wrong_phase')
  })
})

describe('missing players', () => {
  it('cancels the round without points when the imposter leaves', async () => {
    const g = await startGameWhere(false)
    const { imposter } = await g.secret()
    await t.call(imposter, 'leave_room', g.roomId)
    expect(await g.state()).toMatchObject({
      phase: 'round_result', outcome: 'cancelled', imposter_id: imposter,
    })
    expect((await g.snap(g.host)).scores).toEqual({})
  })

  it('counts the votes when the last missing voter leaves', async () => {
    const g = await startGameWhere(false, 5)
    const { imposter, others } = await g.secret()
    const slow = others.find((p) => p !== g.host)!
    await g.openVoting()
    for (const p of [...others, imposter].filter((p) => p !== slow)) {
      await g.vote(p, p === imposter ? others.find((o) => o !== slow)! : imposter)
    }
    expect((await g.state()).phase).toBe('voting')
    await t.call(slow, 'leave_room', g.roomId)
    expect((await g.state()).phase).toBe('guessing')
  })

  it('voids votes for someone who leaves, so those players vote again', async () => {
    const g = await startGameWhere(false, 5)
    const { imposter, others } = await g.secret()
    const leaver = others.find((p) => p !== g.host)!
    await g.openVoting()
    await g.vote(g.host, leaver)
    await t.call(leaver, 'leave_room', g.roomId)
    const game = await g.state()
    expect(game.player_ids).not.toContain(leaver)
    expect(game.voted_ids).toEqual([])
    await g.voteFor(imposter)
    expect((await g.state()).phase).toBe('guessing')
  })

  it('ends the game below three players', async () => {
    const g = await startGame(3)
    await t.call(g.users[2]!, 'leave_room', g.roomId)
    expect(await g.state()).toMatchObject({ phase: 'game_over', outcome: 'cancelled' })
  })

  it('only lets the host skip people who are offline', async () => {
    const g = await startGameWhere(true)
    await g.openVoting()
    const [, b, c, d] = g.users as [string, string, string, string]
    await g.vote(g.host, b)
    await g.vote(b, c)
    await expect(g.act(g.host, 'close_voting')).rejects.toThrow('players_still_here')
    await g.goOffline([c, d])
    await g.act(g.host, 'close_voting')
    expect((await g.state()).vote_no).toBe(2)
  })

  it('only skips the guess of an imposter who is offline', async () => {
    const g = await startGameWhere(false)
    const { imposter } = await g.secret()
    await g.openVoting()
    await g.voteFor(imposter)
    await expect(g.act(g.host, 'skip_guess')).rejects.toThrow('players_still_here')
    await g.goOffline([imposter])
    await g.act(g.host, 'skip_guess')
    expect((await g.state()).outcome).toBe('caught_missed')
  })
})

describe('word grids', () => {
  it('match the latest migration: 16 unique Swiss-spelled words each', async () => {
    const { CATEGORIES_DE } = await import('../../src/games/imposter/words.de')
    const { rows } = await t.db.query<{ name: string; words: string[] }>(
      'select name, words from private.imposter_categories',
    )
    expect(Object.fromEntries(rows.map((r) => [r.name, r.words]))).toEqual(CATEGORIES_DE)
    expect(rows.length).toBeGreaterThanOrEqual(25)
    for (const words of Object.values(CATEGORIES_DE)) expect(new Set(words).size).toBe(16)
    expect(JSON.stringify(CATEGORIES_DE)).not.toContain('ß')
  })
})
