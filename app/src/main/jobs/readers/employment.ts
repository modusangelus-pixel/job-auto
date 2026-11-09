import type { Employment } from '../../../shared/types'

/**
 * The job type from a site's text. Full-time words beat contract words ("Permanent contract" is full-time), and
 * text naming both full-time and part-time ("Full-time or part-time") is full-time. "Intern" is a whole word, so
 * "International" and "Internal" are not internships.
 */
export function employmentFrom(text: string | null | undefined): Employment {
  const t = text ?? ''
  if (/\bintern(s|ship|ships)?\b|trainee program|working student|werkstudent/i.test(t))
    return 'intern'
  const fullTime = /full[- ]?time/i.test(t)
  if (/part[- ]?time/i.test(t) && !fullTime) return 'part_time'
  if (fullTime || /permanent|regular/i.test(t)) return 'full_time'
  if (/contract|temporary|fixed[- ]?term|freelance/i.test(t)) return 'fixed_term'
  return 'unknown'
}
