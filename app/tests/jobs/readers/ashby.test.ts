import { describe, expect, test } from 'vitest'
import { ashby } from '../../../src/main/jobs/readers/ashby'
import { BlockedError, fakeFetcher, fixture, rejection } from './helpers'

const NOW = new Date('2026-11-04T12:00:00Z')
const FEED = 'https://api.ashbyhq.com/posting-api/job-board/applied?includeCompensation=false'

describe('ashby reader', () => {
  test('reads the feed', async () => {
    const { fetcher, urls } = fakeFetcher({ [FEED]: fixture('ashby.json') })
    const r = await ashby.list(fetcher, 'applied', NOW)
    expect(urls).toEqual([FEED])
    expect(r.complete).toBe(true)
    expect(r.jobs).toHaveLength(5)
    expect(r.jobs[0]).toEqual({
      sourceId: 'b2258b1e-336f-4412-aafb-7e5f4e612c7e',
      title: 'System Designer',
      location: 'Sunnyvale',
      countries: ['US'],
      employment: 'full_time',
      url: 'https://jobs.ashbyhq.com/applied/b2258b1e-336f-4412-aafb-7e5f4e612c7e',
      postedAt: '2026-08-30T05:31:25.211Z',
      postedRough: false,
      needsDetails: false
    })
  })

  test('skips unlisted jobs, merges locations and countries', async () => {
    const body = JSON.stringify({
      jobs: [
        { id: 'a', title: 'A', isListed: false, location: 'Oslo' },
        {
          id: 'b',
          title: 'B',
          location: 'Stockholm, Sweden',
          secondaryLocations: [{ location: 'Oslo, Norway' }, { location: 'Stockholm, Sweden' }],
          address: { postalAddress: { addressCountry: 'Narnia' } },
          employmentType: 'Contract'
        },
        {
          id: 'c',
          title: 'C',
          location: 'Remote',
          address: { postalAddress: { addressCountry: 'Germany' } }
        }
      ]
    })
    const { fetcher } = fakeFetcher({ [FEED]: body })
    const r = await ashby.list(fetcher, 'applied', NOW)
    expect(r.jobs.map((j) => j.sourceId)).toEqual(['b', 'c'])
    expect(r.jobs[0].location).toBe('Stockholm, Sweden; Oslo, Norway')
    expect(r.jobs[0].countries).toEqual(['SE', 'NO'])
    expect(r.jobs[0].employment).toBe('fixed_term')
    expect(r.jobs[1].countries).toEqual(['DE'])
    expect(r.jobs[1].url).toBe('')
    expect(r.jobs[1].postedAt).toBeNull()
  })

  test('an empty jobs array is an empty complete list', async () => {
    const { fetcher } = fakeFetcher({ [FEED]: '{"jobs":[]}' })
    expect(await ashby.list(fetcher, 'applied', NOW)).toEqual({
      jobs: [],
      complete: true,
      note: null
    })
  })

  test('a body without jobs is not recognised', async () => {
    const { fetcher } = fakeFetcher({ [FEED]: '{"apiVersion":"1"}' })
    await expect(ashby.list(fetcher, 'applied', NOW)).rejects.toThrow(
      `Job list not recognised on ${FEED}`
    )
  })

  test('a 404 board throws HTTP 404', async () => {
    const { fetcher } = fakeFetcher({ [FEED]: 404 })
    await expect(ashby.list(fetcher, 'applied', NOW)).rejects.toThrow(`HTTP 404 from ${FEED}`)
  })

  test('robots null throws BlockedError', async () => {
    const { fetcher } = fakeFetcher({ [FEED]: null })
    expect(await rejection(ashby.list(fetcher, 'applied', NOW))).toBeInstanceOf(BlockedError)
  })
})
