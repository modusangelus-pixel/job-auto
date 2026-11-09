import { describe, expect, test } from 'vitest'
import { greenhouse } from '../../../src/main/jobs/readers/greenhouse'
import { BlockedError, fakeFetcher, fixture, rejection } from './helpers'

const NOW = new Date('2026-11-04T12:00:00Z')
const API = 'https://boards-api.greenhouse.io/v1/boards/scaleai/jobs'

describe('greenhouse reader', () => {
  test('reads the API feed', async () => {
    const { fetcher, urls } = fakeFetcher({ [API]: fixture('greenhouse-api.json') })
    const r = await greenhouse.list(fetcher, 'scaleai', NOW)
    expect(urls).toEqual([API])
    expect(r.complete).toBe(true)
    expect(r.note).toBeNull()
    expect(r.jobs).toHaveLength(5)
    expect(r.jobs[0]).toEqual({
      sourceId: '4739727005',
      title: 'Account Based Marketing Lead',
      location: 'San Francisco, CA; New York, NY',
      countries: ['US'],
      employment: 'unknown',
      url: 'https://job-boards.greenhouse.io/scaleai/jobs/4739727005',
      postedAt: '2026-10-01T23:38:55.000Z',
      postedRough: false,
      needsDetails: false
    })
  })

  test('an empty jobs array is an empty complete list', async () => {
    const { fetcher } = fakeFetcher({ [API]: '{"jobs":[]}' })
    expect(await greenhouse.list(fetcher, 'scaleai', NOW)).toEqual({
      jobs: [],
      complete: true,
      note: null
    })
  })

  test('a feed without a jobs array is not recognised', async () => {
    const { fetcher } = fakeFetcher({ [API]: '{"error":"x"}' })
    await expect(greenhouse.list(fetcher, 'scaleai', NOW)).rejects.toThrow(
      `Job list not recognised on ${API}`
    )
  })

  test('a 404 board throws HTTP 404', async () => {
    const { fetcher } = fakeFetcher({ [API]: 404 })
    await expect(greenhouse.list(fetcher, 'scaleai', NOW)).rejects.toThrow(`HTTP 404 from ${API}`)
  })

  test('robots null throws BlockedError', async () => {
    const { fetcher } = fakeFetcher({ [API]: null })
    const e = await rejection(greenhouse.list(fetcher, 'scaleai', NOW))
    expect(e).toBeInstanceOf(BlockedError)
    expect((e as BlockedError).host).toBe('boards-api.greenhouse.io')
    expect((e as BlockedError).reason).toBe('robots.txt does not allow reading this page')
  })

  test('eu reads the board page markup', async () => {
    const page1 = fixture('greenhouse-page.html')
      .replace('"total_pages":4', '"total_pages":1')
      .replace('"total":166', '"total":5')
    const url = 'https://job-boards.eu.greenhouse.io/acme?page=1'
    const { fetcher, urls } = fakeFetcher({ [url]: page1 })
    const r = await greenhouse.list(fetcher, 'eu:acme', NOW)
    expect(urls).toEqual([url])
    expect(r.complete).toBe(true)
    expect(r.jobs).toHaveLength(5)
    expect(r.jobs[0]).toEqual({
      sourceId: '4745021005',
      title: 'Infrastructure Software Engineer, Apps Platform',
      location: 'London, UK',
      countries: ['GB'],
      employment: 'unknown',
      url: 'https://job-boards.greenhouse.io/scaleai/jobs/4745021005',
      postedAt: '2026-10-20T10:20:20.000Z',
      postedRough: false,
      needsDetails: false
    })
  })

  test('greenhouse eu reads every page', async () => {
    const page = (n: number, id: number): string =>
      `<script>x = {"jobPosts":{"count":1,"page":${n},"total_pages":2,"data":[{"id":${id},"title":"Job {braced} \\"${n}\\"","location":"Berlin, Germany","absolute_url":"https://e/${id}","published_at":null}]},"y":1}</script>`
    const base = 'https://job-boards.eu.greenhouse.io/acme?page='
    const { fetcher, urls } = fakeFetcher({ [`${base}1`]: page(1, 11), [`${base}2`]: page(2, 22) })
    const r = await greenhouse.list(fetcher, 'eu:acme', NOW)
    expect(urls).toEqual([`${base}1`, `${base}2`])
    expect(r.jobs.map((j) => j.sourceId)).toEqual(['11', '22'])
    expect(r.jobs[1].title).toBe('Job {braced} "2"')
    expect(r.jobs[1].countries).toEqual(['DE'])
    expect(r.jobs[1].postedAt).toBeNull()
    expect(r.complete).toBe(true)
  })

  /** An EU board page whose jobPosts carry the given paging fields and one row per id. */
  const euPage = (paging: string, ids: number[]): string =>
    `<script>x = {"jobPosts":{${paging}"data":[${ids
      .map(
        (id) =>
          `{"id":${id},"title":"Job ${id}","location":"Berlin","absolute_url":"https://e/${id}"}`
      )
      .join(',')}]}}</script>`
  const EU = 'https://job-boards.eu.greenhouse.io/acme?page='

  test.each([
    ['missing', ''],
    ['null', '"total_pages":null,'],
    ['text', '"total_pages":"2",'],
    ['a fraction', '"total_pages":1.5,'],
    ['zero with rows', '"total_pages":0,']
  ])('an eu page whose total_pages is %s is not recognised', async (_name, paging) => {
    const { fetcher } = fakeFetcher({ [`${EU}1`]: euPage(paging, [1]) })
    await expect(greenhouse.list(fetcher, 'eu:acme', NOW)).rejects.toThrow(
      `Job list not recognised on ${EU}1`
    )
  })

  test('an eu board with no jobs and no pages is an empty complete list', async () => {
    const { fetcher, urls } = fakeFetcher({ [`${EU}1`]: euPage('"total":0,"total_pages":0,', []) })
    expect(await greenhouse.list(fetcher, 'eu:acme', NOW)).toEqual({
      jobs: [],
      complete: true,
      note: null
    })
    expect(urls).toEqual([`${EU}1`])
  })

  test('eu rows fewer than the stated total make the read incomplete', async () => {
    const { fetcher } = fakeFetcher({
      [`${EU}1`]: euPage('"total":3,"total_pages":2,', [1]),
      [`${EU}2`]: euPage('"total":3,"total_pages":2,', [2])
    })
    const r = await greenhouse.list(fetcher, 'eu:acme', NOW)
    expect(r.jobs.map((j) => j.sourceId)).toEqual(['1', '2'])
    expect(r.complete).toBe(false)
    expect(r.note).toBe('Read 2 of 3 jobs')
  })

  test('eu stops after 100 pages and says the read is incomplete', async () => {
    const routes: Record<string, string> = {}
    for (let p = 1; p <= 101; p++) routes[`${EU}${p}`] = euPage('"total_pages":150,', [p])
    const { fetcher, urls } = fakeFetcher(routes)
    const r = await greenhouse.list(fetcher, 'eu:acme', NOW)
    expect(urls).toHaveLength(100)
    expect(r.jobs).toHaveLength(100)
    expect(r.complete).toBe(false)
    expect(r.note).toBe('Stopped after 100 pages')
  })

  test('an eu page without jobPosts is not recognised', async () => {
    const url = 'https://job-boards.eu.greenhouse.io/acme?page=1'
    const { fetcher } = fakeFetcher({ [url]: '<html>nothing</html>' })
    await expect(greenhouse.list(fetcher, 'eu:acme', NOW)).rejects.toThrow(
      `Job list not recognised on ${url}`
    )
  })
})
