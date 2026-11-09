import type { RawJob } from '../../../shared/types'
import { countriesIn, countryCode, isSubdivisionCode } from '../location'
import { getText } from './http'
import type { Reader } from './types'
import { decode } from './util'

/** A career site holds at most a few thousand jobs; this stops a runaway read. */
const MAX_PAGES = 200

type Template = 'table' | 'tile'

interface Row {
  href: string
  title: string
  location: string
  date: string
}

interface Page {
  template: Template
  rows: Row[]
  /** The site's job count when the page states it, else null. */
  total: number | null
  /** The site's rows per page when the page states it, else null. */
  pageSize: number | null
}

/** The text of a piece of markup: tags dropped, entities decoded, whitespace collapsed. */
function textOf(html: string): string {
  return decode(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(tag)
  return m ? decode(m[1]) : null
}

function count(text: string): number | null {
  const n = Number(text.replace(/[.,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

function titleLink(html: string): { href: string | null; title: string } {
  const m = /<a\b[^>]*class="[^"]*\bjobTitle-link\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(html)
  return m ? { href: attr(m[0], 'href'), title: textOf(m[1]) } : { href: null, title: '' }
}

function cell(html: string, pattern: RegExp): string {
  const m = pattern.exec(html)
  return m ? textOf(m[1]) : ''
}

function tableRows(html: string, url: string): Row[] {
  const rows: Row[] = []
  const re = /<tr\b[^>]*class="[^"]*\bdata-row\b[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi
  for (const m of html.matchAll(re)) {
    const { href, title } = titleLink(m[1])
    if (href === null) throw new Error(`Job list not recognised on ${url}`)
    rows.push({
      href,
      title,
      // The phone block repeats the location, so only the location column counts.
      location: cell(m[1], /<td\b[^>]*class="[^"]*\bcolLocation\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i),
      date: cell(m[1], /<span\b[^>]*class="[^"]*\bjobDate\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
    })
  }
  return rows
}

function tileRows(html: string, url: string): Row[] {
  const rows: Row[] = []
  const re = /(<li\b[^>]*class="[^"]*\bjob-tile\b[^"]*"[^>]*>)([\s\S]*?)<\/li>/gi
  for (const m of html.matchAll(re)) {
    const link = titleLink(m[2])
    const href = link.href ?? attr(m[1], 'data-url')
    if (href === null) throw new Error(`Job list not recognised on ${url}`)
    rows.push({
      href,
      title: link.title,
      location: cell(m[2], /id="job-[\w-]*?-section-location-value"[^>]*>([\s\S]*?)<\/div>/i),
      date: cell(m[2], /id="job-[\w-]*?-section-date-value"[^>]*>([\s\S]*?)<\/div>/i)
    })
  }
  return rows
}

const LABEL =
  /class="paginationLabel"[^>]*>\s*Results\s*<b>\s*(\d+)\s*[–-]\s*(\d+)\s*<\/b>\s*of\s*<b>\s*([\d.,\s]+?)\s*<\/b>/i

/** The page's rows, total and page size; null when it has neither template's results markup. */
function parsePage(html: string, url: string): Page | null {
  if (/<table\b[^>]*\bid="searchresults"/i.test(html)) {
    const label = LABEL.exec(html)
    return {
      template: 'table',
      rows: tableRows(html, url),
      total: label ? count(label[3]) : null,
      pageSize: label ? Number(label[2]) - Number(label[1]) + 1 : null
    }
  }
  const list = /<ul\b[^>]*\bid="job-tile-list"[^>]*>/i.exec(html)
  if (list) {
    const showing = /Showing\s+\d+\s+to\s+\d+\s+of\s+([\d.,]+)/i.exec(html)
    const perPage = attr(list[0], 'data-per-page')
    return {
      template: 'tile',
      rows: tileRows(html, url),
      total: showing ? count(showing[1]) : null,
      pageSize: perPage === null ? null : Number(perPage)
    }
  }
  return null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function monthNumber(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1
}

/** Local midnight of a calendar date as an ISO string; null when it is not a real date. */
function midnight(year: number, month: number, day: number): string | null {
  const d = new Date(year, month - 1, day)
  const real = d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day
  return month >= 1 && real ? d.toISOString() : null
}

/** "Nov 5, 2026", "5 Nov 2026", "05.11.2026" or "2026-11-05"; anything else is null. */
function parseDate(text: string): string | null {
  let m = /^([A-Za-z]{3}) (\d{1,2}), (\d{4})$/.exec(text)
  if (m) return midnight(Number(m[3]), monthNumber(m[1]), Number(m[2]))
  m = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(text)
  if (m) return midnight(Number(m[3]), monthNumber(m[2]), Number(m[1]))
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text)
  if (m) return midnight(Number(m[3]), Number(m[2]), Number(m[1]))
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (m) return midnight(Number(m[1]), Number(m[2]), Number(m[3]))
  return null
}

/**
 * "Göteborg, SE" names its country by code. Several codes: the last one (states come first). A lone code
 * that is also a US state, Canadian province or Australian state ("Moline, IL") is unclear, so no country.
 * No code at all: read country names.
 */
function countriesOf(location: string): string[] {
  const codes = location
    .split(',')
    .map((p) => p.trim())
    .filter((p) => /^[A-Z]{2}$/.test(p) && countryCode(p) !== null)
  if (codes.length === 0) return countriesIn(location)
  if (codes.length === 1 && isSubdivisionCode(codes[0])) return []
  return [codes[codes.length - 1]]
}

/**
 * The job's id: the numeric id that ends the link path (`/job/…/1445209733/`), which stays when the title in
 * the link is edited; else the link path as it is.
 */
function sourceIdOf(href: string, url: URL): string {
  const id = /\/(\d+)\/?$/.exec(url.pathname)
  if (id) return id[1]
  return href.startsWith('/') ? href : `${url.pathname}${url.search}`
}

function toJob(row: Row, host: string): RawJob {
  const url = new URL(row.href, `https://${host}/`)
  return {
    sourceId: sourceIdOf(row.href, url),
    title: row.title,
    location: row.location,
    countries: countriesOf(row.location),
    employment: 'unknown',
    url: url.href,
    postedAt: parseDate(row.date),
    postedRough: false,
    needsDetails: false
  }
}

export const successfactors: Reader = {
  async list(fetcher, board) {
    const host = board.split('/')[0]
    const jobs: RawJob[] = []
    let template: Template | null = null
    let total: number | null = null
    let pageSize = 0
    let startrow = 0
    for (let pages = 1; ; pages++) {
      const url = `https://${board}/search/?q=&startrow=${startrow}`
      const unreadable = new Error(`Job list not recognised on ${url}`)
      const page = parsePage(await getText(fetcher, url), url)
      if (page === null || (template !== null && page.template !== template)) throw unreadable
      if (template === null) {
        template = page.template
        total = page.total
        pageSize = page.pageSize ?? page.rows.length
        if (page.rows.length === 0) {
          // No rows is an empty list, unless the page itself says there are jobs.
          if (total !== null && total > 0) throw unreadable
          return { jobs, complete: true, note: null }
        }
        // Rows without a believable page size and (for tables) total could be any part of the list.
        if (pageSize <= 0) throw unreadable
        if (template === 'table' && total === null) throw unreadable
        if (total !== null && total < page.rows.length) throw unreadable
      } else if (page.rows.length === 0) {
        // The loop only continues while there should be more, so an empty page is a broken read.
        if (total !== null) throw unreadable
        return { jobs, complete: true, note: null }
      }
      for (const row of page.rows) jobs.push(toJob(row, host))
      startrow += pageSize
      const more = total !== null ? startrow < total : page.rows.length >= pageSize
      if (!more) return { jobs, complete: true, note: null }
      // A short page before the end would leave a gap that the next startrow skips.
      if (total !== null && page.rows.length < pageSize) throw unreadable
      if (pages === MAX_PAGES) {
        return { jobs, complete: false, note: `Stopped after ${MAX_PAGES} pages` }
      }
    }
  }
}
