import { foldText } from './fold'

/** Legal-form words (Ltd, AB, A/S ...): dropped from the end of a name, and allowed after a company's own name. */
export const LEGAL_SUFFIXES = new Set(
  (
    'limited ltd plc llp lp inc incorporated llc corp corporation co company gmbh mbh ag se sa sas sarl spa ' +
    'srl bv nv ab publ as aps asa oy oyj kg kgaa pty pte ulc'
  ).split(' ')
)

/** Folds a company name, drops a leading "the" and legal-form endings (Ltd, AB, A/S ...) so lists and companies compare. */
export function cleanName(name: string): string {
  const tokens = foldText(name)
    .replace(/&/g, ' and ')
    .replace(/[./]/g, '')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(' ')
    .filter((t) => t !== '')
  if (tokens[0] === 'the') tokens.shift()
  while (tokens.length > 0 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop()
  return tokens.join(' ')
}
