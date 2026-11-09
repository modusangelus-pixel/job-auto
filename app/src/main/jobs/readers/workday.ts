import type { RawJob } from '../../../shared/types'
import { countriesIn } from '../location'
import { employmentFrom } from './employment'
import { getText, postJson } from './http'
import type { Reader } from './types'
import { codesFrom, isoDate, parseFeed, str, strings, unique } from './util'

const PAGE_SIZE = 20
/** Workday does not serve rows past this offset. */
const MAX_JOBS = 2000

interface Board {
  host: string
  tenant: string
  site: string
  /** Where the job links start: a job's externalPath follows it. */
  page: string
}

/**
 * 'abb.wd3/External_Career_Page' → host abb.wd3.myworkdayjobs.com, tenant abb, site External_Career_Page.
 * 'wd3.myworkdaysite.com/magna/Magna' (the site form) → host wd3.myworkdaysite.com, tenant magna, site Magna.
 */
function parseBoard(board: string): Board {
  const parts = board.split('/')
  if (parts.length === 3) {
    const [host, tenant, site] = parts
    return { host, tenant, site, page: `https://${host}/recruiting/${tenant}/${site}` }
  }
  const slash = board.indexOf('/')
  const system = board.slice(0, slash)
  const host = `${system}.myworkdayjobs.com`
  const site = board.slice(slash + 1)
  return { host, tenant: system.split('.')[0], site, page: `https://${host}/${site}` }
}

/**
 * The job's id: the requisition id after the last `_` of the path's last part when it has a digit
 * (`/job/Zurich/Project-Manager_JR00012345` → `JR00012345`), which stays when the title in the path is edited;
 * else the whole path.
 */
function sourceIdOf(externalPath: string): string {
  const last = externalPath.slice(externalPath.lastIndexOf('/') + 1)
  const underscore = last.lastIndexOf('_')
  const requisition = underscore < 0 ? '' : last.slice(underscore + 1)
  return /\d/.test(requisition) ? requisition : externalPath
}

function localMidnight(now: Date, daysBack: number): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack).toISOString()
}

/** The date of a "Posted …" text, counting whole local days back from now. */
function posted(text: string, now: Date): { postedAt: string | null; postedRough: boolean } {
  const t = text.trim()
  if (/^posted today$/i.test(t)) return { postedAt: localMidnight(now, 0), postedRough: false }
  if (/^posted yesterday$/i.test(t)) return { postedAt: localMidnight(now, 1), postedRough: false }
  const m = /^posted (\d+)(\+)? days? ago$/i.exec(t)
  if (!m) return { postedAt: null, postedRough: false }
  return { postedAt: localMidnight(now, Number(m[1])), postedRough: m[2] === '+' }
}

export const workday: Reader = {
  async list(fetcher, board, now) {
    const { host, tenant, site, page: jobPage } = parseBoard(board)
    const url = `https://${host}/wday/cxs/${tenant}/${site}/jobs`
    const jobs: RawJob[] = []
    let total = 0
    for (
      let offset = 0;
      offset === 0 || (offset < total && offset < MAX_JOBS);
      offset += PAGE_SIZE
    ) {
      const data = await postJson(fetcher, url, {
        appliedFacets: {},
        limit: PAGE_SIZE,
        offset,
        searchText: ''
      })
      const page = (data as { total?: unknown; jobPostings?: unknown } | null)?.jobPostings
      if (!Array.isArray(page)) throw new Error(`Job list not recognised on ${url}`)
      // Only the first page reliably carries the total.
      if (offset === 0) {
        const t = (data as { total?: unknown }).total
        total = typeof t === 'number' && Number.isFinite(t) ? t : 0
        // Rows without a believable total could be any part of the list, so nothing is saved.
        if (page.length > 0 && total < page.length)
          throw new Error(`Job list not recognised on ${url}`)
      }
      // The loop only continues while total says there is more, so an empty page is a broken read.
      if (page.length === 0 && total > 0) throw new Error(`Job list not recognised on ${url}`)
      for (const row of page as Record<string, unknown>[]) {
        const location = str(row.locationsText)
        const path = str(row.externalPath)
        jobs.push({
          sourceId: sourceIdOf(path),
          title: str(row.title),
          location,
          countries: countriesIn(location),
          employment: 'unknown',
          url: `${jobPage}${path}`,
          ...posted(str(row.postedOn), now),
          needsDetails: true
        })
      }
    }
    const capped = total >= MAX_JOBS
    return {
      jobs,
      complete: !capped,
      note: capped ? `Workday shows only the first ${MAX_JOBS} jobs` : null
    }
  },

  async details(fetcher, board, job) {
    const { host, tenant, site, page } = parseBoard(board)
    // The detail request takes the job's path, which the link ends with (the id may be only part of it).
    if (!job.url.startsWith(`${page}/`)) throw new Error(`Job list not recognised on ${job.url}`)
    const url = `https://${host}/wday/cxs/${tenant}/${site}${job.url.slice(page.length)}`
    const data = parseFeed(await getText(fetcher, url), url)
    const info = (data as { jobPostingInfo?: unknown } | null)?.jobPostingInfo
    if (typeof info !== 'object' || info === null) {
      throw new Error(`Job list not recognised on ${url}`)
    }
    const i = info as Record<string, unknown>
    const requisition = (i.jobRequisitionLocation as { country?: { alpha2Code?: unknown } } | null)
      ?.country?.alpha2Code
    const countries = unique([
      ...codesFrom([requisition]),
      ...strings(i.additionalLocations).flatMap(countriesIn)
    ])
    return {
      ...job,
      countries: countries.length > 0 ? countries : job.countries,
      employment: employmentFrom(str(i.timeType)),
      postedAt: isoDate(i.startDate),
      needsDetails: false
    }
  }
}
