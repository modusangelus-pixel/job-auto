// Live check of the careers lookup: real web requests and the real `claude` CLI on the owner's login, so it only
// runs when asked (JOB_AUTO_LIVE=1) and `npm test` skips it. It works in a temp folder, never in JOB-AUTO's own.
//
//   JOB_AUTO_LIVE=1 JOB_AUTO_TRACKER="C:\path\to\tracker.xlsx" npx vitest run tests/live
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { findClaude } from '../../src/main/careers/claude'
import { createLookup, makeRunBatch } from '../../src/main/careers/lookup'
import { listCompanies, statusCounts } from '../../src/main/db/companies'
import { openDb, type Db } from '../../src/main/db/db'
import { createLog } from '../../src/main/log'
import { createFetcher } from '../../src/main/readers/fetcher'
import { importTracker } from '../../src/main/tracker/importTracker'

const LIVE = process.env.JOB_AUTO_LIVE === '1'
const SETTLE = 5
const TWENTY_MINUTES = 20 * 60_000

let dir = ''
let db: Db | null = null
beforeAll(() => {
  if (LIVE) dir = mkdtempSync(join(tmpdir(), 'job-auto-live-'))
})
afterAll(() => {
  db?.close()
  if (dir !== '') rmSync(dir, { recursive: true, force: true })
})

test.skipIf(!LIVE)(
  `settles ${SETTLE} companies with real Claude and real sites, and logs each one`,
  async () => {
    const tracker = process.env.JOB_AUTO_TRACKER
    if (!tracker) throw new Error('Set JOB_AUTO_TRACKER to the path of the tracker .xlsx')

    const database = openDb(join(dir, 'job-auto.db'))
    db = database
    const imported = await importTracker(database, tracker)
    expect(imported.errors).toEqual([])
    const byList = (list: string): number =>
      listCompanies(database).filter((c) => c.list === list).length
    expect([byList('vehicle'), byList('machinery'), byList('both')]).toEqual([112, 82, 61])

    const logPath = join(dir, 'refresh.log')
    const lookup = createLookup({
      db: database,
      fetcher: createFetcher(),
      runBatch: makeRunBatch({
        findClaudePath: findClaude,
        cwd: join(dir, 'claude'),
        timeoutMs: 15 * 60_000,
        onStep: (s) => lookup.step(s)
      }),
      log: createLog(dir),
      // Settling in batches of 5, the first batch is enough; stop before a second one starts.
      onProgress: (p) => {
        if (p.done >= SETTLE) lookup.stop()
      }
    })
    await lookup.start()

    const settled = listCompanies(database).filter((c) => c.status !== 'pending')
    const summary = lookup.progress().lastSummary
    expect(settled.length, `lookup ended with: ${summary}`).toBeGreaterThanOrEqual(SETTLE)

    // What to check by hand: each settled company's status, job system, links and note.
    console.log(
      'SETTLED COMPANIES\n' +
        settled
          .map((c) =>
            [
              c.name,
              c.status,
              c.jobBoard ? `${c.jobBoard.system}/${c.jobBoard.board}` : '-',
              `careers: ${c.careersUrl ?? '-'}`,
              `jobs: ${c.jobsUrl ?? '-'}`,
              c.note ?? '-',
              c.error ?? '-'
            ].join(' | ')
          )
          .join('\n') +
        `\nstatus counts: ${JSON.stringify(statusCounts(database))}`
    )

    const log = readFileSync(logPath, 'utf8')
    for (const c of settled) expect(log).toContain(`${c.name}: ${c.status}`)
  },
  TWENTY_MINUTES
)
