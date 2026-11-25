// Usage: npm run words
// Writes a new migration if the word list differs from the latest word migration.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { wordsSql } from './words-sql.ts'

const dir = new URL('../supabase/migrations/', import.meta.url)
const latest = readdirSync(dir).filter((f) => f.endsWith('_just_one_words.sql')).sort().at(-1)
const sql = wordsSql()

if (latest && readFileSync(new URL(latest, dir), 'utf8') === sql) {
  console.log(`Word list unchanged (${latest}).`)
} else {
  // Same naming scheme as the Supabase CLI: <UTC timestamp>_<name>.sql
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const name = `${stamp}_just_one_words.sql`
  writeFileSync(new URL(name, dir), sql)
  console.log(`Created supabase/migrations/${name}`)
}
