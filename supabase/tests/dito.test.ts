import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { ditoCardsSql } from '../../scripts/words-sql'
import { CATEGORY_GROUPS_DE, ditoCards } from '../../src/games/dito/categories.de'
import { normalize } from '../../src/games/dito/match'
import { createDatabase, createRoom, type TestDb } from './harness'

let t: TestDb
beforeAll(async () => {
  t = await createDatabase()
}, 60_000)

/** Nine distinct words; `words(['A'])` puts 'A' in cell 0 and fills the rest uniquely. */
let unique = 0
function grid(first: (string | undefined)[] = []): string[] {
  return Array.from({ length: 9 }, (_, i) => first[i] ?? `Einzel${++unique}`)
}

async function startGame(n = 4) {
  const room = await createRoom(t, n, 'dito')
  const { users, roomId } = room
  const host = users[0]!
  await t.call(host, 'dito_start', roomId)

  const snap = (user: string = host) => t.call(user, 'dito_snapshot', roomId)
  const state = async () => (await snap()).game
  const act = async (user: string, fn: string, ...args: unknown[]) =>
    t.call(user, `dito_${fn}`, roomId, (await state()).step, ...args)

  const choose = async () => {
    const game = await state()
    const options = (await snap(game.chooser_id)).options as string[]
    await act(game.chooser_id, 'choose', options[0])
  }
  /** Everyone writes the current category: cells 0-2, then 3-5, then 6-8. */
  const writeCategory = async (grids: Record<string, string[]>, skip: string[] = []) => {
    const { category_no, order_ids } = await state()
    const cells = [0, 1, 2].map((i) => (category_no - 1) * 3 + i)
    for (const p of order_ids as string[]) {
      if (skip.includes(p)) continue
      await act(p, 'submit', cells, cells.map((c) => grids[p]![c]))
    }
  }
  /** Plays all three categories of a round. grids[i] belongs to users[i]. */
  const write = async (...grids: string[][]) => {
    const byUser = Object.fromEntries(users.map((u, i) => [u, grids[i] ?? grid()]))
    for (let c = 0; c < 3; c++) {
      await choose()
      await writeCategory(byUser)
    }
  }
  /** Lets the 5 seconds before "Weiter" pass. */
  const wait = () =>
    t.db.query(
      `update public.dito_games set changed_at = changed_at - interval '6 seconds',
         objection = case when objection is null then null else jsonb_set(objection,
           '{opened_at}', to_jsonb(clock_timestamp() - interval '16 seconds')) end
       where room_id = $1`,
      [roomId],
    )
  /** Makes `user` the reader, as if the turn had reached them. */
  const turnOf = (user: string) =>
    t.db.query('update public.dito_games set reader_id = $2 where room_id = $1', [roomId, user])
  const read = async (user: string, cell: number) => {
    await turnOf(user)
    await act(user, 'read', cell)
  }
  const confirm = async (by?: string) => {
    await wait()
    const game = await state()
    await act(by ?? game.reader_id, 'confirm', game.revision)
  }
  const claim = (user: string, cell: number | null, also: number[] = []) =>
    act(user, 'claim', cell, also)
  const claimOf = async (user: string) =>
    (await snap()).claims.find((c: any) => c.player_id === user)
  const object = async (by: string, target: string) =>
    act(by, 'object', target, (await claimOf(target)).rev)
  const vote = async (user: string, accept: boolean) =>
    act(user, 'vote', (await state()).objection.no, accept)
  /** Cell states of a player's grid, e.g. { 0: 'circled', 1: 'crossed*' }. */
  const marks = async (user: string) =>
    Object.fromEntries(
      ((await snap(user)).own as any[])
        .filter((a) => a.state !== 'open')
        .map((a) => [a.cell, a.state + (a.star ? '*' : '')]),
    )
  const goOffline = (ids: string[]) =>
    t.db.query(
      `update private.heartbeats set last_seen = now() - interval '2 minutes'
       where room_id = $1 and user_id = any($2)`,
      [roomId, ids],
    )
  return {
    ...room, host, snap, state, act, choose, writeCategory, write, wait, turnOf, read,
    confirm, claim, claimOf, object, vote, marks, goOffline,
  }
}

