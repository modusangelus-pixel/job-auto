import { describe, expect, test } from 'vitest'
import { radancy } from '../../../src/main/jobs/readers/radancy'
import { BlockedError, fakeFetcher, fixture, rejection } from './helpers'

const BOARD = 'careers.synopsys.com'
const SITEMAP = 'https://careers.synopsys.com/sitemap.xml'
const NOW = new Date(2026, 10, 6, 12, 0, 0)

const urlset = (locs: string[]): string =>
  `<?xml version="1.0" encoding="utf-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs
    .map((l) => `<url><loc>${l}</loc></url>`)
    .join('')}</urlset>`

const job = (city: string, slug: string, id: string): string =>
  `https://careers.synopsys.com/job/${city}/${slug}/44408/${id}`

describe('radancy reader', () => {
  test('reads every job address in the site map, complete, with one full RawJob', async () => {
    const { fetcher, urls } = fakeFetcher({ [SITEMAP]: fixture('radancy-sitemap.xml') })
    const r = await radancy.list(fetcher, BOARD, NOW)
    expect(urls).toEqual([SITEMAP])
    expect(r.jobs).toHaveLength(5)
    expect(r.complete).toBe(true)
    expect(r.note).toBeNull()
    expect(r.jobs[0]).toEqual({
      sourceId: '102946018704',
      title: 'Principal Site Reliability Engineer Unix Systems',
      location: 'Sunnyvale, California, United States',
      countries: ['US'],
      employment: 'unknown',
      url: 'https://careers.synopsys.com/job/sunnyvale/principal-site-reliability-engineer-unix-systems/44408/102946018704',
      postedAt: null,
      postedRough: false,
      needsDetails: false
    })
  })

  test("the site map's location pages place each job city in its country", async () => {
    const { fetcher } = fakeFetcher({ [SITEMAP]: fixture('radancy-sitemap.xml') })
    const jobs = (await radancy.list(fetcher, BOARD, NOW)).jobs
    expect(jobs.map((j) => [j.location, j.countries])).toEqual([
      ['Sunnyvale, California, United States', ['US']],
      ['Bengaluru, Karnataka, India', ['IN']],
      ['Pennsylvania, United States', ['US']],
      ['Dublin, Leinster, Ireland', ['IE']],
      ['Vancouver, British Columbia, Canada', ['CA']]
    ])
  })

  test('without a location page: a region name, else the clearly biggest city of that name, else unclear', async () => {
    const { fetcher } = fakeFetcher({
      [SITEMAP]: urlset([
        job('greece', 'sales-engineer', '1'),
        job('kista', 'rd-engineer', '2'),
        job('cambridge', 'applications-engineer', '3'),
        job('hsinchu', 'layout-engineer', '4')
      ])
    })
    const jobs = (await radancy.list(fetcher, BOARD, NOW)).jobs
    expect(jobs.map((j) => [j.location, j.countries])).toEqual([
      ['Greece', ['GR']],
      ['Kista, Sweden', ['SE']],
      ['Cambridge', []],
      ['Hsinchu', []]
    ])
  })

  test('a city whose location pages name two countries falls back to the biggest city', async () => {
    const { fetcher } = fakeFetcher({
      [SITEMAP]: urlset([
        'https://careers.synopsys.com/location/ireland-jobs/44408/2963597/2',
        'https://careers.synopsys.com/location/united-states-jobs/44408/6252001/2',
        'https://careers.synopsys.com/location/dublin-leinster-ireland-jobs/44408/2963597-7521314-2964574/4',
        'https://careers.synopsys.com/location/dublin-california-united-states-jobs/44408/6252001-5332921-5344157/4',
        job('dublin', 'engineer', '1')
      ])
    })
    const [j] = (await radancy.list(fetcher, BOARD, NOW)).jobs
    expect(j.location).toBe('Dublin, Ireland')
    expect(j.countries).toEqual(['IE'])
  })

  test('the job type comes from the title, and a job listed twice counts once', async () => {
    const { fetcher } = fakeFetcher({
      [SITEMAP]: urlset([
        job('yerevan', 'standard-cell-library-engineering-internship', '7'),
        job('yerevan', 'standard-cell-library-engineering-internship', '7')
      ])
    })
    const jobs = (await radancy.list(fetcher, BOARD, NOW)).jobs
    expect(jobs).toHaveLength(1)
    expect(jobs[0].employment).toBe('intern')
  })

  test('a site map index is followed one level down', async () => {
    const index = `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://careers.synopsys.com/sitemap1.xml</loc></sitemap><sitemap><loc>https://careers.synopsys.com/sitemap2.xml</loc></sitemap></sitemapindex>`
    const { fetcher, urls } = fakeFetcher({
      [SITEMAP]: index,
      'https://careers.synopsys.com/sitemap1.xml': urlset([job('austin', 'a', '1')]),
      'https://careers.synopsys.com/sitemap2.xml': urlset([job('austin', 'b', '2')])
    })
    const r = await radancy.list(fetcher, BOARD, NOW)
    expect(urls).toEqual([
      SITEMAP,
      'https://careers.synopsys.com/sitemap1.xml',
      'https://careers.synopsys.com/sitemap2.xml'
    ])
    expect(r.jobs.map((j) => j.sourceId)).toEqual(['1', '2'])
  })

  test('a site map index longer than 20 maps is read in part, never complete', async () => {
    const children = Array.from(
      { length: 21 },
      (_, i) => `https://careers.synopsys.com/sitemap${i}.xml`
    )
    const index = `<?xml version="1.0"?><sitemapindex>${children
      .map((c) => `<sitemap><loc>${c}</loc></sitemap>`)
      .join('')}</sitemapindex>`
    const routes: Record<string, string> = { [SITEMAP]: index }
    children.forEach((c, i) => (routes[c] = urlset([job('austin', 'a', String(i))])))
    const { fetcher, urls } = fakeFetcher(routes)
    const r = await radancy.list(fetcher, BOARD, NOW)
    expect(urls).toHaveLength(21)
    expect(r.jobs).toHaveLength(20)
    expect(r.complete).toBe(false)
    expect(r.note).toBe('Radancy: only the first 20 of 21 site maps were read')
  })

  test('a site map with no job addresses is not recognised', async () => {
    const { fetcher } = fakeFetcher({
      [SITEMAP]: urlset(['https://careers.synopsys.com/category/engineering-jobs/44408/8675488/1'])
    })
    const e = await rejection(radancy.list(fetcher, BOARD, NOW))
    expect((e as Error).message).toBe(`Job list not recognised on ${SITEMAP}`)
  })

  test('robots.txt blocking the site map is a block', async () => {
    const { fetcher } = fakeFetcher({ [SITEMAP]: null })
    expect(await rejection(radancy.list(fetcher, BOARD, NOW))).toBeInstanceOf(BlockedError)
  })
})
