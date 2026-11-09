// Live check of the job readers: one real board per reader, on the real sites, with the app's own fetcher
// (its User-Agent, robots.txt, 1.5 s between requests to a host). It only runs when asked (JOB_AUTO_LIVE=1), so
// `npm test` skips it. It writes nothing.
//
//   JOB_AUTO_LIVE=1 npx vitest run tests/live/jobs.live.test.ts
import { expect, test } from 'vitest'
import { READERS } from '../../src/main/jobs/readers'
import { createFetcher } from '../../src/main/readers/fetcher'
import type { JobSystem } from '../../src/shared/types'

const LIVE = process.env.JOB_AUTO_LIVE === '1'
const FIVE_MINUTES = 5 * 60_000

// The fewest jobs each board must give. Fernride's EU board page (whose recaptcha setup was once taken for a
// challenge page) had no open jobs on 5 Nov 2026, so it only has to be read, not blocked or misread.
const BOARDS: [JobSystem, string, number][] = [
  ['greenhouse', 'scaleai', 1],
  ['greenhouse', 'eu:fernride', 0],
  ['lever', 'teleo', 1],
  ['ashby', 'applied', 1],
  ['workable', 'exotec', 1],
  ['personio', 'ipg-automotive-gmbh', 1],
  ['workday', 'normet.wd502/NormetCareers', 1],
  ['successfactors', 'jobs.volvogroup.com', 1]
]

test.skipIf(!LIVE).each(BOARDS)(
  'the %s reader reads jobs from %s',
  async (system, board, fewest) => {
    const reader = READERS[system]
    if (!reader) throw new Error(`No reader for ${system}`)
    const { jobs } = await reader.list(createFetcher(), board, new Date())
    expect(jobs.length).toBeGreaterThanOrEqual(fewest)
    for (const job of jobs) {
      expect(job.title.trim()).not.toBe('')
      expect(job.url.startsWith('https://')).toBe(true)
    }
  },
  FIVE_MINUTES
)
