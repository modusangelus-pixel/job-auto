import { describe, expect, test } from 'vitest'
import { avature } from '../../../src/main/jobs/readers/avature'
import { BlockedError, fakeFetcher, fixture, rejection } from './helpers'

const NOW = new Date(2026, 10, 6, 12, 0, 0)

const SIEMENS = 'jobs.siemens.com/en_US/externaljobs'
const SIEMENS_FIRST = `https://${SIEMENS}/SearchJobs`
const SIEMENS_NEXT = `https://${SIEMENS}/SearchJobs/?folderRecordsPerPage=6&folderOffset=6`

const HARMAN = 'jobsearch.harman.com/en_US/careers'
const HARMAN_FIRST = `https://${HARMAN}/SearchJobs`
const HARMAN_NEXT = `https://${HARMAN}/SearchJobs/?jobRecordsPerPage=20&jobOffset=20`

/** A list page in the Siemens template: one row per [id, title, city], and a next link to `next` when given. */
function listPage(board: string, rows: [string, string, string][], next?: number): string {
  const articles = rows
    .map(
      ([id, title, city]) => `<article class="article article--result">
<h3><a class="link" href="https://${board}/JobDetail/${id}"> ${title} </a></h3>
<div class="article__header__text__subtitle">
<span class="list-item-location"><span class="list-item-jobCity">${city}</span><span class="separator">, </span><span class="list-item-jobCountry">Sweden</span></span>
<span class="separator" aria-hidden="true">&nbsp;&#8226;&nbsp;</span> <span class="list-item-jobId">Job ID: ${id}</span>
</div></article>`
    )
    .join('\n')
  const link =
    next === undefined
      ? ''
      : `<li class="list-controls__pagination__item paginationNextLink"><a href="https://${board}/SearchJobs/?folderRecordsPerPage=6&amp;folderOffset=${next}">Next</a></li>`
  return `<html><body>${articles}<div class="list-controls__pagination"><nav aria-label="Pagination Navigation"><ul>${link}</ul></nav></div></body></html>`
}