describe('categories', () => {
  it('has 300 different categories on 150 cards, in Swiss spelling', () => {
    const all = CATEGORY_GROUPS_DE.flat()
    expect(all).toHaveLength(300)
    expect(new Set(all.map((c) => c.toLowerCase())).size).toBe(300)
    expect(all.join(' ')).not.toContain('ß')
    expect(ditoCards()).toHaveLength(150)
    const groupOf = (c: string) => CATEGORY_GROUPS_DE.findIndex((g) => g.includes(c))
    for (const [a, b] of ditoCards()) expect(groupOf(a)).not.toBe(groupOf(b))
  })

  it('has a migration matching the source file', () => {
    const dir = new URL('../migrations/', import.meta.url)
    const latest = readdirSync(dir).filter((f) => f.endsWith('_dito_cards.sql')).sort().at(-1)!
    expect(readFileSync(new URL(latest, dir), 'utf8').replaceAll('\r', '')).toBe(ditoCardsSql())
  })
})

const SAMPLES = [
  'Fussball', 'Fußball', 'FUẞBALL', '  Coca-Cola ', 'coca cola', 'Rock’n’Roll', "Rock'n'Roll",
  '«Der Herr der Ringe»!', 'Äpfel', 'Äpfel', 'z. B.', '(nichts)', '...', '🍎', 'C++', 'a\tb',
]

describe('identical answers', () => {
  it('are the same on the phone as in the database', async () => {
    for (const text of SAMPLES) {
      const { rows } = await t.db.query<{ n: string }>(
        'select private.dito_normalize($1) as n',
        [text],
      )
      expect([text, normalize(text)]).toEqual([text, rows[0]!.n])
    }
  })
})

describe('lobby', () => {
  it('needs 3 to 10 players', async () => {
    const two = await createRoom(t, 2, 'dito')
    await expect(t.call(two.users[0]!, 'dito_start', two.roomId)).rejects.toThrow(
      'not_enough_players',
    )
    const ten = await createRoom(t, 10, 'dito')
    await expect(t.call(randomUUID(), 'join_room', ten.code, 'Elf')).rejects.toThrow('room_full')
  })

  it('lets only the host set the seating order, which the game keeps', async () => {
    const { users, roomId } = await createRoom(t, 3, 'dito')
    const reversed = [...users].reverse()
    await expect(t.call(users[1]!, 'dito_set_order', roomId, reversed)).rejects.toThrow('not_host')
    await expect(t.call(users[0]!, 'dito_set_order', roomId, [users[0]])).rejects.toThrow(
      'players_changed',
    )
    await t.call(users[0]!, 'dito_set_order', roomId, reversed)
    expect((await t.call(users[1]!, 'dito_lobby', roomId)).order_ids).toEqual(reversed)
    await t.call(users[0]!, 'dito_start', roomId)
    expect((await t.call(users[0]!, 'dito_snapshot', roomId)).game.order_ids).toEqual(reversed)
    expect(await t.call(randomUUID(), 'dito_lobby', roomId)).toBeNull()
  })

  it('does not let anyone join a running game', async () => {
    const g = await startGame(3)
    await expect(t.call(randomUUID(), 'join_room', g.code, 'Spät')).rejects.toThrow('game_running')
  })
})

