import { ALL_WORDS_DE } from '../src/games/just-one/words.de.ts'

/** SQL that makes the word pool in the database match words.de.ts. */
export function wordsSql(): string {
  const rows = ALL_WORDS_DE.map((w) => `  ('${w.replaceAll("'", "''")}')`).join(',\n')
  return [
    '-- Generated from src/games/just-one/words.de.ts by `npm run words`. Do not edit.',
    'delete from private.just_one_words;',
    'insert into private.just_one_words (word) values',
    `${rows};`,
    '',
  ].join('\n')
}
