import type { RawJob } from '../../../shared/types'
import { countryOfCity } from '../../geo/place'
import { countriesIn, countryCode, isRegionName } from '../location'
import { employmentFrom } from './employment'
import { getText } from './http'
import type { Reader } from './types'
import { decode, unique } from './util'

/** A site map index lists at most this many site maps that are read. */
const MAX_SITEMAPS = 20

const LOC = /<loc>\s*([^<]+?)\s*<\/loc>/g
/** /job/<city>/<title>/<tenant>/<job id> */
const JOB = /\/job\/([^/]+)\/([^/]+)\/\d+\/(\d+)\/?$/
/** /location/<place>-jobs/<tenant>/<GeoNames ids, country first>/<level> */
const PLACE = /\/location\/([a-z0-9-]+)-jobs\/\d+\/(\d+(?:-\d+)*)\/\d+\/?$/

const names = new Intl.DisplayNames(['en'], { type: 'region' })

/** "british-columbia" → "British Columbia". */
const words = (slug: string): string =>
  decodeURIComponent(slug)
    .split('-')
    .filter((w) => w !== '')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')

/** A location page of the site map: its place slug, its country's GeoNames id and how many ids it has. */
interface Page {
  slug: string
  country: string
  ids: number
}

interface Where {
  location: string
  countries: string[]
}

/**
 * Where a job's city slug is, from the site map's location pages: a country page (india-jobs, /1269750/) names a
 * country id, and a place page (sunnyvale-california-united-states-jobs, /6252001-…/) starts with the city and its
 * first id is the country's. When those name exactly one country, the place page gives the region too.
 */
function fromPages(city: string, pages: Page[]): Where | null {
  const countrySlugs = new Map<string, string>()
  for (const p of pages) if (p.ids === 1) countrySlugs.set(p.country, p.slug)
  const matches = pages
    .filter((p) => p.slug.startsWith(`${city}-`) || p.slug === city)
    .map((p) => ({ ...p, countrySlug: countrySlugs.get(p.country) }))
    .filter((p) => p.countrySlug !== undefined && countryCode(words(p.countrySlug!)) !== null)
  const codes = unique(matches.map((p) => countryCode(words(p.countrySlug!))!))
  if (codes.length !== 1) return null
  // The page that names the city's region: a city page (three ids) before a region or country page, and the shortest
  // of those, so porto-porto-portugal beats porto-salvo-lisbon-portugal for Porto.
  const best = matches.sort((a, b) => b.ids - a.ids || a.slug.length - b.slug.length)[0]
  const rest = best.slug === city ? '' : best.slug.slice(city.length + 1)
  const region = rest === best.countrySlug ? '' : rest.slice(0, -(best.countrySlug!.length + 1))
  const parts =
    best.slug === best.countrySlug
      ? [words(city)]
      : [words(city), words(region), words(best.countrySlug!)]
  return { location: parts.filter((s) => s !== '').join(', '), countries: codes }
}

/** Where a job's city slug is when no location page says: a region name, else the clearly biggest city, else unclear. */
function fallback(city: string): Where {
  const text = words(city)
  if (isRegionName(text)) return { location: text, countries: countriesIn(text) }
  const code = countryOfCity(text)
  return code
    ? { location: `${text}, ${names.of(code) ?? code}`, countries: [code] }
    : { location: text, countries: [] }
}

/** Every address in the site map, one index level down; `skipped` counts the site maps left unread. */
async function locsOf(
  fetcher: Parameters<Reader['list']>[0],
  url: string
): Promise<{ locs: string[]; maps: number; skipped: number }> {
  const xml = await getText(fetcher, url)
  const locs = [...xml.matchAll(LOC)].map((m) => decode(m[1]))
  if (!/<sitemapindex[\s>]/.test(xml)) return { locs, maps: 1, skipped: 0 }
  const out: string[] = []
  for (const child of locs.slice(0, MAX_SITEMAPS)) {
    out.push(...[...(await getText(fetcher, child)).matchAll(LOC)].map((m) => decode(m[1])))
  }
  return { locs: out, maps: locs.length, skipped: Math.max(0, locs.length - MAX_SITEMAPS) }
}

/**
 * Board: the host of a Radancy (TalentBrew) careers site. Its search pages are closed to robots, so the jobs come from
 * its site map: each job address gives its city, title and id. Titles are rebuilt from the address in plain capitals.
 */
export const radancy: Reader = {
  async list(fetcher, board) {
    const url = `https://${board}/sitemap.xml`
    const { locs, maps, skipped } = await locsOf(fetcher, url)
    const pages: Page[] = []
    for (const loc of locs) {
      const m = PLACE.exec(loc)
      if (m) {
        const ids = m[2].split('-')
        pages.push({ slug: m[1], country: ids[0], ids: ids.length })
      }
    }
    const seen = new Set<string>()
    const jobs: RawJob[] = []
    const where = new Map<string, Where>()
    for (const loc of locs) {
      const m = JOB.exec(loc)
      if (!m || seen.has(m[3])) continue
      seen.add(m[3])
      const city = m[1].toLowerCase()
      if (!where.has(city)) where.set(city, fromPages(city, pages) ?? fallback(city))
      const { location, countries } = where.get(city)!
      const title = words(m[2])
      jobs.push({
        sourceId: m[3],
        title,
        location,
        countries,
        employment: employmentFrom(title),
        url: loc,
        postedAt: null,
        postedRough: false,
        needsDetails: false
      })
    }
    if (jobs.length === 0) throw new Error(`Job list not recognised on ${url}`)
    // Site maps left unread may hold open jobs, so such a read closes nothing.
    return skipped > 0
      ? {
          jobs,
          complete: false,
          note: `Radancy: only the first ${MAX_SITEMAPS} of ${maps} site maps were read`
        }
      : { jobs, complete: true, note: null }
  }
}