describe('categories and writing', () => {
  it('shows the card only to the chooser, who passes on in seating order', async () => {
    const g = await startGame(3)
    const first = (await g.state()).chooser_id as string
    const options = (await g.snap(first)).options
    expect(options).toHaveLength(2)
    const other = g.users.find((u) => u !== first)!
    expect((await g.snap(other)).options).toBeNull()
    await expect(g.act(other, 'choose', options[0])).rejects.toThrow('wrong_role')
    await expect(g.act(first, 'choose', 'Etwas anderes')).rejects.toThrow('invalid_action')
    await g.act(first, 'choose', options[1])
    expect((await g.state()).categories).toEqual([options[1]])
    await g.writeCategory(Object.fromEntries(g.users.map((u) => [u, grid()])))
    const order = (await g.state()).order_ids as string[]
    expect((await g.state()).chooser_id).toBe(order[(order.indexOf(first) + 1) % 3])
  })

  it('deals no card twice in a room, also in the next game', async () => {
    const g = await startGame(3)
    await g.write()
    await t.call(g.host, 'return_to_lobby', g.roomId)
    await t.call(g.host, 'dito_start', g.roomId)
    const { rows } = await t.db.query<{ n: number }>(
      'select count(*)::int as n from private.dito_used_cards where room_id = $1',
      [g.roomId],
    )
    expect(rows[0]!.n).toBe(4)
  })

  it('keeps grids secret and lets answers change until everyone has written', async () => {
    const g = await startGame(3)
    const [a, b, c] = g.users as [string, string, string]
    await g.choose()
    await g.act(a, 'submit', [0, 4, 8], ['Eins', 'Zwei', 'Drei'])
    await g.act(a, 'submit', [1, 4, 8], ['Vier', 'Zwei', 'Drei'])
    expect((await g.snap(a)).own.map((x: any) => [x.cell, x.answer])).toEqual([
      [1, 'Vier'], [4, 'Zwei'], [8, 'Drei'],
    ])
    expect((await g.snap(b)).own).toEqual([])
    expect(await t.as(b, 'select * from public.dito_answers where player_id = $1', [a])).toEqual([])
    await g.act(b, 'submit', [0, 1, 2], ['x', 'y', 'z'])
    await g.act(c, 'submit', [0, 1, 2], ['x', 'y', 'z'])
    expect(await g.state()).toMatchObject({ phase: 'choosing', category_no: 2 })
    // Earlier cells are fixed now.
    await g.choose()
    await expect(g.act(a, 'submit', [1, 2, 3], ['p', 'q', 'r'])).rejects.toThrow('invalid_action')
    // And an earlier answer can't be written again, however it is spelled.
    await expect(g.act(a, 'submit', [0, 2, 3], ['  vier! ', 'q', 'r'])).rejects.toThrow(
      'repeated_answer',
    )
  })

  it('wants three different answers in three free cells', async () => {
    const g = await startGame(3)
    await g.choose()
    const submit = (cells: number[], answers: string[]) =>
      g.act(g.users[0]!, 'submit', cells, answers)
    await expect(submit([0, 1], ['a', 'b'])).rejects.toThrow('invalid_action')
    await expect(submit([0, 0, 1], ['a', 'b', 'c'])).rejects.toThrow('invalid_action')
    await expect(submit([0, 1, 9], ['a', 'b', 'c'])).rejects.toThrow('invalid_action')
    await expect(submit([0, 1, 2], ['a', ' ', 'c'])).rejects.toThrow('dito_invalid_answer')
    await expect(submit([0, 1, 2], ['a', 'x'.repeat(61), 'c'])).rejects.toThrow(
      'dito_invalid_answer',
    )
    await expect(submit([0, 1, 2], ['Coca-Cola', 'coca cola', 'c'])).rejects.toThrow(
      'repeated_answer',
    )
    // More than two words is allowed (names and sayings).
    await submit([0, 1, 2], ['Der Herr der Ringe', 'b', 'c'])
  })
})

