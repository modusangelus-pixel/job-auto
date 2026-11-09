import { describe, expect, test } from 'vitest'
import { personio } from '../../../src/main/jobs/readers/personio'
import { BlockedError, fakeFetcher, fixture, rejection } from './helpers'

const NOW = new Date('2026-11-04T12:00:00Z')
const FEED = 'https://ipg-automotive-gmbh.jobs.personio.de/xml'
const BOARD = 'ipg-automotive-gmbh'

function position(fields: string): string {
  return `<position><id>1</id>${fields}<name>N</name><createdAt>2026-01-02T03:04:05+00:00</createdAt></position>`
}

describe('personio reader', () => {
  test('reads the feed', async () => {
    const { fetcher, urls } = fakeFetcher({ [FEED]: fixture('personio.xml') })
    const r = await personio.list(fetcher, BOARD, NOW)
    expect(urls).toEqual([FEED])
    expect(r.complete).toBe(true)
    expect(r.jobs).toHaveLength(5)
    expect(r.jobs[0]).toEqual({
      sourceId: '2784189',
      title: '(Senior) Compliance & Legal Manager (m/w/d)',
      location: 'Karlsruhe Fautenbruchstraße',
      countries: [],
      employment: 'full_time',
      url: 'https://ipg-automotive-gmbh.jobs.personio.de/job/2784189',
      postedAt: '2026-09-07T10:44:16.000Z',
      postedRough: false,
      needsDetails: false
    })
    expect(r.jobs[3].employment).toBe('intern')
  })

  test('employment mapping', async () => {
    const cases: [string, string][] = [
      ['<employmentType>working_student</employmentType>', 'intern'],
      ['<employmentType>permanent</employmentType><schedule>part-time</schedule>', 'part_time'],
      ['<employmentType>temporary</employmentType><schedule>full-time</schedule>', 'fixed_term'],
      ['<employmentType>freelance</employmentType>', 'fixed_term'],
      ['<employmentType>trainee</employmentType>', 'full_time'],
      ['<schedule>full-time</schedule>', 'unknown']
    ]
    const xml = `<workzag-jobs>${cases.map(([f]) => position(f)).join('')}</workzag-jobs>`
    const { fetcher } = fakeFetcher({ [FEED]: xml })
    const r = await personio.list(fetcher, BOARD, NOW)
    expect(r.jobs.map((j) => j.employment)).toEqual(cases.map(([, e]) => e))
  })

  test('decodes CDATA and entities, ignores names inside descriptions, finds countries', async () => {
    const xml = `<workzag-jobs><position><id>7</id><office>Berlin, Germany</office>
      <name><![CDATA[Lead <b>& more]]></name>
      <jobDescriptions><jobDescription><name>Tasks</name><value><![CDATA[<p>x</p>]]></value></jobDescription></jobDescriptions>
      <employmentType>permanent</employmentType></position>
      <position><id>8</id><name>Caf&#233; &#x41; &lt;Boss&gt; &quot;Q&quot; &apos;s&apos; &unknown;</name></position></workzag-jobs>`
    const { fetcher } = fakeFetcher({ [FEED]: xml })
    const r = await personio.list(fetcher, BOARD, NOW)
    expect(r.jobs[0].title).toBe('Lead <b>& more')
    expect(r.jobs[0].countries).toEqual(['DE'])
    expect(r.jobs[1].title).toBe('Café A <Boss> "Q" \'s\' &unknown;')
    expect(r.jobs[1].postedAt).toBeNull()
    expect(r.jobs[1].location).toBe('')
  })

  test('an empty feed with its root is an empty complete list', async () => {
    for (const xml of ['<?xml version="1.0"?><workzag-jobs></workzag-jobs>', '<workzag-jobs/>']) {
      const { fetcher } = fakeFetcher({ [FEED]: xml })
      expect(await personio.list(fetcher, BOARD, NOW)).toEqual({
        jobs: [],
        complete: true,
        note: null
      })
    }
  })

  test('a page that is not a Personio feed is not recognised', async () => {
    const { fetcher } = fakeFetcher({ [FEED]: '<html><body>Not found</body></html>' })
    await expect(personio.list(fetcher, BOARD, NOW)).rejects.toThrow(
      `Job list not recognised on ${FEED}`
    )
  })

  test('a 404 board throws HTTP 404', async () => {
    const { fetcher } = fakeFetcher({ [FEED]: 404 })
    await expect(personio.list(fetcher, BOARD, NOW)).rejects.toThrow(`HTTP 404 from ${FEED}`)
  })

  test('robots null throws BlockedError', async () => {
    const { fetcher } = fakeFetcher({ [FEED]: null })
    expect(await rejection(personio.list(fetcher, BOARD, NOW))).toBeInstanceOf(BlockedError)
  })
})
