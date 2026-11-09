import { describe, expect, test } from 'vitest'
import { workday } from '../../../src/main/jobs/readers/workday'
import type { Fetcher, FetchResult } from '../../../src/main/readers/fetcher'
import type { RawJob } from '../../../src/shared/types'
import { BlockedError, fakeFetcher, fixture, rejection } from './helpers'

const BOARD = 'abb.wd3/External_Career_Page'
const HOST = 'https://abb.wd3.myworkdayjobs.com'
const LIST_URL = `${HOST}/wday/cxs/abb/External_Career_Page/jobs`
const NOW = new Date(2026, 10, 4, 12, 0, 0)

interface ListBody {
  appliedFacets: unknown
  limit: number
  offset: number
  searchText: string
}

/** A fetcher whose list POST answers with the page for the requested offset (null is robots.txt). */
function listFetcher(pageFor: (offset: number) => unknown): {
  fetcher: Fetcher
  bodies: ListBody[]
} {
  const bodies: ListBody[] = []
  const fetcher: Fetcher = {
    async get(): Promise<FetchResult | null> {
      throw new Error('get must not be called')
    },
    async post(url, json): Promise<FetchResult | null> {
      expect(url).toBe(LIST_URL)
      const body = json as ListBody
      bodies.push(body)
      const page = pageFor(body.offset)
      return page === null ? null : { status: 200, body: JSON.stringify(page), url }
    },
    async getBytes(): Promise<never> {
      throw new Error('getBytes must not be called')
    }
  }
  return { fetcher, bodies }
}

function posts(from: number, count: number): Record<string, string>[] {
  return Array.from({ length: count }, (_, i) => ({
    externalPath: `/job/Oslo/Job_${from + i}`,
    title: `Job ${from + i}`,
    locationsText: 'Oslo, Norway',
    postedOn: 'Posted Today'
  }))
}

const ONE_PATH = '/job/x/Y_1'

function onePost(postedOn: string): unknown {
  return {
    total: 1,
    jobPostings: [{ externalPath: ONE_PATH, title: 'Y', locationsText: 'Oslo', postedOn }]
  }
}

const PATH =
  '/job/Saint-Laurent-Quebec-Canada/Senior-Field-Service-Technician---Electrification_JR00035712'
const DETAIL_URL = `${HOST}/wday/cxs/abb/External_Career_Page${PATH}`

function raw(over: Partial<RawJob> = {}): RawJob {
  return {
    sourceId: 'JR00035712',
    title: 'Senior Field Service Technician - Electrification',
    location: 'Saint-Laurent, Quebec, Canada',
    countries: [],
    employment: 'unknown',
    url: `${HOST}/External_Career_Page${PATH}`,
    postedAt: null,
    postedRough: false,
    needsDetails: true,
    ...over
  }
}

