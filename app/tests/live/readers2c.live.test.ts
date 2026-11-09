// Live check of the step 2c readers: one real board per reader, on the real sites, with the app's own fetcher
// (its User-Agent, robots.txt, 1.5 s between requests to a host). It only runs when asked (JOB_AUTO_LIVE=1), so
// `npm test` skips it. It writes nothing. Siemens (Avature, 6 jobs a page) takes about 2.5 minutes on its own.
//
//   JOB_AUTO_LIVE=1 npx vitest run tests/live/readers2c.live.test.ts
import { expect, test } from 'vitest'
import { READERS } from '../../src/main/jobs/readers'
import { createFetcher } from '../../src/main/readers/fetcher'
import type { JobSystem } from '../../src/shared/types'

const LIVE = process.env.JOB_AUTO_LIVE === '1'
const FIVE_MINUTES = 5 * 60_000

const BOARDS: [JobSystem, string][] = [
  ['icims', 'careers-rws.icims.com'],
  ['oracle', 'hdjq.fa.us2.oraclecloud.com/CX_1'],
  ['comeet', 'autobrains/57.004'],
  ['eightfold', 'vale.eightfold.ai|vale.com'],
  ['avature', 'jobs.siemens.com/en_US/externaljobs'],
  ['radancy', 'careers.synopsys.com'],
  ['workday', 'wd3.myworkdaysite.com/magna/Magna']
]

test.skipIf(!LIVE).each(BOARDS)(
  'the %s reader reads jobs from %s',
  async (system, board) => {
    const reader = READERS[system]
    if (!reader) throw new Error(`No reader for ${system}`)
    const { jobs } = await reader.list(createFetcher(), board, new Date())
    expect(jobs.length).toBeGreaterThanOrEqual(1)
    for (const job of jobs) {
      expect(job.title.trim()).not.toBe('')
      expect(job.url.startsWith('https://')).toBe(true)
    }
  },
  FIVE_MINUTES
)
