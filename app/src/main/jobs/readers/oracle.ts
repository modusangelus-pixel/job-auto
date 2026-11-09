import type { RawJob } from '../../../shared/types'
import { countriesIn } from '../location'
import { employmentFrom } from './employment'
import { getText } from './http'
import type { Reader } from './types'
import { codesFrom, isoDate, parseFeed, str } from './util'

const PAGE_SIZE = 25
/** A board with more jobs than this is read in part. */
const MAX_JOBS = 2000

/** 'hdjq.fa.us2.oraclecloud.com/CX_1' → host and site number. */
function parseBoard(board: string): { host: string; site: string } {
  const slash = board.indexOf('/')
  return { host: board.slice(0, slash), site: board.slice(slash + 1) }
}

const objects = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
    : []

function toJob(row: Record<string, unknown>, host: string, site: string): RawJob {
  const id = str(row.Id)
  const title = str(row.Title)
  const secondary = objects(row.secondaryLocations)
  const location = [str(row.PrimaryLocation), ...secondary.map((s) => str(s.Name))]
    .filter((s) => s !== '')
    .join(' | ')
  const codes = codesFrom([row.PrimaryLocationCountry, ...secondary.map((s) => s.CountryCode)])
  const schedule = employmentFrom(str(row.JobSchedule))
  return {
    sourceId: id,
    title,
    location,
    // The feed's own country codes; the location text only when it gives none.
    countries: codes.length > 0 ? codes : countriesIn(location),
    employment: schedule !== 'unknown' ? schedule : employmentFrom(title),
    url: `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${id}`,
    postedAt: isoDate(row.PostedDate),
    postedRough: false,
    needsDetails: false
  }
}

/** Board: host/siteNumber of an Oracle Recruiting Cloud candidate site, read from its public job search feed. */
export const oracle: Reader = {
  async list(fetcher, board) {
    const { host, site } = parseBoard(board)
    const jobs: RawJob[] = []
    let total = 0
    for (
      let offset = 0;
      offset === 0 || (offset < total && offset < MAX_JOBS);
      offset += PAGE_SIZE
    ) {
      const url =
        `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true` +
        `&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=${site},limit=${PAGE_SIZE},offset=${offset}`
      const data = parseFeed(await getText(fetcher, url), url)
      const search = objects((data as { items?: unknown } | null)?.items)[0]
      const rows = search?.requisitionList
      if (!search || !Array.isArray(rows)) throw new Error(`Job list not recognised on ${url}`)
      // Only the first page's total counts; rows without a believable total could be any part of the list.
      if (offset === 0) {
        const t = search.TotalJobsCount
        total = typeof t === 'number' && Number.isFinite(t) ? t : -1
        if (total < rows.length) throw new Error(`Job list not recognised on ${url}`)
      }
      // The loop only continues while the total says there is more, so an empty page is a broken read.
      if (rows.length === 0 && total > 0) throw new Error(`Job list not recognised on ${url}`)
      for (const row of objects(rows)) jobs.push(toJob(row, host, site))
    }
    const capped = total > MAX_JOBS
    return {
      jobs,
      complete: !capped,
      note: capped ? `Oracle: only the first ${MAX_JOBS} jobs were read` : null
    }
  }
}