describe('workday reader', () => {
  test('reads the first page of the fixture', async () => {
    const { fetcher, bodies } = listFetcher(() => ({
      ...JSON.parse(fixture('workday-list.json')),
      total: 3
    }))
    const r = await workday.list(fetcher, BOARD, NOW)
    expect(bodies[0]).toEqual({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' })
    expect(r.jobs).toHaveLength(3)
    expect(r.jobs[0]).toEqual({
      sourceId: 'JR00043434',
      title: 'Fabrication Supervisor - 2nd Shift',
      location: 'USA, NC, Mebane',
      countries: ['US'],
      employment: 'unknown',
      url: `${HOST}/External_Career_Page/job/USA-NC-Mebane/Fabrication-Supervisor---2nd-Shift_JR00043434`,
      postedAt: new Date(2026, 10, 4).toISOString(),
      postedRough: false,
      needsDetails: true
    })
  })

  test('pages by 20 up to total', async () => {
    const { fetcher, bodies } = listFetcher((offset) => ({
      // Later pages may report total 0; only the first page's total counts.
      total: offset === 0 ? 45 : 0,
      jobPostings: posts(offset, Math.min(20, 45 - offset))
    }))
    const r = await workday.list(fetcher, BOARD, NOW)
    expect(bodies.map((b) => b.offset)).toEqual([0, 20, 40])
    expect(r.jobs).toHaveLength(45)
    expect(r.complete).toBe(true)
    expect(r.note).toBeNull()
  })

  test('stops at 2000 and says the read is incomplete', async () => {
    const { fetcher, bodies } = listFetcher((offset) => ({
      total: offset === 0 ? 2000 : 0,
      jobPostings: posts(offset, 20)
    }))
    const r = await workday.list(fetcher, BOARD, NOW)
    expect(bodies).toHaveLength(100)
    expect(bodies[99].offset).toBe(1980)
    expect(bodies.map((b) => b.offset)).not.toContain(2000)
    expect(r.jobs).toHaveLength(2000)
    expect(r.complete).toBe(false)
    expect(r.note).toBe('Workday shows only the first 2000 jobs')
  })

  test('an empty first page is an empty complete list', async () => {
    const { fetcher } = listFetcher(() => ({ total: 0, jobPostings: [] }))
    expect(await workday.list(fetcher, BOARD, NOW)).toEqual({
      jobs: [],
      complete: true,
      note: null
    })
  })

  test('a response without a job list is not recognised', async () => {
    const { fetcher } = listFetcher(() => ({ errorCode: 'HTTP_400' }))
    const e = await rejection(workday.list(fetcher, BOARD, NOW))
    expect((e as Error).message).toBe(`Job list not recognised on ${LIST_URL}`)
  })

  test.each([
    ['missing', undefined],
    ['zero', 0]
  ])('rows on the first page with total %s are not recognised', async (_name, total) => {
    const { fetcher } = listFetcher(() => ({ total, jobPostings: posts(0, 20) }))
    const e = await rejection(workday.list(fetcher, BOARD, NOW))
    expect((e as Error).message).toBe(`Job list not recognised on ${LIST_URL}`)
  })

  test('an empty page while total says more is not recognised', async () => {
    const { fetcher } = listFetcher((offset) => ({
      total: offset === 0 ? 45 : 0,
      jobPostings: offset === 0 ? posts(0, 20) : []
    }))
    const e = await rejection(workday.list(fetcher, BOARD, NOW))
    expect((e as Error).message).toBe(`Job list not recognised on ${LIST_URL}`)
  })

  test('robots.txt blocking the list is a block', async () => {
    const { fetcher } = listFetcher(() => null)
    expect(await rejection(workday.list(fetcher, BOARD, NOW))).toBeInstanceOf(BlockedError)
  })

  test.each([
    ['Posted Today', 0, false],
    ['Posted Yesterday', 1, false],
    ['Posted 5 Days Ago', 5, false],
    ['Posted 30+ Days Ago', 30, true]
  ])('posted dates: %s', async (postedOn, daysBack, rough) => {
    const { fetcher } = listFetcher(() => onePost(postedOn))
    const [job] = (await workday.list(fetcher, BOARD, NOW)).jobs
    expect(job.postedAt).toBe(new Date(2026, 10, 4 - daysBack).toISOString())
    expect(job.postedRough).toBe(rough)
  })

  test('posted dates: anything else is unknown', async () => {
    const { fetcher } = listFetcher(() => onePost('Soon'))
    const [job] = (await workday.list(fetcher, BOARD, NOW)).jobs
    expect(job.postedAt).toBeNull()
    expect(job.postedRough).toBe(false)
  })

  test('the job link is the Site page', async () => {
    const { fetcher } = listFetcher(() => onePost('Posted Today'))
    const [job] = (await workday.list(fetcher, BOARD, NOW)).jobs
    expect(job.url).toBe(`${HOST}/External_Career_Page${ONE_PATH}`)
  })

  test('the job id is the requisition id after the last _ when it has a digit, else the path', async () => {
    const paths = [
      '/job/Zurich/Project-Manager_JR00012345',
      '/job/USA-AR-Jonesboro/Press-Team-Lead_JR00052649-1',
      '/job/Zurich/Project_Manager_R-123',
      // Normet's requisition ids carry their own '_': the part after the last one is still the id.
      '/job/Noida/Site-HR_R_006988-1',
      '/job/Zurich/Project-Manager',
      '/job/Zurich/Project_Manager',
      '/job/Zurich_2/Project-Manager'
    ]
    const { fetcher } = listFetcher(() => ({
      total: paths.length,
      jobPostings: paths.map((externalPath) => ({ externalPath, title: 'PM', postedOn: '' }))
    }))
    const r = await workday.list(fetcher, BOARD, NOW)
    expect(r.jobs.map((j) => j.sourceId)).toEqual([
      'JR00012345',
      'JR00052649-1',
      'R-123',
      '006988-1',
      '/job/Zurich/Project-Manager',
      '/job/Zurich/Project_Manager',
      '/job/Zurich_2/Project-Manager'
    ])
    // The link keeps the full path.
    expect(r.jobs[0].url).toBe(`${HOST}/External_Career_Page/job/Zurich/Project-Manager_JR00012345`)
  })

  test('details fill country, job type and date', async () => {
    const job = raw()
    const { fetcher, urls } = fakeFetcher({ [DETAIL_URL]: fixture('workday-detail.json') })
    const d = await workday.details!(fetcher, BOARD, job)
    expect(urls).toEqual([DETAIL_URL])
    expect(d).toEqual({
      ...job,
      countries: ['CA'],
      employment: 'full_time',
      postedAt: '2026-11-04T00:00:00.000Z',
      needsDetails: false
    })
    expect(job.needsDetails).toBe(true)
  })

  test('details merge additional locations, and keep the list countries when none are given', async () => {
    const job = raw({ countries: ['NO'] })
    const merged = JSON.stringify({
      jobPostingInfo: {
        jobRequisitionLocation: { country: { alpha2Code: 'SE' } },
        additionalLocations: ['Oslo, Norway', 'Stockholm, Sweden'],
        timeType: 'Part time'
      }
    })
    const a = await workday.details!(fakeFetcher({ [DETAIL_URL]: merged }).fetcher, BOARD, job)
    expect(a.countries).toEqual(['SE', 'NO'])
    expect(a.employment).toBe('part_time')
    expect(a.postedAt).toBeNull()

    const none = JSON.stringify({ jobPostingInfo: { timeType: 'Full time' } })
    const b = await workday.details!(fakeFetcher({ [DETAIL_URL]: none }).fetcher, BOARD, job)
    expect(b.countries).toEqual(['NO'])
  })

  test('a job whose link is not on the board has no detail page to read', async () => {
    const job = raw({ url: 'https://elsewhere.test/job/1' })
    const { fetcher, urls } = fakeFetcher({})
    const e = await rejection(workday.details!(fetcher, BOARD, job))
    expect((e as Error).message).toBe('Job list not recognised on https://elsewhere.test/job/1')
    expect(urls).toEqual([])
  })

  describe('site form (wdN.myworkdaysite.com/tenant/Site)', () => {
    const SITE_BOARD = 'wd3.myworkdaysite.com/magna/Magna'
    const SITE_HOST = 'https://wd3.myworkdaysite.com'
    const SITE_PATH = '/job/Carrollton-Georgia-US/Aftersales-Coordintor_R00267321'

    test('lists from the site host, and links each job under /recruiting/tenant/Site', async () => {
      const urls: string[] = []
      const fetcher: Fetcher = {
        async get(): Promise<FetchResult | null> {
          throw new Error('get must not be called')
        },
        async post(url): Promise<FetchResult | null> {
          urls.push(url)
          const page = {
            total: 1,
            jobPostings: [
              {
                externalPath: SITE_PATH,
                title: 'Aftersales Coordinator',
                locationsText: 'Carrollton, Georgia, US',
                postedOn: 'Posted Today'
              }
            ]
          }
          return { status: 200, body: JSON.stringify(page), url }
        },
        async getBytes(): Promise<never> {
          throw new Error('getBytes must not be called')
        }
      }
      const r = await workday.list(fetcher, SITE_BOARD, NOW)
      expect(urls).toEqual([`${SITE_HOST}/wday/cxs/magna/Magna/jobs`])
      expect(r.jobs[0].sourceId).toBe('R00267321')
      expect(r.jobs[0].url).toBe(`${SITE_HOST}/recruiting/magna/Magna${SITE_PATH}`)
    })

    test('details read the job from the site host', async () => {
      const detail = `${SITE_HOST}/wday/cxs/magna/Magna${SITE_PATH}`
      const job = raw({ url: `${SITE_HOST}/recruiting/magna/Magna${SITE_PATH}` })
      const { fetcher, urls } = fakeFetcher({ [detail]: fixture('workday-detail.json') })
      const d = await workday.details!(fetcher, SITE_BOARD, job)
      expect(urls).toEqual([detail])
      expect(d.needsDetails).toBe(false)
    })
  })

  test('a detail response without jobPostingInfo is not recognised', async () => {
    const e = await rejection(
      workday.details!(fakeFetcher({ [DETAIL_URL]: '{"x":1}' }).fetcher, BOARD, raw())
    )
    expect((e as Error).message).toBe(`Job list not recognised on ${DETAIL_URL}`)
  })
})
