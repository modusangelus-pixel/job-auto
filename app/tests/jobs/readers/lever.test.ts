import { describe, expect, test } from 'vitest'
import { lever } from '../../../src/main/jobs/readers/lever'
import { BlockedError, fakeFetcher, fixture, rejection } from './helpers'

const NOW = new Date('2026-11-04T12:00:00Z')
const url = (host: string, board: string, skip: number): string =>
  `https://${host}/v0/postings/${board}?mode=json&limit=100&skip=${skip}`

describe('lever reader', () => {
  test('reads the feed', async () => {
    const u = url('api.lever.co', 'teleo', 0)
    const { fetcher, urls } = fakeFetcher({ [u]: fixture('lever.json') })
    const r = await lever.list(fetcher, 'teleo', NOW)
    expect(urls).toEqual([u])
    expect(r.complete).toBe(true)
    expect(r.jobs).toHaveLength(5)
    expect(r.jobs[1]).toEqual({
      sourceId: '9d333c68-03ef-4916-ae71-4e52d198fe77',
      title: 'Field Electro-Mechanical Tech',
      location: 'Palo Alto, CA',
      countries: ['US'],
      employment: 'full_time',
      url: 'https://jobs.lever.co/teleo/9d333c68-03ef-4916-ae71-4e52d198fe77',
      postedAt: new Date(1792782979716).toISOString(),
      postedRough: false,
      needsDetails: false
    })
  })

  test('lever pages with skip until a short page', async () => {
    const job = (i: number): object => ({
      id: `id${i}`,
      text: `Job ${i}`,
      country: 'DE',
      categories: {
        location: 'Berlin',
        allLocations: ['Berlin', 'Paris, France'],
        commitment: 'Intern'
      },
      hostedUrl: `https://jobs.lever.co/x/id${i}`,
      createdAt: 'not a date'
    })
    const page1 = JSON.stringify(Array.from({ length: 100 }, (_, i) => job(i)))
    const page2 = JSON.stringify(Array.from({ length: 3 }, (_, i) => job(100 + i)))
    const { fetcher, urls } = fakeFetcher({
      [url('api.eu.lever.co', 'x', 0)]: page1,
      [url('api.eu.lever.co', 'x', 100)]: page2
    })
    const r = await lever.list(fetcher, 'eu:x', NOW)
    expect(urls).toEqual([url('api.eu.lever.co', 'x', 0), url('api.eu.lever.co', 'x', 100)])
    expect(r.jobs).toHaveLength(103)
    expect(r.complete).toBe(true)
    expect(r.jobs[0].location).toBe('Berlin; Paris, France')
    expect(r.jobs[0].countries).toEqual(['DE', 'FR'])
    expect(r.jobs[0].employment).toBe('intern')
    expect(r.jobs[0].postedAt).toBeNull()
  })

  test('an empty array is an empty complete list', async () => {
    const { fetcher } = fakeFetcher({ [url('api.lever.co', 'x', 0)]: '[]' })
    expect(await lever.list(fetcher, 'x', NOW)).toEqual({ jobs: [], complete: true, note: null })
  })

  test('a non-array body is not recognised', async () => {
    const u = url('api.lever.co', 'x', 0)
    const { fetcher } = fakeFetcher({ [u]: '{"ok":false}' })
    await expect(lever.list(fetcher, 'x', NOW)).rejects.toThrow(`Job list not recognised on ${u}`)
  })

  test('a 404 board throws HTTP 404', async () => {
    const u = url('api.lever.co', 'x', 0)
    const { fetcher } = fakeFetcher({ [u]: 404 })
    await expect(lever.list(fetcher, 'x', NOW)).rejects.toThrow(`HTTP 404 from ${u}`)
  })

  test('robots null throws BlockedError', async () => {
    const { fetcher } = fakeFetcher({ [url('api.lever.co', 'x', 0)]: null })
    expect(await rejection(lever.list(fetcher, 'x', NOW))).toBeInstanceOf(BlockedError)
  })
})
