import type { RawJob } from '../../../shared/types'
import { countriesIn, countryCode } from '../location'
import { employmentFrom } from './employment'
import { getText } from './http'
import type { Reader } from './types'
import { parseFeed, str, strings, unique } from './util'

const PAGE_SIZE = 10
/** A board with more positions than this is read in part. */
const MAX_JOBS = 2000

/**
 * The countries of one place text. Its last part decides when it is a country name or code ("Sudbury, On, CA" is
 * Canada and "Canaã dos Carajás, PA, Brasil" is Brazil, though CA and PA are also US states); otherwise the shared
 * reading of the whole text.
 */
function countriesOf(place: string): string[] {
  const last = place.slice(place.lastIndexOf(',') + 1)
  const code = countryCode(last)
  return code ? [code] : countriesIn(place)
}

/** The places of a position; a bare country is dropped when another place is in that country. */
function placesOf(p: Record<string, unknown>): string[] {
  const all = unique(strings(p.locations))
  if (all.length === 0 && str(p.location) !== '') all.push(str(p.location))
  const bare = (place: string): boolean => countryCode(place) !== null
  return all.filter(
    (place) =>
      !bare(place) ||
      !all.some((other) => !bare(other) && countriesOf(other).includes(countryCode(place)!))
  )
}

function toJob(p: Record<string, unknown>, host: string): RawJob {
  const id = str(p.id)
  const title = str(p.name) || str(p.posting_name)
  const places = placesOf(p)
  const created = typeof p.t_create === 'number' ? new Date(p.t_create * 1000) : null
  return {
    sourceId: id,
    title,
    location: places.join(' | '),
    countries: unique(places.flatMap(countriesOf)),
    employment: employmentFrom(title),
    url: str(p.canonicalPositionUrl) || `https://${host}/careers/job/${id}`,
    postedAt: created && !Number.isNaN(created.getTime()) ? created.toISOString() : null,
    postedRough: false,
    needsDetails: false
  }
}

/** Board: host|domain of an Eightfold careers site, such as vale.eightfold.ai|vale.com. */
export const eightfold: Reader = {
  async list(fetcher, board) {
    const bar = board.indexOf('|')
    const host = board.slice(0, bar)
    const domain = board.slice(bar + 1)
    const jobs: RawJob[] = []
    let count = 0
    for (let start = 0; start === 0 || (start < count && start < MAX_JOBS); start += PAGE_SIZE) {
      const url = `https://${host}/api/apply/v2/jobs?domain=${encodeURIComponent(domain)}&start=${start}&num=${PAGE_SIZE}`
      const data = parseFeed(await getText(fetcher, url), url) as Record<string, unknown> | null
      const rows = data?.positions
      if (!Array.isArray(rows)) throw new Error(`Job list not recognised on ${url}`)
      // Only the first page's count counts; rows without a believable count could be any part of the list.
      if (start === 0) {
        const c = data?.count
        count = typeof c === 'number' && Number.isFinite(c) ? c : -1
        if (count < rows.length) throw new Error(`Job list not recognised on ${url}`)
      }
      // The loop only continues while the count says there is more, so an empty page is a broken read.
      if (rows.length === 0 && count > 0) throw new Error(`Job list not recognised on ${url}`)
      for (const row of rows) {
        if (typeof row === 'object' && row !== null)
          jobs.push(toJob(row as Record<string, unknown>, host))
      }
    }
    const capped = count > MAX_JOBS
    return {
      jobs,
      complete: !capped,
      note: capped ? `Eightfold: only the first ${MAX_JOBS} jobs were read` : null
    }
  }
}
