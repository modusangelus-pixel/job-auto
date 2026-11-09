import { foldText } from '../../shared/fold'

const BASE = 'https://www.linkedin.com/search/results/people/?keywords='

// The first of these found in a folded title names the field. Each spelling starts a word (Exchange is not change);
// program is a whole word, since a Programmer is not in program management.
const FIELDS: { field: string; pattern: RegExp }[] = [
  { field: 'project', pattern: /\bproje/ },
  { field: 'program', pattern: /\bprogram(me)?s?\b|\bpmo\b/ },
  { field: 'quality', pattern: /\bquality|\bkalite/ },
  { field: 'change', pattern: /\bchange|\bdegisim/ },
  { field: 'process', pattern: /\bprocess|\bsurec/ }
]

const search = (label: string, query: string): { label: string; url: string } => ({
  label,
  url: BASE + encodeURIComponent(query)
})

/** LinkedIn people searches, to open in the owner's browser: recruiters, the likely hiring field, the city. */
export function linkedInSearches(
  companyName: string,
  title: string,
  city: string | null
): { label: string; url: string }[] {
  const folded = foldText(title)
  const field = FIELDS.find((f) => f.pattern.test(folded))?.field
  // The tracker name may carry a short form in brackets: Mobile Industrial Robots (MiR).
  const company =
    companyName
      .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || companyName
  const searches = [search('Recruiters', `"${company}" recruiter`)]
  searches.push(
    field === undefined
      ? search('Hiring managers', `"${company}" hiring manager`)
      : search(
          `${field[0].toUpperCase()}${field.slice(1)} managers`,
          `"${company}" ${field} manager`
        )
  )
  if (city !== null) searches.push(search(`People in ${city}`, `"${company}" ${city}`))
  return searches
}