describe('reveal', () => {
  it('preselects answers that differ only in capitals, punctuation, spaces or ß', async () => {
    const g = await startGame(4)
    const [a, b, c, d] = g.users as [string, string, string, string]
    await g.write(grid(['Fussball']), grid([undefined, 'fuß-ball!']), grid(['Fussbälle']), grid())
    await g.read(a, 0)
    expect(await g.claimOf(b)).toMatchObject({ cell: 1, auto_cell: 1, answer: 'fuß-ball!' })
    expect(await g.claimOf(c)).toMatchObject({ cell: null, auto_cell: null })
    expect(await g.claimOf(d)).toMatchObject({ cell: null })
    // Only claimed cells are public.
    expect(JSON.stringify((await g.snap(d)).claims)).not.toContain('Fussbälle')
  })

  it('gives a star when exactly one other has it, across categories', async () => {
    const g = await startGame(4)
    const [a, b] = g.users as [string, string]
    await g.write(grid(['Apfel']), grid([...Array(7), 'apfel']))
    await g.read(a, 0)
    await g.confirm()
    expect(await g.marks(a)).toEqual({ 0: 'circled*' })
    expect(await g.marks(b)).toEqual({ 7: 'circled*' })
    expect((await g.state()).last_reading).toMatchObject({ reader_id: a, answer: 'Apfel' })
  })

  it('only circles when several have it, and crosses out what nobody has', async () => {
    const g = await startGame(4)
    const [a, b, c, d] = g.users as [string, string, string, string]
    await g.write(grid(['Apfel']), grid(['Apfel']), grid(['Apfel']), grid())
    await g.read(a, 0)
    await g.confirm()
    for (const p of [a, b, c]) expect(await g.marks(p)).toEqual({ 0: 'circled' })
    await g.read(d, 3)
    await g.confirm()
    expect(await g.marks(d)).toEqual({ 3: 'crossed' })
    expect((await g.state()).open_counts).toEqual({ [a]: 8, [b]: 8, [c]: 8, [d]: 8 })
  })

  it('passes the turn on in seating order', async () => {
    const g = await startGame(3)
    await g.write()
    const first = (await g.state()).reader_id as string
    await g.act(first, 'read', 0)
    await g.confirm()
    const order = (await g.state()).order_ids as string[]
    expect((await g.state()).reader_id).toBe(order[(order.indexOf(first) + 1) % 3])
  })

  it('accepts a claimed synonym if nobody objects', async () => {
    const g = await startGame(4)
    const [a, b] = g.users as [string, string]
    await g.write(grid(['Violine']), grid(['Geige']))
    await g.read(a, 0)
    await g.claim(b, 0)
    await g.confirm()
    expect(await g.marks(a)).toEqual({ 0: 'circled*' })
    expect(await g.marks(b)).toEqual({ 0: 'circled*' })
  })

  it('circles the chosen one of two fitting answers and crosses the other', async () => {
    const g = await startGame(4)
    const [a, b, c] = g.users as [string, string, string]
    await g.write(grid(['Creme']), grid(['Lotion', 'Hautcreme']), grid(['Creme', 'Salbe']))
    await g.read(a, 0)
    await g.claim(b, 1, [0])
    // c had the identical one; picking the other one crosses the identical one.
    await g.claim(c, 1)
    expect(await g.claimOf(c)).toMatchObject({ cell: 1, also: [0], also_text: ['Creme'] })
    await g.confirm()
    expect(await g.marks(b)).toEqual({ 0: 'crossed', 1: 'circled' })
    expect(await g.marks(c)).toEqual({ 0: 'crossed', 1: 'circled' })
  })

  it('lets the reader cross out another answer that means the same', async () => {
    const g = await startGame(3)
    const [a] = g.users as [string]
    await g.write(grid(['Creme', 'Hautcreme']))
    await g.read(a, 0)
    // The reader can't change which answer is being read.
    await g.claim(a, 5, [1])
    expect(await g.claimOf(a)).toMatchObject({ cell: 0, also: [1] })
    await g.confirm()
    expect(await g.marks(a)).toEqual({ 0: 'crossed', 1: 'crossed' })
  })

  it('only claims own open answers', async () => {
    const g = await startGame(3)
    const [a, b] = g.users as [string, string]
    await g.write(grid(['Eins']), grid(['Eins', 'Zwei']))
    await expect(g.claim(b, 0)).rejects.toThrow('wrong_phase')
    await g.read(a, 0)
    await g.confirm()
    await g.read(a, 1)
    await expect(g.claim(b, 0)).rejects.toThrow('invalid_action')
    await expect(g.claim(b, 9)).rejects.toThrow('invalid_action')
    await expect(g.claim(b, null, [1])).rejects.toThrow('invalid_action')
    await g.turnOf(b)
    await expect(g.act(b, 'read', 0)).rejects.toThrow('wrong_phase')
  })

  it('makes "Weiter" wait, and never accept a change the reader has not seen', async () => {
    const g = await startGame(3)
    const [a, b, c] = g.users as [string, string, string]
    await g.write(grid(['Violine']), grid(['Geige']))
    await g.read(a, 0)
    const seen = (await g.state()).revision
    await expect(g.act(a, 'confirm', seen)).rejects.toThrow('too_early')
    await g.wait()
    await g.claim(b, 0)
    await expect(g.act(a, 'confirm', seen)).rejects.toThrow('claims_changed')
    // The wait starts again after a change.
    await expect(g.act(a, 'confirm', (await g.state()).revision)).rejects.toThrow('too_early')
    await expect(g.confirm(c)).rejects.toThrow('not_host')
    await g.confirm()
  })

  it('ignores a "Weiter" from an earlier reading', async () => {
    const g = await startGame(3)
    const [a, b] = g.users as [string, string]
    await g.write()
    await g.read(a, 0)
    const { step, revision } = await g.state()
    await g.confirm()
    await g.read(b, 0)
    await expect(t.call(a, 'dito_confirm', g.roomId, step, revision)).rejects.toThrow('wrong_phase')
  })
})

