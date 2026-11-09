import { describe, expect, test } from 'vitest'
import { comeet } from '../../../src/main/jobs/readers/comeet'
import { BlockedError, fakeFetcher, fixture, rejection } from './helpers'

const BOARD = 'autobrains/57.004'
const URL = 'https://www.comeet.com/jobs/autobrains/57.004'
const NOW = new Date(2026, 10, 6, 12, 0, 0)

const page = (positions: unknown): string =>
  `<script>var COMPANY_POSITIONS_DATA ;\nCOMPANY_POSITIONS_DATA = ${JSON.stringify(positions)};\n</script>`

describe('comeet reader', () => {
  test('reads every position on the page, complete, with one full RawJob', async () => {
    const { fetcher, urls } = fakeFetcher({ [URL]: fixture('comeet.html') })
    const r = await comeet.list(fetcher, BOARD, NOW)
    expect(urls).toEqual([URL])
    expect(r.jobs).toHaveLength(4)
    expect(r.complete).toBe(true)
    expect(r.note).toBeNull()
    expect(r.jobs[0]).toEqual({
      sourceId: '3C.27F',
      title: 'Applied AI Scientist (Ph.D) - On Site',
      location: 'Tel Aviv, Israel',
      countries: ['IL'],
      employment: 'full_time',
      url: 'https://www.comeet.com/jobs/autobrains/57.004/applied-ai-scientist-ph_d---on-site/3C.27F',
      postedAt: '2026-10-20T15:22:14.000Z',
      postedRough: false,
      needsDetails: false
    })
    expect(r.jobs.map((j) => [j.location, j.countries])).toEqual([
      ['Tel Aviv, Israel', ['IL']],
      ['Tel Aviv, Israel', ['IL']],
      ['Munich, Germany', ['DE']],
      ['Munich, Germany', ['DE']]
    ])
  })

  test('the job type comes from the position, else the title', async () => {
    const { fetcher } = fakeFetcher({
      [URL]: page([
        { uid: 'A', name: 'Engineer', employment_type: 'Part-time', location: null },
        { uid: 'B', name: 'Summer Intern', employment_type: null, location: null }
      ])
    })
    const jobs = (await comeet.list(fetcher, BOARD, NOW)).jobs
    expect(jobs.map((j) => j.employment)).toEqual(['part_time', 'intern'])
    // No location: no place and no country.
    expect(jobs[0].location).toBe('')
    expect(jobs[0].countries).toEqual([])
  })

  test('a position without a link gets the board page; one without a uid or a name is dropped', async () => {
    const { fetcher } = fakeFetcher({
      [URL]: page([
        { uid: 'A', name: 'Engineer', location: { name: 'Haifa', country: 'IL' } },
        { uid: '', name: 'No id' },
        { uid: 'C', name: '' }
      ])
    })
    const jobs = (await comeet.list(fetcher, BOARD, NOW)).jobs
    expect(jobs).toHaveLength(1)
    expect(jobs[0].url).toBe(URL)
    expect(jobs[0].postedAt).toBeNull()
  })

  test('an empty list of positions is an empty complete list', async () => {
    const { fetcher } = fakeFetcher({ [URL]: page([]) })
    expect(await comeet.list(fetcher, BOARD, NOW)).toEqual({ jobs: [], complete: true, note: null })
  })

  test.each([
    ['no position data', '<html>Careers</html>'],
    ['only the declaration', '<script>var COMPANY_POSITIONS_DATA ;</script>'],
    ['broken data', '<script>COMPANY_POSITIONS_DATA = [{"uid": ;</script>']
  ])('a page with %s is not recognised', async (_name, body) => {
    const { fetcher } = fakeFetcher({ [URL]: body })
    const e = await rejection(comeet.list(fetcher, BOARD, NOW))
    expect((e as Error).message).toBe(`Job list not recognised on ${URL}`)
  })

  test('robots.txt blocking the page is a block', async () => {
    const { fetcher } = fakeFetcher({ [URL]: null })
    expect(await rejection(comeet.list(fetcher, BOARD, NOW))).toBeInstanceOf(BlockedError)
  })
})
