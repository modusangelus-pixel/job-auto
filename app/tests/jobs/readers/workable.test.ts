import { describe, expect, test } from 'vitest'
import { workable } from '../../../src/main/jobs/readers/workable'
import { BlockedError, fakeFetcher, fixture, rejection } from './helpers'

const NOW = new Date('2026-11-04T12:00:00Z')
const FEED = 'https://apply.workable.com/api/v1/widget/accounts/exotec'

describe('workable reader', () => {
  test('reads the feed', async () => {
    const { fetcher, urls } = fakeFetcher({ [FEED]: fixture('workable.json') })
    const r = await workable.list(fetcher, 'exotec', NOW)
    expect(urls).toEqual([FEED])
    expect(r.complete).toBe(true)
    expect(r.jobs).toHaveLength(5)
    expect(r.jobs[0]).toEqual({
      sourceId: '0D5CDB123C',
      title: 'Account Manager - Warehouse Automation',
      location: 'Tokyo, Japan',
      countries: ['JP'],
      employment: 'full_time',
      url: 'https://apply.workable.com/j/0D5CDB123C',
      postedAt: '2026-10-07T00:00:00.000Z',
      postedRough: false,
      needsDetails: false
    })
  })

  test('merges country and location country codes; unmappable values are ignored', async () => {
    const body = JSON.stringify({
      jobs: [
        {
          shortcode: 'X1',
          title: 'T',
          city: 'Lyon',
          country: 'France',
          locations: [{ countryCode: 'fr' }, { countryCode: 'zz' }, { countryCode: 'BE' }],
          employment_type: 'Part-time',
          url: 'u',
          published_on: ''
        }
      ]
    })
    const { fetcher } = fakeFetcher({ [FEED]: body })
    const r = await workable.list(fetcher, 'exotec', NOW)
    expect(r.jobs[0].countries).toEqual(['FR', 'BE'])
    expect(r.jobs[0].employment).toBe('part_time')
    expect(r.jobs[0].postedAt).toBeNull()
  })

  test('an empty jobs array is an empty complete list', async () => {
    const { fetcher } = fakeFetcher({ [FEED]: '{"name":"x","jobs":[]}' })
    expect(await workable.list(fetcher, 'exotec', NOW)).toEqual({
      jobs: [],
      complete: true,
      note: null
    })
  })

  test('a body without jobs is not recognised', async () => {
    const { fetcher } = fakeFetcher({ [FEED]: '{"name":"x"}' })
    await expect(workable.list(fetcher, 'exotec', NOW)).rejects.toThrow(
      `Job list not recognised on ${FEED}`
    )
  })

  test('a 404 board throws HTTP 404', async () => {
    const { fetcher } = fakeFetcher({ [FEED]: 404 })
    await expect(workable.list(fetcher, 'exotec', NOW)).rejects.toThrow(`HTTP 404 from ${FEED}`)
  })

  test('robots null throws BlockedError', async () => {
    const { fetcher } = fakeFetcher({ [FEED]: null })
    expect(await rejection(workable.list(fetcher, 'exotec', NOW))).toBeInstanceOf(BlockedError)
  })
})