describe('objections', () => {
  async function claimed(n = 4) {
    const g = await startGame(n)
    const [a, b] = g.users as [string, string]
    await g.write(grid(['Violine']), grid(['Geige', 'Cello']))
    await g.read(a, 0)
    await g.claim(b, 0)
    return g
  }

  it('is only possible against a change by somebody else', async () => {
    const g = await startGame(3)
    const [a, b, c] = g.users as [string, string, string]
    await g.write(grid(['Eins']), grid(['Eins']))
    await g.read(a, 0)
    await expect(g.object(c, b)).rejects.toThrow('invalid_action') // preselected
    await expect(g.object(c, a)).rejects.toThrow('invalid_action') // nothing changed
    await g.claim(b, null)
    await expect(g.object(b, b)).rejects.toThrow('invalid_action')
    await g.object(c, b) // removing a preselection is a change
    expect((await g.state()).objection).toMatchObject({ target_id: b, by_id: c })
  })

  it('holds the game until all but the claimant have voted', async () => {
    const g = await claimed()
    const [a, b, c, d] = g.users as [string, string, string, string]
    await g.object(c, b)
    await expect(g.confirm()).rejects.toThrow('objection_open')
    await expect(g.claim(b, 1)).rejects.toThrow('objection_open')
    await expect(g.vote(b, true)).rejects.toThrow('wrong_role')
    await g.vote(a, true)
    expect((await g.state()).objection.voted_ids.sort()).toEqual([a, c].sort())
    // How somebody voted stays private.
    await expect(t.as(a, 'select * from private.dito_votes')).rejects.toThrow('permission denied')
    await g.vote(d, false)
    // 2 against, 1 for: rejected.
    expect((await g.state()).objection).toBeNull()
    expect(await g.claimOf(b)).toMatchObject({ cell: null, answer: null, settled: false })
  })

  it('accepts on a tie, and then fixes the claim', async () => {
    const g = await claimed(3)
    const [a, b, c] = g.users as [string, string, string]
    await g.object(c, b)
    await g.vote(a, true)
    expect((await g.state()).objection).toBeNull()
    expect(await g.claimOf(b)).toMatchObject({ cell: 0, settled: true })
    await expect(g.claim(b, 1)).rejects.toThrow('claim_settled')
    await expect(g.object(a, b)).rejects.toThrow('claim_settled')
    await g.confirm()
    expect(await g.marks(b)).toEqual({ 0: 'circled*' })
  })

  it('restores the preselection and refuses the same claim again', async () => {
    const g = await startGame(3)
    const [a, b, c] = g.users as [string, string, string]
    await g.write(grid(['Creme']), grid(['Creme', 'Lotion', 'Salbe']))
    await g.read(a, 0)
    await g.claim(b, 1)
    await g.object(a, b)
    await g.vote(c, false)
    expect(await g.claimOf(b)).toMatchObject({ cell: 0, also: [], answer: 'Creme' })
    await expect(g.claim(b, 1)).rejects.toThrow('claim_rejected')
    await g.claim(b, 2) // a different one is fine
  })

  it('refuses only exactly the rejected claim', async () => {
    const g = await startGame(3)
    const [a, b, c] = g.users as [string, string, string]
    await g.write(grid(['Creme']), grid(['Lotion', 'Salbe']))
    await g.read(a, 0)
    await g.claim(b, 0, [1])
    await g.object(a, b)
    await g.vote(c, false)
    await expect(g.claim(b, 0, [1])).rejects.toThrow('claim_rejected')
    // The same circle without crossing out the second one is a different claim.
    await g.claim(b, 0)
    expect(await g.claimOf(b)).toMatchObject({ cell: 0, also: [] })
  })

  it('refuses an objection against an outdated claim', async () => {
    const g = await claimed()
    const [, b, c] = g.users as [string, string, string]
    const { rev } = await g.claimOf(b)
    await g.claim(b, 1)
    await expect(g.act(c, 'object', b, rev)).rejects.toThrow('claims_changed')
  })

  it('lets the host close a vote after a while', async () => {
    const g = await claimed()
    const [a, b, c] = g.users as [string, string, string]
    await g.object(c, b)
    const no = (await g.state()).objection.no
    await expect(g.act(a, 'close_vote', no)).rejects.toThrow('too_early')
    await expect(g.act(c, 'close_vote', no)).rejects.toThrow('not_host')
    await g.wait()
    await g.act(a, 'close_vote', no)
    // Only the objection itself counts: rejected.
    expect(await g.claimOf(b)).toMatchObject({ cell: null })
    await expect(g.act(a, 'vote', no, true)).rejects.toThrow('wrong_phase')
  })
})

