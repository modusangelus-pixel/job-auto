import type { RawJob } from '../../../shared/types'
import { countriesIn } from '../location'
import { employmentFrom } from './employment'
import { getText } from './http'
import type { Reader } from './types'
import { decode, htmlText } from './util'

/** A board with more pages than this is read in part. */
const MAX_PAGES = 50

const CARD = /<li class="iCIMS_JobCardItem">([\s\S]*?)<\/li>/g
const LINK = /<a\s[^>]*href="([^"]+)"[^>]*class="iCIMS_Anchor"[^>]*>([\s\S]*?)<\/a>/
const HEADING = /<h3[^>]*>([\s\S]*?)<\/h3>/
const LOCATION = /Job Locations<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/
const PAGES = /of\s+(\d+)\s*,\s*Current Page/
const NO_JOBS = /no jobs were found/i

const names = new Intl.DisplayNames(['en'], { type: 'region' })

/**
 * iCIMS writes a place as country-region-city ("US-WI-New Berlin", "IE-Dublin"); turned round into
 * "New Berlin, WI, United States" so the country and the city can be found. The city keeps any hyphens of its own
 * (Winston-Salem). Places are split on "|". Text in another form is kept as it is.
 */
function locationOf(text: string): string {
  return text
    .split('|')
    .map((place) => {
      const p = place.trim()
      const m = /^([A-Z]{2})-(.+)$/.exec(p)
      if (!m) return p
      const country = names.of(m[1]) ?? m[1]
      const rest = m[2].split('-')
      const parts = rest.length > 1 ? [rest.slice(1).join('-'), rest[0]] : rest
      return [...parts.map((s) => s.trim()), country].join(', ')
    })
    .join(' | ')
}

/** The job's link without in_iframe, so it opens the full page. */
function linkOf(href: string): URL {
  const url = new URL(decode(href))
  url.searchParams.delete('in_iframe')
  return url
}

function toJob(card: string, host: string, pageUrl: string): RawJob {
  const link = LINK.exec(card)
  const url = link ? linkOf(link[1]) : null
  const id = url ? /^\/jobs\/(\d+)\//.exec(url.pathname)?.[1] : undefined
  if (!link || !url || !id) throw new Error(`Job list not recognised on ${pageUrl}`)
  const title = htmlText(HEADING.exec(link[2])?.[1] ?? link[2])
  const location = locationOf(htmlText(LOCATION.exec(card)?.[1] ?? ''))
  return {
    // A hub board links to jobs on its sister hosts, whose ids are their own.
    sourceId: url.hostname === host ? id : `${url.hostname}/${id}`,
    title,
    location,
    countries: countriesIn(location),
    employment: employmentFrom(title),
    url: url.toString(),
    postedAt: null,
    postedRough: false,
    needsDetails: false
  }
}

/** Board: the iCIMS host, such as careers-rws.icims.com. Pages are read until the paginator's last. */
export const icims: Reader = {
  async list(fetcher, board) {
    const jobs: RawJob[] = []
    let pages = 1
    let n = 0
    for (; n < pages && n < MAX_PAGES; n++) {
      const url = `https://${board}/jobs/search?ss=1&in_iframe=1&pr=${n}`
      const html = await getText(fetcher, url)
      const cards = [...html.matchAll(CARD)].map((m) => m[1])
      if (cards.length === 0) {
        if (n === 0 && NO_JOBS.test(html)) return { jobs: [], complete: true, note: null }
        throw new Error(`Job list not recognised on ${url}`)
      }
      if (n === 0) pages = Number(PAGES.exec(html)?.[1] ?? 1)
      for (const card of cards) jobs.push(toJob(card, board, url))
    }
    const capped = pages > MAX_PAGES
    return {
      jobs,
      complete: !capped,
      note: capped ? `iCIMS: only the first ${MAX_PAGES} pages were read` : null
    }
  }
}
