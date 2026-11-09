import { describe, expect, test } from 'vitest'
import { icims } from '../../../src/main/jobs/readers/icims'
import { BlockedError, fakeFetcher, fixture, rejection } from './helpers'

const BOARD = 'careers-rws.icims.com'
const NOW = new Date(2026, 10, 6, 12, 0, 0)
const page = (n: number, host = BOARD): string =>
  `https://${host}/jobs/search?ss=1&in_iframe=1&pr=${n}`

/** A list page in iCIMS's markup: one card per [id, title, location], with "of <pages>" in the paginator. */
function listPage(
  rows: [string, string, string][],
  pages: number,
  linkHost = BOARD,
  query = 'in_iframe=1'
): string {
  const cards = rows
    .map(
      ([id, title, location]) => `<li class="iCIMS_JobCardItem">
<div class="row">
<div class="col-xs-6 header left">
<span class="sr-only field-label">Job Locations</span>
<span >
${location}</span>
</div>
<div class="col-xs-12 title">
<a href="https://${linkHost}/jobs/${id}/some-slug/job?${query}" class="iCIMS_Anchor" title="${id} - ${title}">
<span class="sr-only field-label">Job Title</span>
<h3 >
${title}</h3>
</a>
</div>
</div>
</li>`
    )
    .join('\n')
  return `<html><body><ul class="iCIMS_JobsTable">${cards}</ul>
<div class="iCIMS_Paging"><a class="selected"><span class="sr-only">Page</span>1<span class="sr-only">
of ${pages} , Current Page
</span></a></div></body></html>`
}

describe('icims reader', () => {
  test('reads every page the paginator names, and one full job from the fixture', async () => {
    const { fetcher, urls } = fakeFetcher({
      [page(0)]: fixture('icims.html'),
      [page(1)]: listPage([['8001', 'Engineer', 'IE-Dublin']], 4),
      [page(2)]: listPage([['8002', 'Analyst', 'IE-Dublin']], 4),
      [page(3)]: listPage([['8003', 'Linguist', 'IE-Dublin']], 4)
    })
    const r = await icims.list(fetcher, BOARD, NOW)
    expect(urls).toEqual([page(0), page(1), page(2), page(3)])
    expect(r.jobs).toHaveLength(6)
    expect(r.complete).toBe(true)
    expect(r.note).toBeNull()
    expect(r.jobs[0]).toEqual({
      sourceId: '7042',
      title: 'Business Data Technician',
      location: 'Cork, Cork, Ireland',
      countries: ['IE'],
      employment: 'unknown',
      url: 'https://careers-rws.icims.com/jobs/7042/business-data-technician/job',
      postedAt: null,
      postedRough: false,
      needsDetails: false
    })
    expect(r.jobs.map((j) => j.sourceId)).toEqual(['7042', '7041', '7040', '8001', '8002', '8003'])
  })

  test('a page without a paginator is the only page', async () => {
    const one = listPage([['1', 'Engineer', 'US-WI-New Berlin']], 1).replace(
      /<div class="iCIMS_Paging">[\s\S]*?<\/div>/,
      ''
    )
    const { fetcher, urls } = fakeFetcher({ [page(0)]: one })
    const r = await icims.list(fetcher, BOARD, NOW)
    expect(urls).toEqual([page(0)])
    expect(r.jobs).toHaveLength(1)
    expect(r.complete).toBe(true)
  })

  test('locations read as city, region, country, and several are kept apart', async () => {
    const { fetcher } = fakeFetcher({
      [page(0)]: listPage(
        [
          ['1', 'A', 'US-WI-New Berlin'],
          ['2', 'B', 'CA-AB-Calgary | CA-ON-Dowling'],
          ['3', 'C', 'US-NC-Winston-Salem'],
          ['4', 'D', 'Remote']
        ],
        1
      )
    })
    const jobs = (await icims.list(fetcher, BOARD, NOW)).jobs
    expect(jobs.map((j) => j.location)).toEqual([
      'New Berlin, WI, United States',
      'Calgary, AB, Canada | Dowling, ON, Canada',
      'Winston-Salem, NC, United States',
      'Remote'
    ])
    expect(jobs.map((j) => j.countries)).toEqual([['US'], ['CA'], ['US'], []])
  })

  test('the job type comes from the title', async () => {
    const { fetcher } = fakeFetcher({
      [page(0)]: listPage([['1', 'Summer Intern - Testing', 'US-WI-New Berlin']], 1)
    })
    expect((await icims.list(fetcher, BOARD, NOW)).jobs[0].employment).toBe('intern')
  })

  test('a link on another iCIMS host keeps its host in the id, and its own query', async () => {
    const { fetcher } = fakeFetcher({
      [page(0)]: listPage(
        [['20330', 'Chemistry Technician', 'US-WI-New Berlin']],
        1,
        'element-ext-us.icims.com',
        'hub=11&amp;in_iframe=1'
      )
    })
    const [job] = (await icims.list(fetcher, BOARD, NOW)).jobs
    expect(job.sourceId).toBe('element-ext-us.icims.com/20330')
    expect(job.url).toBe('https://element-ext-us.icims.com/jobs/20330/some-slug/job?hub=11')
  })

  test('stops after 50 pages and says the read is incomplete', async () => {
    const routes: Record<string, string> = {}
    for (let n = 0; n < 60; n++) routes[page(n)] = listPage([[String(n), 'Job', 'IE-Dublin']], 60)
    const { fetcher, urls } = fakeFetcher(routes)
    const r = await icims.list(fetcher, BOARD, NOW)
    expect(urls).toHaveLength(50)
    expect(r.jobs).toHaveLength(50)
    expect(r.complete).toBe(false)
    expect(r.note).toBe('iCIMS: only the first 50 pages were read')
  })

  test('"no jobs were found" is an empty complete list', async () => {
    const none = `<div class="iCIMS_Message iCIMS_ErrorMessage iCIMS_GenericMessage">
Sorry, no jobs were found that match your search criteria. Please try other selections.
</div>`
    const { fetcher } = fakeFetcher({ [page(0)]: none })
    expect(await icims.list(fetcher, BOARD, NOW)).toEqual({ jobs: [], complete: true, note: null })
  })

  test('a page with no jobs and no such message is not recognised', async () => {
    const { fetcher } = fakeFetcher({ [page(0)]: '<html><body>Welcome</body></html>' })
    const e = await rejection(icims.list(fetcher, BOARD, NOW))
    expect((e as Error).message).toBe(`Job list not recognised on ${page(0)}`)
  })

  test('a later page with no jobs is not recognised', async () => {
    const { fetcher } = fakeFetcher({
      [page(0)]: listPage([['1', 'A', 'IE-Dublin']], 2),
      [page(1)]: '<html><body>Welcome</body></html>'
    })
    const e = await rejection(icims.list(fetcher, BOARD, NOW))
    expect((e as Error).message).toBe(`Job list not recognised on ${page(1)}`)
  })

  test('robots.txt blocking the list is a block', async () => {
    const { fetcher } = fakeFetcher({ [page(0)]: null })
    expect(await rejection(icims.list(fetcher, BOARD, NOW))).toBeInstanceOf(BlockedError)
  })
})
