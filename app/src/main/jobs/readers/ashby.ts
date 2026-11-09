import { countriesIn } from '../location'
import { employmentFrom } from './employment'
import { getText } from './http'
import type { Reader } from './types'
import { codesFrom, isoDate, parseFeed, str, unique } from './util'

export const ashby: Reader = {
  async list(fetcher, board) {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=false`
    const data = parseFeed(await getText(fetcher, url), url)
    const list = (data as { jobs?: unknown } | null)?.jobs
    if (!Array.isArray(list)) throw new Error(`Job list not recognised on ${url}`)
    const jobs = (list as Record<string, unknown>[])
      .filter((j) => j.isListed !== false)
      .map((j) => {
        const secondary = Array.isArray(j.secondaryLocations)
          ? (j.secondaryLocations as Record<string, unknown>[]).map((s) => str(s?.location))
          : []
        const places = unique([str(j.location), ...secondary].filter((s) => s !== ''))
        const postal = (j.address as { postalAddress?: { addressCountry?: unknown } } | undefined)
          ?.postalAddress
        return {
          sourceId: str(j.id),
          title: str(j.title),
          location: places.join('; '),
          countries: unique([
            ...codesFrom([postal?.addressCountry]),
            ...places.flatMap((p) => countriesIn(p))
          ]),
          employment: employmentFrom(str(j.employmentType)),
          url: str(j.jobUrl),
          postedAt: isoDate(j.publishedAt),
          postedRough: false,
          needsDetails: false
        }
      })
    return { jobs, complete: true, note: null }
  }
}
