import { cleanName, LEGAL_SUFFIXES } from '../../shared/cleanName'

export { cleanName }

// Tokens a list may add after a company's own name (a country, a group word) and still be that company; legal-form
// words may come there too ("Intel Corporation (UK) Ltd" is Intel).
const EXTRA_TOKENS = new Set(
  (
    'uk gb great britain united kingdom england scotland nederland netherlands holland benelux danmark ' +
    'denmark nordic nordics canada international europe group holding holdings'
  ).split(' ')
)

/** Whether a list entry (both names already cleaned) is the company. */
export function matchesCompany(listNorm: string, companyNorm: string): boolean {
  if (companyNorm.length < 3) return false
  if (listNorm === companyNorm) return true
  if (!listNorm.startsWith(companyNorm + ' ')) return false
  return listNorm
    .slice(companyNorm.length + 1)
    .split(' ')
    .every((t) => EXTRA_TOKENS.has(t) || LEGAL_SUFFIXES.has(t))
}