describe('rounds and points', () => {
  /** Reads every answer of users[0]; the others hold what `others` gives them. */
  async function playRound(g: Awaited<ReturnType<typeof startGame>>, n = 9) {
    for (let cell = 0; cell < n; cell++) {
      await g.read(g.users[0]!, cell)
      await g.confirm()
    }
  }

  it('ends as soon as somebody has no open answer, and counts bonuses', async () => {
    const g = await startGame(4)
    const [a, b, c, d] = g.users as [string, string, string, string]
    const mine = grid()
    // b matches the top row and the right column; c matches the top row.
    const other = (cells: number[]) => grid(mine.map((w, i) => (cells.includes(i) ? w : undefined)))
    await g.write(mine, other([0, 1, 2, 5, 8]), other([0, 1, 2]), grid())
    await playRound(g)
    const game = await g.state()
    expect(game.phase).toBe('round_end')
    // a: 5 circles, 2 stars (cells 5 and 8), top row 3 + right column 3.
    expect(game.summary[a]).toMatchObject({
      circles: 5, stars: 2, star_points: 4, bonus: 6, points: 15,
    })
    expect(game.summary[b]).toMatchObject({ points: 15 })
    expect(game.summary[c]).toMatchObject({ circles: 3, stars: 0, bonus: 3, points: 6 })
    expect(game.summary[d]).toMatchObject({ points: 0 })
    // Now everybody sees all grids. Open answers stay open and score nothing.
    expect(game.summary[d].cells).toHaveLength(9)
    expect(game.summary[b].cells.filter((x: any) => x.state === 'open')).toHaveLength(4)
    expect((await g.snap(d)).scores[a]).toEqual({ score: 15, best_round: 15 })
  })

  it('scores the bonus lines 3, 2, 1 from the top and 1, 2, 3 from the left', async () => {
    const lines: [number[], number][] = [
      [[0, 1, 2], 3], [[3, 4, 5], 2], [[6, 7, 8], 1],
      [[0, 3, 6], 1], [[1, 4, 7], 2], [[2, 5, 8], 3],
      [[0, 4, 8], 0],
    ]
    for (const [cells, bonus] of lines) {
      const g = await startGame(3)
      const mine = grid()
      const same = grid(mine.map((w, i) => (cells.includes(i) ? w : undefined)))
      await g.write(mine, same, same.map((w, i) => (cells.includes(i) ? w : `${w}x`)))
      await playRound(g)
      expect((await g.state()).summary[g.users[0]!].bonus).toBe(bonus)
    }
  })

  it('counts a star as 1 point when the round starts with three players', async () => {
    const g = await startGame(3)
    await g.write(grid(['Apfel']), grid(['Apfel']))
    await playRound(g)
    expect((await g.state()).summary[g.users[0]!]).toMatchObject({
      circles: 1, stars: 1, star_points: 1, points: 2,
    })
  })

  it('plays three rounds, with the lowest total reading first', async () => {
    const g = await startGame(4)
    const [a, b, c, d] = g.users as [string, string, string, string]
    for (let round = 1; round <= 3; round++) {
      expect(await g.state()).toMatchObject({ round_no: round, category_no: 1 })
      await g.write(grid(['Apfel', 'Birne']), grid(['Apfel', 'Birne']), grid(['Apfel']), grid())
      if (round > 1) expect((await g.state()).reader_id).toBe(d)
      await playRound(g)
      expect((await g.state()).phase).toBe('round_end')
      await expect(g.act(b, 'next_round')).rejects.toThrow('not_host')
      await g.act(a, 'next_round')
    }
    expect((await g.state()).phase).toBe('game_over')
    expect((await t.call(a, 'room_snapshot', g.code)).room.status).toBe('finished')
    // Per round: Apfel (3 people) and Birne (2, a star).
    expect((await g.snap()).scores).toEqual({
      [a]: { score: 12, best_round: 4 },
      [b]: { score: 12, best_round: 4 },
      [c]: { score: 3, best_round: 1 },
      [d]: { score: 0, best_round: 0 },
    })
  })
})

