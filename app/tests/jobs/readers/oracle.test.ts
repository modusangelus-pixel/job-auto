import { describe, expect, test } from 'vitest'
import { oracle } from '../../../src/main/jobs/readers/oracle'
import { BlockedError, fakeFetcher, fixture, rejection } from './helpers'

const HOST = 'hdjq.fa.us2.oraclecloud.com'
const BOARD = `${HOST}/CX_1`
const NOW = new Date(2026, 10, 6, 12, 0, 0)
const page = (offset: number): string =>
  `https://${HOST}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true` +
  `&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=CX_1,limit=25,offset=${offset}`

/** The fixture with its total set, as the feed body. */
function fixtureWith(total: number): string {
  const data = JSON.parse(fixture('oracle.json'))
  data.items[0].TotalJobsCount = total
  return JSON.stringify(data)
}

/** A feed page of `count` made-up requisitions from `from`, under `total`. */
function feed(total: unknown, from: number, count: number): string {
  const requisitionList = Array.from({ length: count }, (_, i) => ({
    Id: String(from + i),
    Title: `Job ${from + i}`,
    PostedDate: '2026-11-01',
    PrimaryLocation: 'Oslo, Norway',
    PrimaryLocationCountry: 'NO',
    JobSchedule: null,
    secondaryLocations: []
  }))
  return JSON.stringify({ items: [{ TotalJobsCount: total, requisitionList }] })
}

describe('oracle reader', () => {
  test('reads the fixture: one request, every job, and one full RawJob', async () => {
    const { fetcher, urls } = fakeFetcher({ [page(0)]: fixtureWith(3) })
    const r = await oracle.list(fetcher, BOARD, NOW)
    expect(urls).toEqual([page(0)])
    expect(r.jobs).toHaveLength(3)
    expect(r.complete).toBe(true)
    expect(r.note).toBeNull()
    expect(r.jobs[0]).toEqual({
      sourceId: '26000040',
      title: 'Senior Proposals Engineer I',
      location: 'CHENNAI, TAMIL NADU, India',
      countries: ['IN'],
      employment: 'unknown',
      url: `https://${HOST}/hcmUI/CandidateExperience/en/sites/CX_1/job/26000040`,
      postedAt: '2026-11-04T00:00:00.000Z',
      postedRough: false,
      needsDetails: false
    })
  })

  test('secondary locations join the location and the countries', async () => {
    const { fetcher } = fakeFetcher({ [page(0)]: fixtureWith(3) })
    const job = (await oracle.list(fetcher, BOARD, NOW)).jobs[1]
    expect(job.location.startsWith('LEICESTER, ENGLAND, United Kingdom | Warsaw, ')).toBe(true)
    expect(job.location.split(' | ')).toHaveLength(10)
    expect(job.countries).toEqual(['GB', 'PL', 'NL', 'RO', 'FR', 'DE', 'ES', 'IT', 'NO', 'CZ'])
  })

  test('the job type comes from the schedule, else the title', async () => {
    const data = JSON.parse(feed(2, 1, 2))
    data.items[0].requisitionList[0].JobSchedule = 'Part time'
    data.items[0].requisitionList[1].Title = 'Engineering Intern'
    const { fetcher } = fakeFetcher({ [page(0)]: JSON.stringify(data) })
    const jobs = (await oracle.list(fetcher, BOARD, NOW)).jobs
    expect(jobs.map((j) => j.employment)).toEqual(['part_time', 'intern'])
  })

  test('pages by 25 up to the total', async () => {
    const { fetcher, urls } = fakeFetcher({
      [page(0)]: feed(60, 0, 25),
      [page(25)]: feed(60, 25, 25),
      [page(50)]: feed(60, 50, 10)
    })
    const r = await oracle.list(fetcher, BOARD, NOW)
    expect(urls).toEqual([page(0), page(25), page(50)])
    expect(r.jobs).toHaveLength(60)
    expect(r.complete).toBe(true)
  })

  test('stops at 2000 jobs and says the read is incomplete', async () => {
    const routes: Record<string, string> = {}
    for (let o = 0; o < 2100; o += 25) routes[page(o)] = feed(5000, o, 25)
    const { fetcher, urls } = fakeFetcher(routes)
    const r = await oracle.list(fetcher, BOARD, NOW)
    expect(urls).toHaveLength(80)
    expect(r.jobs).toHaveLength(2000)
    expect(r.complete).toBe(false)
    expect(r.note).toBe('Oracle: only the first 2000 jobs were read')
  })

  test('an empty list is an empty complete list', async () => {
    const { fetcher } = fakeFetcher({ [page(0)]: feed(0, 0, 0) })
    expect(await oracle.list(fetcher, BOARD, NOW)).toEqual({ jobs: [], complete: true, note: null })
  })

  test.each([
    ['not JSON', '<html>Sign in</html>'],
    ['no items', '{"items":[]}'],
    ['no total', feed(undefined, 0, 3)],
    ['a total below the rows', feed(1, 0, 3)]
  ])('a feed with %s is not recognised', async (_name, body) => {
    const { fetcher } = fakeFetcher({ [page(0)]: body })
    const e = await rejection(oracle.list(fetcher, BOARD, NOW))
    expect((e as Error).message).toBe(`Job list not recognised on ${page(0)}`)
  })

  test('an empty page while the total says more is not recognised', async () => {
    const { fetcher } = fakeFetcher({ [page(0)]: feed(40, 0, 25), [page(25)]: feed(40, 25, 0) })
    const e = await rejection(oracle.list(fetcher, BOARD, NOW))
    expect((e as Error).message).toBe(`Job list not recognised on ${page(25)}`)
  })

  test('robots.txt blocking the feed is a block', async () => {
    const { fetcher } = fakeFetcher({ [page(0)]: null })
    expect(await rejection(oracle.list(fetcher, BOARD, NOW))).toBeInstanceOf(BlockedError)
  })
})
