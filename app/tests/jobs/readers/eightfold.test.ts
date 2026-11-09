import { describe, expect, test } from 'vitest'
import { eightfold } from '../../../src/main/jobs/readers/eightfold'
import { BlockedError, fakeFetcher, fixture, rejection } from './helpers'

const BOARD = 'vale.eightfold.ai|vale.com'
const NOW = new Date(2026, 10, 6, 12, 0, 0)
const page = (start: number): string =>
  `https://vale.eightfold.ai/api/apply/v2/jobs?domain=vale.com&start=${start}&num=10`

function fixtureWith(count: number): string {
  const data = JSON.parse(fixture('eightfold.json'))
  data.count = count
  return JSON.stringify(data)
}

/** A feed page of `n` made-up positions from `from`, under `count`. */
function feed(count: unknown, from: number, n: number): string {
  const positions = Array.from({ length: n }, (_, i) => ({
    id: from + i,
    name: `Job ${from + i}`,
    location: 'Sudbury, ON, Canada',
    locations: ['Sudbury, ON, Canada'],
    t_create: 1793727738,
    canonicalPositionUrl: `https://vale.eightfold.ai/careers/job/${from + i}`
  }))
  return JSON.stringify({ count, positions })
}

describe('eightfold reader', () => {
  test('reads the fixture: one request, every position, and one full RawJob', async () => {
    const { fetcher, urls } = fakeFetcher({ [page(0)]: fixtureWith(3) })
    const r = await eightfold.list(fetcher, BOARD, NOW)
    expect(urls).toEqual([page(0)])
    expect(r.jobs).toHaveLength(3)
    expect(r.complete).toBe(true)
    expect(r.note).toBeNull()
    expect(r.jobs[1]).toEqual({
      sourceId: '45345970',
      title: 'Supervisor, Maintenance (PS)',
      location: 'Sudbury, ON, Canada',
      countries: ['CA'],
      employment: 'unknown',
      url: 'https://vale.eightfold.ai/careers/job/45345970',
      postedAt: new Date(1793727738 * 1000).toISOString(),
      postedRough: false,
      needsDetails: false
    })
  })

  test('a bare country is dropped beside a place in it, and codes and local names find the country', async () => {
    const { fetcher } = fakeFetcher({ [page(0)]: fixtureWith(3) })
    const jobs = (await eightfold.list(fetcher, BOARD, NOW)).jobs
    expect(jobs.map((j) => [j.location, j.countries])).toEqual([
      // "PA" here is Pará, not Pennsylvania: the last part decides.
      ['Canaã dos Carajás, PA, Brasil', ['BR']],
      ['Sudbury, ON, Canada', ['CA']],
      // "CA" is Canada, not California.
      ['Sudbury, On, CA | Toronto, On, CA', ['CA']]
    ])
  })

  test('a position with only a country keeps it', async () => {
    const data = JSON.parse(feed(1, 0, 1))
    data.positions[0].locations = ['Canada']
    const { fetcher } = fakeFetcher({ [page(0)]: JSON.stringify(data) })
    const [job] = (await eightfold.list(fetcher, BOARD, NOW)).jobs
    expect(job.location).toBe('Canada')
    expect(job.countries).toEqual(['CA'])
  })

  test('the job type comes from the title', async () => {
    const data = JSON.parse(feed(1, 0, 1))
    data.positions[0].name = 'Summer Student - Engineering Intern'
    const { fetcher } = fakeFetcher({ [page(0)]: JSON.stringify(data) })
    expect((await eightfold.list(fetcher, BOARD, NOW)).jobs[0].employment).toBe('intern')
  })

  test('pages by 10 up to the count', async () => {
    const { fetcher, urls } = fakeFetcher({
      [page(0)]: feed(23, 0, 10),
      [page(10)]: feed(23, 10, 10),
      [page(20)]: feed(23, 20, 3)
    })
    const r = await eightfold.list(fetcher, BOARD, NOW)
    expect(urls).toEqual([page(0), page(10), page(20)])
    expect(r.jobs).toHaveLength(23)
    expect(r.complete).toBe(true)
  })

  test('stops at 2000 positions and says the read is incomplete', async () => {
    const routes: Record<string, string> = {}
    for (let s = 0; s < 2100; s += 10) routes[page(s)] = feed(4000, s, 10)
    const { fetcher, urls } = fakeFetcher(routes)
    const r = await eightfold.list(fetcher, BOARD, NOW)
    expect(urls).toHaveLength(200)
    expect(r.jobs).toHaveLength(2000)
    expect(r.complete).toBe(false)
    expect(r.note).toBe('Eightfold: only the first 2000 jobs were read')
  })

  test('an empty list is an empty complete list', async () => {
    const { fetcher } = fakeFetcher({ [page(0)]: feed(0, 0, 0) })
    expect(await eightfold.list(fetcher, BOARD, NOW)).toEqual({
      jobs: [],
      complete: true,
      note: null
    })
  })

  test.each([
    ['not JSON', '<html>Sign in</html>'],
    ['no positions', '{"count": 3}'],
    ['no count', feed(undefined, 0, 3)],
    ['a count below the rows', feed(1, 0, 3)]
  ])('a feed with %s is not recognised', async (_name, body) => {
    const { fetcher } = fakeFetcher({ [page(0)]: body })
    const e = await rejection(eightfold.list(fetcher, BOARD, NOW))
    expect((e as Error).message).toBe(`Job list not recognised on ${page(0)}`)
  })

  test('an empty page while the count says more is not recognised', async () => {
    const { fetcher } = fakeFetcher({ [page(0)]: feed(15, 0, 10), [page(10)]: feed(15, 10, 0) })
    const e = await rejection(eightfold.list(fetcher, BOARD, NOW))
    expect((e as Error).message).toBe(`Job list not recognised on ${page(10)}`)
  })

  test('robots.txt blocking the feed is a block', async () => {
    const { fetcher } = fakeFetcher({ [page(0)]: null })
    expect(await rejection(eightfold.list(fetcher, BOARD, NOW))).toBeInstanceOf(BlockedError)
  })
})