describe('people going offline or leaving', () => {
  it('goes on without offline writers, whose missing answers cannot end the round', async () => {
    const g = await startGame(3)
    const [a, b, c] = g.users as [string, string, string]
    const grids = { [a]: grid(), [b]: grid(), [c]: grid() }
    // c misses all three categories.
    for (let i = 0; i < 3; i++) {
      await g.choose()
      await g.writeCategory(grids, [c])
      await t.call(c, 'heartbeat', g.roomId)
      await expect(g.act(a, 'force_continue')).rejects.toThrow('players_still_here')
      await g.goOffline([c])
      await expect(g.act(b, 'force_continue')).rejects.toThrow('not_host')
      await g.act(a, 'force_continue')
    }
    // c has nothing open, which doesn't end the round or give c a turn.
    expect((await g.state()).phase).toBe('reveal')
    expect([a, b]).toContain((await g.state()).reader_id)
  })

  it('skips an offline chooser or reader, only if really offline', async () => {
    const g = await startGame(4)
    const [a] = g.users as [string]
    let game = await g.state()
    // Make sure the one who is away is not the host.
    const away = g.users[1]!
    await t.db.query('update public.dito_games set chooser_id = $2 where room_id = $1', [
      g.roomId, away,
    ])
    await t.db.query('update public.dito_choices set chooser_id = $2 where room_id = $1', [
      g.roomId, away,
    ])
    await expect(g.act(a, 'skip')).rejects.toThrow('players_still_here')
    await g.goOffline([away])
    await g.act(a, 'skip')
    expect((await g.state()).chooser_id).toBe(g.users[2])

    await g.write()
    await g.turnOf(away)
    await g.goOffline([away])
    await g.act(a, 'skip')
    game = await g.state()
    expect(game.reader_id).toBe(g.users[2])
  })

  it('counts identical answers of offline players, and lets the host press "Weiter"', async () => {
    const g = await startGame(3)
    const [a, b, c] = g.users as [string, string, string]
    await g.write(grid(), grid(['Apfel']), grid(['Apfel']))
    await g.read(b, 0)
    await expect(g.confirm(a)).rejects.toThrow('players_still_here')
    await g.goOffline([b, c])
    await g.confirm(a)
    expect(await g.marks(c)).toEqual({ 0: 'circled*' })
  })

  it('moves on when the reader leaves', async () => {
    const g = await startGame(4)
    const [a, b, c] = g.users as [string, string, string]
    await g.write(grid(), grid(['Apfel']), grid(['Apfel']))
    await g.read(b, 0)
    await t.call(b, 'leave_room', g.roomId)
    expect(await g.state()).toMatchObject({ phase: 'reveal', reader_id: c, read_cell: null })
    expect((await g.snap(a)).claims).toEqual([])
    expect(await g.marks(c)).toEqual({})
  })

  it('finishes writing and votes when the missing person leaves', async () => {
    const g = await startGame(4)
    const [a, b, c, d] = g.users as [string, string, string, string]
    await g.choose()
    await g.writeCategory(Object.fromEntries(g.users.map((u) => [u, grid()])), [d])
    await t.call(d, 'leave_room', g.roomId)
    expect(await g.state()).toMatchObject({ phase: 'choosing', category_no: 2 })

    const h = await startGame(4)
    const [e, f, i, j] = h.users as [string, string, string, string]
    await h.write(grid(['Violine']), grid(['Geige']))
    await h.read(e, 0)
    await h.claim(f, 0)
    await h.object(i, f)
    await h.vote(e, true)
    await t.call(j, 'leave_room', h.roomId)
    expect((await h.state()).objection).toBeNull()
    expect(await h.claimOf(f)).toMatchObject({ cell: 0, settled: true })
  })

  it('drops an objection when the player objected to leaves', async () => {
    const g = await startGame(4)
    const [a, b, c] = g.users as [string, string, string]
    await g.write(grid(['Violine']), grid(['Geige']))
    await g.read(a, 0)
    await g.claim(b, 0)
    await g.object(c, b)
    await t.call(b, 'leave_room', g.roomId)
    expect((await g.state()).objection).toBeNull()
    await g.confirm()
    expect(await g.marks(a)).toEqual({ 0: 'crossed' })
  })

  it('keeps the next pick in order when the last chooser leaves between rounds', async () => {
    const g = await startGame(4)
    const mine = grid()
    await g.write(mine, mine)
    for (let cell = 0; cell < 9; cell++) {
      await g.read(g.users[0]!, cell)
      await g.confirm()
    }
    const { chooser_id, order_ids } = await g.state()
    const next = order_ids[(order_ids.indexOf(chooser_id) + 1) % 4]
    if (chooser_id === g.host) return
    await t.call(chooser_id, 'leave_room', g.roomId)
    await g.act(g.host, 'next_round')
    expect((await g.state()).chooser_id).toBe(next)
  })

  it('ends the game below three players', async () => {
    const g = await startGame(3)
    await t.call(g.users[2]!, 'leave_room', g.roomId)
    expect((await g.state()).phase).toBe('game_over')
    expect((await t.call(g.host, 'room_snapshot', g.code)).room.status).toBe('finished')
  })
})

describe('outsiders', () => {
  it('see nothing and can do nothing', async () => {
    const g = await startGame(3)
    await g.write()
    const outsider = randomUUID()
    expect(await t.call(outsider, 'dito_snapshot', g.roomId)).toBeNull()
    for (const table of ['dito_games', 'dito_answers', 'dito_claims', 'dito_scores']) {
      expect(await t.as(outsider, `select * from public.${table}`)).toEqual([])
    }
    const { step } = await g.state()
    await expect(t.call(outsider, 'dito_read', g.roomId, step, 0)).rejects.toThrow('not_in_room')
    await expect(t.as(g.host, 'select * from private.dito_cards')).rejects.toThrow(
      'permission denied',
    )
  })
})
