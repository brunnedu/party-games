import { ditoCards } from '../src/games/dito/categories.de.ts'
import { CATEGORIES_DE } from '../src/games/imposter/words.de.ts'
import { ALL_WORDS_DE } from '../src/games/just-one/words.de.ts'
import { SENTENCES_DE } from '../src/games/walter/sentences.de.ts'
import { PAIRS_DE } from '../src/games/wavelength/pairs.de.ts'

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

/** The same for the Wavelength scales. */
export function wavelengthPairsSql(): string {
  const rows = PAIRS_DE.map(([l, r]) => `  (${quote(l)}, ${quote(r)})`).join(',\n')
  return [
    '-- Generated from src/games/wavelength/pairs.de.ts by `npm run words`. Do not edit.',
    'delete from private.wavelength_pairs;',
    'insert into private.wavelength_pairs (left_label, right_label) values',
    `${rows};`,
    '',
  ].join('\n')
}

/** The same for the sentences of "Der wahre Walter". */
export function walterSentencesSql(): string {
  const rows = SENTENCES_DE.map((text) => `  (${quote(text)})`).join(',\n')
  return [
    '-- Generated from src/games/walter/sentences.de.ts by `npm run words`. Do not edit.',
    'delete from private.walter_sentences;',
    'insert into private.walter_sentences (sentence) values',
    `${rows};`,
    '',
  ].join('\n')
}

/** The same for the category cards of "Dito!". */
export function ditoCardsSql(): string {
  const rows = ditoCards()
    .map(([a, b]) => `  (${quote(a)}, ${quote(b)})`)
    .join(',\n')
  return [
    '-- Generated from src/games/dito/categories.de.ts by `npm run words`. Do not edit.',
    'delete from private.dito_cards;',
    'insert into private.dito_cards (category_a, category_b) values',
    `${rows};`,
    '',
  ].join('\n')
}

/** Migration name suffix -> SQL */
export const WORD_MIGRATIONS = {
  just_one_words: justOneWordsSql,
  imposter_words: imposterWordsSql,
  wavelength_pairs: wavelengthPairsSql,
  walter_sentences: walterSentencesSql,
  dito_cards: ditoCardsSql,
}
