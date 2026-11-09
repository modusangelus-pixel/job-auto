import type { RawJob } from '../../../shared/types'
import { employmentFrom } from './employment'
import { getText } from './http'
import type { Reader } from './types'
import { codesFrom, isoDate, jsonAt, str } from './util'

/** Where the page's script sets the list: `COMPANY_POSITIONS_DATA = [` (its earlier `var …;` has no `=`). */
const DATA = /COMPANY_POSITIONS_DATA\s*=\s*\[/

const names = new Intl.DisplayNames(['en'], { type: 'region' })

function toJob(p: Record<string, unknown>, pageUrl: string): RawJob {
  const title = str(p.name)
  const loc = (typeof p.location === 'object' && p.location !== null ? p.location : {}) as Record<
    string,
    unknown
  >
  const countries = codesFrom([loc.country])
  const place = str(loc.name) || str(loc.city)
  const location = [place, ...countries.map((c) => names.of(c) ?? c)]
    .filter((s) => s !== '')
    .join(', ')
  const type = employmentFrom(str(p.employment_type))
  return {
    sourceId: str(p.uid),
    title,
    location,
    countries,
    employment: type !== 'unknown' ? type : employmentFrom(title),
    url: str(p.url_comeet_hosted_page) || pageUrl,
    // Comeet gives only when the position was last updated.
    postedAt: isoDate(p.time_updated),
    postedRough: false,
    needsDetails: false
  }
}

/** Board: slug/uid of a Comeet careers page, which carries every open position in its script. */
export const comeet: Reader = {
  async list(fetcher, board) {
    const url = `https://www.comeet.com/jobs/${board}`
    const html = await getText(fetcher, url)
    const at = DATA.exec(html)
    const data = at ? jsonAt(html, at.index + at[0].length - 1) : null
    if (!Array.isArray(data)) throw new Error(`Job list not recognised on ${url}`)
    const jobs = data
      .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
      .map((p) => toJob(p, url))
      .filter((j) => j.sourceId !== '' && j.title !== '')
    return { jobs, complete: true, note: null }
  }
}
