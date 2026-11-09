import { decode } from '../jobs/readers/util'

/** The text of an HTML fragment: tags removed, entities decoded, non-breaking and repeated spaces collapsed. */
export function cellText(html: string): string {
  return decode(html.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

/** Entries with an empty name dropped and each name kept once, in list order. */
export function uniqueNamed<T extends { name: string }>(entries: T[]): T[] {
  const seen = new Set<string>()
  return entries.filter((e) => {
    if (e.name === '' || seen.has(e.name)) return false
    seen.add(e.name)
    return true
  })
}
