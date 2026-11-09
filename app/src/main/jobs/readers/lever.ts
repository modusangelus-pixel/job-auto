import { countriesIn } from '../location'
import type { RawJob } from '../../../shared/types'
import { employmentFrom } from './employment'
import { getText } from './http'
import type { Reader } from './types'
import { codesFrom, isoDate, parseFeed, str, strings, unique } from './util'

const PAGE_SIZE = 100
const MAX_PAGES = 100

export const lever: Reader = {
  async list(fetcher, board) {
    const eu = board.startsWith('eu:')
    const host = eu ? 'api.eu.lever.co' : 'api.lever.co'
    const name = eu ? board.slice(3) : board
    const jobs: RawJob[] = []
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `https://${host}/v0/postings/${name}?mode=json&limit=${PAGE_SIZE}&skip=${page * PAGE_SIZE}`
      const data = parseFeed(await getText(fetcher, url), url)
      if (!Array.isArray(data)) throw new Error(`Job list not recognised on ${url}`)
      for (const j of data as Record<string, unknown>[]) {
        const cat = (j.categories ?? {}) as Record<string, unknown>
        const places = unique(
          [str(cat.location), ...strings(cat.allLocations)].filter((s) => s !== '')
        )
        jobs.push({
          sourceId: str(j.id),
          title: str(j.text),
          location: places.join('; '),
          countries: unique([...codesFrom([j.country]), ...places.flatMap((p) => countriesIn(p))]),
          employment: employmentFrom(str(cat.commitment)),
          url: str(j.hostedUrl),
          postedAt: isoDate(j.createdAt),
          postedRough: false,
          needsDetails: false
        })
      }
      if (data.length < PAGE_SIZE) return { jobs, complete: true, note: null }
    }
    return { jobs, complete: false, note: `Stopped after ${MAX_PAGES} pages` }
  }
}
