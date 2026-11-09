import { countriesIn } from '../location'
import type { RawJob } from '../../../shared/types'
import { getText } from './http'
import type { Reader } from './types'
import { isoDate, parseFeed, str } from './util'

const notRecognised = (url: string): Error => new Error(`Job list not recognised on ${url}`)

/** An EU board this long is a runaway read, as with Lever's cap. */
const MAX_EU_PAGES = 100

function row(j: Record<string, unknown>, location: string, posted: unknown): RawJob {
  return {
    sourceId: str(j.id),
    title: str(j.title),
    location,
    countries: countriesIn(location),
    employment: 'unknown',
    url: str(j.absolute_url),
    postedAt: isoDate(posted),
    postedRough: false,
    needsDetails: false
  }
}

function objects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    : []
}

/** The JSON object that starts at the first `{` after `"jobPosts":`, found by matching braces outside strings. */
function jobPostsIn(html: string): Record<string, unknown> | null {
  const marker = html.indexOf('"jobPosts":')
  if (marker < 0) return null
  const start = html.indexOf('{', marker)
  if (start < 0) return null
  let depth = 0
  let inString = false
  for (let i = start; i < html.length; i++) {
    const c = html[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) {
      try {
        const parsed: unknown = JSON.parse(html.slice(start, i + 1))
        return typeof parsed === 'object' && parsed !== null
          ? (parsed as Record<string, unknown>)
          : null
      } catch {
        return null
      }
    }
  }
  return null
}

export const greenhouse: Reader = {
  async list(fetcher, board) {
    if (!board.startsWith('eu:')) {
      const url = `https://boards-api.greenhouse.io/v1/boards/${board}/jobs`
      const data = parseFeed(await getText(fetcher, url), url)
      const jobs = (data as { jobs?: unknown } | null)?.jobs
      if (!Array.isArray(jobs)) throw notRecognised(url)
      return {
        jobs: objects(jobs).map((j) => {
          const loc = j.location as { name?: unknown } | null | undefined
          return row(j, str(loc?.name), j.first_published)
        }),
        complete: true,
        note: null
      }
    }
    const name = board.slice(3)
    const jobs: RawJob[] = []
    let totalPages = 1
    let total: number | null = null
    for (let page = 1; page <= totalPages; page++) {
      if (page > MAX_EU_PAGES) {
        return { jobs, complete: false, note: `Stopped after ${MAX_EU_PAGES} pages` }
      }
      const url = `https://job-boards.eu.greenhouse.io/${name}?page=${page}`
      const posts = jobPostsIn(await getText(fetcher, url))
      if (!posts || !Array.isArray(posts.data)) throw notRecognised(url)
      // Only the first page's paging counts. Without a page count the rows could be any part of the list;
      // a count of 0 is believable only for a board with no jobs.
      if (page === 1) {
        const pages = posts.total_pages
        const empty = pages === 0 && posts.data.length === 0
        if (typeof pages !== 'number' || !Number.isInteger(pages) || (pages < 1 && !empty)) {
          throw notRecognised(url)
        }
        totalPages = pages
        if (typeof posts.total === 'number' && Number.isFinite(posts.total)) total = posts.total
      }
      for (const j of objects(posts.data)) jobs.push(row(j, str(j.location), j.published_at))
    }
    if (total !== null && jobs.length < total) {
      return { jobs, complete: false, note: `Read ${jobs.length} of ${total} jobs` }
    }
    return { jobs, complete: true, note: null }
  }
}
