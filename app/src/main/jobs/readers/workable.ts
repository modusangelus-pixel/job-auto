import { countriesIn } from '../location'
import { employmentFrom } from './employment'
import { getText } from './http'
import type { Reader } from './types'
import { codesFrom, isoDate, parseFeed, str, unique } from './util'

export const workable: Reader = {
  async list(fetcher, board) {
    const url = `https://apply.workable.com/api/v1/widget/accounts/${board}`
    const data = parseFeed(await getText(fetcher, url), url)
    const list = (data as { jobs?: unknown } | null)?.jobs
    if (!Array.isArray(list)) throw new Error(`Job list not recognised on ${url}`)
    const jobs = (list as Record<string, unknown>[]).map((j) => {
      const location = [str(j.city), str(j.country)].filter((s) => s !== '').join(', ')
      const locations = Array.isArray(j.locations) ? (j.locations as Record<string, unknown>[]) : []
      return {
        sourceId: str(j.shortcode),
        title: str(j.title),
        location,
        countries: unique([
          ...codesFrom([j.country, ...locations.map((l) => l?.countryCode)]),
          ...countriesIn(location)
        ]),
        employment: employmentFrom(str(j.employment_type)),
        url: str(j.url),
        postedAt: isoDate(j.published_on),
        postedRough: false,
        needsDetails: false
      }
    })
    return { jobs, complete: true, note: null }
  }
}
