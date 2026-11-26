// Usage: npm run words
// Writes a new migration for each word list that differs from its latest one.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { WORD_MIGRATIONS } from './words-sql.ts'

const dir = new URL('../supabase/migrations/', import.meta.url)

for (const [suffix, generate] of Object.entries(WORD_MIGRATIONS)) {
  const latest = readdirSync(dir).filter((f) => f.endsWith(`_${suffix}.sql`)).sort().at(-1)
  const sql = generate()

  if (latest && readFileSync(new URL(latest, dir), 'utf8') === sql) {
    console.log(`Unchanged: ${latest}`)
    continue
  }
  // Same naming scheme as the Supabase CLI: <UTC timestamp>_<name>.sql
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const name = `${stamp}_${suffix}.sql`
  writeFileSync(new URL(name, dir), sql)
  console.log(`Created supabase/migrations/${name}`)
}
