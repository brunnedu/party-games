// Guards what clients can reach, across all migrations. A new migration that
// opens something up fails here.
import { beforeAll, describe, expect, it } from 'vitest'
import { createDatabase, type TestDb } from './harness'

let t: TestDb
beforeAll(async () => {
  t = await createDatabase()
}, 60_000)

async function names(sql: string) {
  const { rows } = await t.db.query<{ name: string }>(sql)
  return rows.map((r) => r.name).sort()
}

const OUR_FUNCTIONS = `
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')`

const OUR_TABLES = `
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'f')`

describe('database permissions', () => {
  it('lets signed-out visitors run no function', async () => {
    expect(
      await names(`select n.nspname || '.' || p.proname as name ${OUR_FUNCTIONS}
        and has_function_privilege('anon', p.oid, 'execute')`),
    ).toEqual([])
  })

  // Anyone can sign in anonymously, so this is what the public could reach if
  // "private" were ever exposed through the API.
  it('lets signed-in players run only the membership check in "private"', async () => {
    expect(
      await names(`select p.proname as name ${OUR_FUNCTIONS}
        and n.nspname = 'private'
        and has_function_privilege('authenticated', p.oid, 'execute')`),
    ).toEqual(['is_member'])
  })

  it('fixes the search path of every security definer function', async () => {
    expect(
      await names(`select n.nspname || '.' || p.proname as name ${OUR_FUNCTIONS}
        and p.prosecdef
        and not exists (select 1 from unnest(p.proconfig) setting
                        where setting like 'search_path=%')`),
    ).toEqual([])
  })

  it('has row level security on every table', async () => {
    expect(
      await names(`select n.nspname || '.' || c.relname as name ${OUR_TABLES}
        and c.relkind in ('r', 'p') and not c.relrowsecurity`),
    ).toEqual([])
  })

  it('gives signed-out visitors no access to any table', async () => {
    expect(
      await names(`select n.nspname || '.' || c.relname as name ${OUR_TABLES}
        and (has_table_privilege('anon', c.oid,
               'select, insert, update, delete, truncate, references, trigger')
             or has_any_column_privilege('anon', c.oid,
               'select, insert, update, references'))`),
    ).toEqual([])
  })

  it('lets signed-in players only read, and nothing in "private"', async () => {
    expect(
      await names(`select n.nspname || '.' || c.relname as name ${OUR_TABLES}
        and (has_table_privilege('authenticated', c.oid,
               'insert, update, delete, truncate, references, trigger')
             or has_any_column_privilege('authenticated', c.oid,
               'insert, update, references')
             or (n.nspname = 'private'
                 and (has_table_privilege('authenticated', c.oid, 'select')
                      or has_any_column_privilege('authenticated', c.oid, 'select'))))`),
    ).toEqual([])
  })
})