describe('avature reader', () => {
  test('Siemens: follows the next link, and a "999+" list is never complete', async () => {
    const { fetcher, urls } = fakeFetcher({
      [SIEMENS_FIRST]: fixture('avature-siemens.html'),
      [SIEMENS_NEXT]: listPage(SIEMENS, [['600001', 'Engineer', 'Göteborg']])
    })
    const r = await avature.list(fetcher, SIEMENS, NOW)
    expect(urls).toEqual([SIEMENS_FIRST, SIEMENS_NEXT])
    expect(r.jobs).toHaveLength(4)
    expect(r.complete).toBe(false)
    expect(r.note).toBe('Avature: the site shows only part of its list (999+ results)')
    expect(r.jobs[1]).toEqual({
      sourceId: '528744',
      title: 'Senior AI/ML & Robotics Platform Developer',
      location: 'Kitchener, Ontario, Canada',
      countries: ['CA'],
      employment: 'unknown',
      url: 'https://jobs.siemens.com/en_US/externaljobs/JobDetail/528744',
      postedAt: null,
      postedRough: false,
      needsDetails: false
    })
    expect(r.jobs.map((j) => [j.location, j.countries])).toEqual([
      ['Multiple Locations', []],
      ['Kitchener, Ontario, Canada', ['CA']],
      ['Fort Worth, Texas, United States of America', ['US']],
      ['Göteborg, Sweden', ['SE']]
    ])
  })

  test('Harman: labelled locations, extra locations and posted dates', async () => {
    const last = listPage(HARMAN, [['40001', 'Engineer', 'Göteborg']])
    const { fetcher, urls } = fakeFetcher({
      [HARMAN_FIRST]: fixture('avature-harman.html'),
      [HARMAN_NEXT]: last
    })
    const r = await avature.list(fetcher, HARMAN, NOW)
    expect(urls).toEqual([HARMAN_FIRST, HARMAN_NEXT])
    expect(r.complete).toBe(true)
    expect(r.note).toBeNull()
    expect(r.jobs[0]).toEqual({
      sourceId: '32911',
      title: 'Product Manager, Theatre & Broadcast Lighting',
      location: 'Aarhus - Central Jutland, Denmark',
      countries: ['DK'],
      employment: 'unknown',
      url: 'https://jobsearch.harman.com/en_US/careers/JobDetail/Product-Manager-Theatre-Broadcast-Lighting/32911',
      postedAt: new Date(2026, 8, 24).toISOString(),
      postedRough: false,
      needsDetails: false
    })
    expect(r.jobs.map((j) => j.postedAt)).toEqual([
      new Date(2026, 8, 24).toISOString(),
      new Date(2026, 10, 3).toISOString(),
      new Date(2026, 9, 9).toISOString(),
      null
    ])
  })

  test('an additional location joins the location', async () => {
    const page = listPage(HARMAN, [['1', 'Engineer', 'Ariake']]).replace(
      '<span class="separator" aria-hidden="true">&nbsp;&#8226;',
      '<span class="separator" aria-hidden="true">&nbsp;&#8226;&nbsp;</span><span class="list-item-additionalLocation"><strong> Additional Location:</strong> Oslo - Oslo, Norway</span><span class="separator" aria-hidden="true">&nbsp;&#8226;'
    )
    const { fetcher } = fakeFetcher({ [HARMAN_FIRST]: page })
    const [job] = (await avature.list(fetcher, HARMAN, NOW)).jobs
    expect(job.location).toBe('Ariake, Sweden | Oslo - Oslo, Norway')
    expect(job.countries).toEqual(['SE', 'NO'])
  })

  test('the job type comes from the title', async () => {
    const { fetcher } = fakeFetcher({
      [SIEMENS_FIRST]: listPage(SIEMENS, [['1', 'Working Student Software (f/m/d)', 'Malmö']])
    })
    expect((await avature.list(fetcher, SIEMENS, NOW)).jobs[0].employment).toBe('intern')
  })

  test('stops after 100 pages and says the read is incomplete', async () => {
    const routes: Record<string, string> = {
      [SIEMENS_FIRST]: listPage(SIEMENS, [['0', 'Job', 'Malmö']], 6)
    }
    for (let o = 6; o < 700; o += 6)
      routes[`https://${SIEMENS}/SearchJobs/?folderRecordsPerPage=6&folderOffset=${o}`] = listPage(
        SIEMENS,
        [[String(o), 'Job', 'Malmö']],
        o + 6
      )
    const { fetcher, urls } = fakeFetcher(routes)
    const r = await avature.list(fetcher, SIEMENS, NOW)
    expect(urls).toHaveLength(100)
    expect(r.jobs).toHaveLength(100)
    expect(r.complete).toBe(false)
    expect(r.note).toBe('Avature: only the first 100 pages were read')
  })

  test('a next link off the board, or back to an earlier page, ends the list', async () => {
    const page = listPage(SIEMENS, [['1', 'Job', 'Malmö']]).replace(
      '<ul></ul>',
      '<ul><a href="https://elsewhere.test/SearchJobs/?jobOffset=6">x</a>' +
        `<a href="https://${SIEMENS}/SearchJobs/?folderOffset=0">1</a></ul>`
    )
    const { fetcher, urls } = fakeFetcher({ [SIEMENS_FIRST]: page })
    const r = await avature.list(fetcher, SIEMENS, NOW)
    expect(urls).toEqual([SIEMENS_FIRST])
    expect(r.complete).toBe(true)
  })

  test('"No results match your search" is an empty complete list', async () => {
    const none = '<h2 class="article__header__text__title"> No results match your search. </h2>'
    const { fetcher } = fakeFetcher({ [SIEMENS_FIRST]: none })
    expect(await avature.list(fetcher, SIEMENS, NOW)).toEqual({
      jobs: [],
      complete: true,
      note: null
    })
  })

  test('a first page with no rows and no such message is not recognised', async () => {
    const { fetcher } = fakeFetcher({ [SIEMENS_FIRST]: '<html>Welcome</html>' })
    const e = await rejection(avature.list(fetcher, SIEMENS, NOW))
    expect((e as Error).message).toBe(`Job list not recognised on ${SIEMENS_FIRST}`)
  })

  test.each([
    ['no rows', '<html><nav aria-label="Pagination Navigation"></nav></html>'],
    [
      'no pagination',
      listPage(SIEMENS, [['2', 'Job', 'Malmö']]).replace(
        /<div class="list-controls__pagination">[\s\S]*$/,
        ''
      )
    ]
  ])('a later page with %s is not recognised', async (_name, body) => {
    const { fetcher } = fakeFetcher({
      [SIEMENS_FIRST]: listPage(SIEMENS, [['1', 'Job', 'Malmö']], 6),
      [SIEMENS_NEXT]: body
    })
    const e = await rejection(avature.list(fetcher, SIEMENS, NOW))
    expect((e as Error).message).toBe(`Job list not recognised on ${SIEMENS_NEXT}`)
  })

  test('robots.txt blocking the list is a block', async () => {
    const { fetcher } = fakeFetcher({ [SIEMENS_FIRST]: null })
    expect(await rejection(avature.list(fetcher, SIEMENS, NOW))).toBeInstanceOf(BlockedError)
  })
})
