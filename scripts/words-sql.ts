import { CATEGORIES_DE } from '../src/games/imposter/words.de.ts'
import { ALL_WORDS_DE } from '../src/games/just-one/words.de.ts'

const quote = (text: string) => `'${text.replaceAll("'", "''")}'`

/** SQL that makes the Just One word pool in the database match words.de.ts. */
export function justOneWordsSql(): string {
  const rows = ALL_WORDS_DE.map((w) => `  (${quote(w)})`).join(',\n')
  return [
    '-- Generated from src/games/just-one/words.de.ts by `npm run words`. Do not edit.',
    'delete from private.just_one_words;',
    'insert into private.just_one_words (word) values',
    `${rows};`,
    '',
  ].join('\n')
}

/** The same for the Imposter word grids. */
export function imposterWordsSql(): string {
  const rows = Object.entries(CATEGORIES_DE)
    .map(([name, words]) => `  (${quote(name)}, array[${words.map(quote).join(', ')}])`)
    .join(',\n')
  return [
    '-- Generated from src/games/imposter/words.de.ts by `npm run words`. Do not edit.',
    'delete from private.imposter_categories;',
    'insert into private.imposter_categories (name, words) values',
    `${rows};`,
    '',
  ].join('\n')
}

/** Migration name suffix -> SQL */
export const WORD_MIGRATIONS = {
  just_one_words: justOneWordsSql,
  imposter_words: imposterWordsSql,
}
