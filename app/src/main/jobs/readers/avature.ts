import type { RawJob } from '../../../shared/types'
import { countriesIn } from '../location'
import { employmentFrom } from './employment'
import { getText } from './http'
import type { Reader } from './types'
import { decode, htmlText } from './util'

/** A board with more pages than this is read in part (Avature lists 6 to 20 jobs a page, newest first). */
const MAX_PAGES = 100

const ARTICLE = /<article class="article article--result[\s\S]*?<\/article>/g
const LINK = /<a class="link" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/
const SEARCH_LINK = /href="([^"]*SearchJobs[^"]*)"/g
const NO_RESULTS = /No results match your search/i
const PAGINATION = /Pagination Navigation|list-controls__pagination/
/** "1 - 6 of 999+ results": the site shows only part of a longer list. */
const PARTIAL = /of\s+([\d,.]+\+)\s*results/i

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** The text of the row's `list-item-<name>` field, up to the bullet that ends it, without its label. */
function field(article: string, name: string): string {
  const at = article.indexOf(`class="list-item-${name}"`)
  if (at < 0) return ''
  const start = article.indexOf('>', at) + 1
  const ends = ['&#8226;', '</div>'].map((e) => article.indexOf(e, start)).filter((i) => i >= 0)
  const text = htmlText(article.slice(start, Math.min(...ends, article.length)))
  return text
    .replace(/^[^:]{1,30}:\s*/, '')
    .replace(/\s+,/g, ',')
    .trim()
}

/** "24-Sep-2026" as local midnight; anything else is null. */
function postedOn(text: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(text)
  if (!m) return null
  const month = MONTHS.indexOf(m[2].toLowerCase())
  const d = new Date(Number(m[3]), month, Number(m[1]))
  return month >= 0 && d.getDate() === Number(m[1]) ? d.toISOString() : null
}

function toJob(article: string, pageUrl: string): RawJob {
  const link = LINK.exec(article)
  const url = link ? decode(link[1]) : ''
  const id = /\/(\d+)\/?(?:[?#].*)?$/.exec(url)?.[1]
  if (!link || !id) throw new Error(`Job list not recognised on ${pageUrl}`)
  const title = htmlText(link[2])
  const location = [field(article, 'location'), field(article, 'additionalLocation')]
    .filter((s) => s !== '')
    .join(' | ')
  return {
    sourceId: id,
    title,
    location,
    countries: countriesIn(location),
    employment: employmentFrom(title),
    url,
    postedAt: postedOn(field(article, 'posted')),
    postedRough: false,
    needsDetails: false
  }
}

/** The page after `offset`: the board's SearchJobs link with the smallest larger job or folder offset. */
function nextPage(
  html: string,
  board: string,
  offset: number
): { url: string; offset: number } | null {
  let best: { url: string; offset: number } | null = null
  for (const [, href] of html.matchAll(SEARCH_LINK)) {
    const url = decode(href)
    if (!url.startsWith(`https://${board}/SearchJobs`)) continue
    let params: URLSearchParams
    try {
      params = new URL(url).searchParams
    } catch {
      continue
    }
    const n = Number(params.get('jobOffset') ?? params.get('folderOffset'))
    if (Number.isInteger(n) && n > offset && (!best || n < best.offset)) best = { url, offset: n }
  }
  return best
}

/**
 * Board: host/locale/portal of an Avature careers site, such as jobs.siemens.com/en_US/externaljobs. Each company's
 * site has its own page size and paging parameter, so the reader follows the page's own link to the next page.
 */
export const avature: Reader = {
  async list(fetcher, board) {
    const jobs: RawJob[] = []
    let url = `https://${board}/SearchJobs`
    let offset = 0
    let partial: string | null = null
    let pages = 0
    for (;;) {
      const html = await getText(fetcher, url)
      const articles = html.match(ARTICLE) ?? []
      if (pages === 0) {
        if (articles.length === 0 && NO_RESULTS.test(html))
          return { jobs: [], complete: true, note: null }
        partial = PARTIAL.exec(html)?.[1] ?? null
      }
      // A later page always has rows and the paging bar; without them the read broke off.
      if (articles.length === 0 || (pages > 0 && !PAGINATION.test(html)))
        throw new Error(`Job list not recognised on ${url}`)
      for (const article of articles) jobs.push(toJob(article, url))
      pages++
      const next = nextPage(html, board, offset)
      if (!next) break
      if (pages >= MAX_PAGES) {
        return {
          jobs,
          complete: false,
          note: `Avature: only the first ${MAX_PAGES} pages were read`
        }
      }
      url = next.url
      offset = next.offset
    }
    return partial
      ? {
          jobs,
          complete: false,
          note: `Avature: the site shows only part of its list (${partial} results)`
        }
      : { jobs, complete: true, note: null }
  }
}
