import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openDb, type Db } from '../../src/main/db/db'
import { addCompanies, findCompany, getCompany, saveCheck } from '../../src/main/db/companies'
import { saveRead, storedJobs } from '../../src/main/db/jobs'
import { getSetting, saveReadPages } from '../../src/main/db/settings'
import {
  checkIsDue,
  createJobCheck,
  shouldCheckOnOpen,
  type PageReading
} from '../../src/main/jobs/check'
import type { Reader, ReadResult } from '../../src/main/jobs/readers/types'
import { BlockedError, type FetchResult, type Fetcher } from '../../src/main/readers/fetcher'
import type { Company, JobCheckProgress, JobSystem, RawJob } from '../../src/shared/types'

let dir = ''
let db: Db
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'job-check-'))
  db = openDb(join(dir, 'job-auto.db'))
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const NOW = new Date('2026-11-05T10:00:00.000Z')

/** Adds companies that are read directly: status direct, each with a board on the given system. */
function addDirect(system: JobSystem, ...names: string[]): Company[] {
  addCompanies(
    db,
    names.map((name) => ({ name, list: 'vehicle' as const }))
  )
  return names.map((name) => {
    const c = findCompany(db, name)!
    saveCheck(db, c.id, {
      careersUrl: null,
      jobsUrl: null,
      status: 'direct',
      jobBoard: { system, board: name.toLowerCase().replace(/\W+/g, '') },
      note: null,
      error: null
    })
    return getCompany(db, c.id)!
  })
}

function job(id: string, title = 'Project Manager', over: Partial<RawJob> = {}): RawJob {
  return {
    sourceId: id,
    title,
    location: 'Berlin',
    countries: ['DE'],
    employment: 'full_time',
    url: `https://x.test/${id}`,
    postedAt: null,
    postedRough: false,
    needsDetails: false,
    ...over
  }
}

const readerOf = (jobs: RawJob[], complete = true, note: string | null = null): Reader => ({
  list: async () => ({ jobs, complete, note })
})

const plainPage = (url: string): FetchResult => ({ status: 200, body: '', url })

interface Setup {
  check: ReturnType<typeof createJobCheck>
  logLines: string[]
  events: JobCheckProgress[]
  fetched: string[]
}

function setup(
  readers: Partial<Record<JobSystem, Reader>>,
  opts: { parallel?: number; now?: () => Date; pages?: PageReading } = {}
): Setup {
  const s = { logLines: [], events: [], fetched: [] } as unknown as Setup
  const fetcher: Fetcher = {
    async get(url) {
      s.fetched.push(url)
      return plainPage(url)
    },
    async post(url) {
      s.fetched.push(url)
      return plainPage(url)
    },
    async getBytes() {
      throw new Error('these tests never download files')
    },
    async permits() {
      return true
    }
  }
  s.check = createJobCheck({
    db,
    fetcher,
    readers,
    pages: opts.pages,
    log: (line) => s.logLines.push(line),
    onProgress: (p) => s.events.push(p),
    now: opts.now ?? ((): Date => NOW),
    parallel: opts.parallel
  })
  return s
}

const settleAll = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const openCount = (): number => storedJobs(db, NOW).filter((j) => j.closedAt === null).length

describe('createJobCheck', () => {
  test('reads every direct company and saves its jobs', async () => {
    addDirect('greenhouse', 'Alpha', 'Beta')
    addCompanies(db, [{ name: 'Gamma', list: 'vehicle' }]) // pending: not read
    const s = setup({ greenhouse: readerOf([job('1'), job('2')], true, 'trimmed') })
    await s.check.start()
    expect(openCount()).toBe(4)
    expect(s.logLines[0]).toBe('job check started: 2 companies')
    expect(s.logLines).toContain('read Alpha: 2 jobs (2 new, 0 closed) — trimmed')
    expect(s.logLines.at(-1)).toBe('job check finished')
    expect(getCompany(db, findCompany(db, 'Alpha')!.id)!.readAt).not.toBeNull()
    expect(getSetting(db, 'lastCheckAt')).toBe(NOW.toISOString())
    expect(s.check.progress()).toMatchObject({
      running: false,
      done: 2,
      total: 2,
      lastCheckAt: NOW.toISOString()
    })
  })

  test('a log line has no note suffix when there is no note', async () => {
    addDirect('greenhouse', 'Alpha')
    const s = setup({ greenhouse: readerOf([job('1')]) })
    await s.check.start()
    expect(s.logLines).toContain('read Alpha: 1 jobs (1 new, 0 closed)')
  })

  test('a blocked read marks the company blocked; another error only records it; both leave jobs open', async () => {
    const [blocked, broken] = addDirect('greenhouse', 'Blocked Co', 'Broken Co')
    const good = readerOf([job('1')])
    await setup({ greenhouse: good }).check.start()
    expect(openCount()).toBe(2)

    const failing: Reader = {
      list: async (_f, board) => {
        if (board === 'blockedco') throw new BlockedError('x.test', 'HTTP 403')
        throw new Error('bad JSON')
      }
    }
    const s = setup({ greenhouse: failing })
    await s.check.start()
    expect(getCompany(db, blocked.id)).toMatchObject({
      status: 'blocked',
      readError: 'x.test blocked: HTTP 403'
    })
    expect(getCompany(db, broken.id)).toMatchObject({ status: 'direct', readError: 'bad JSON' })
    expect(openCount()).toBe(2)
    expect(s.logLines).toContain('read Blocked Co failed: x.test blocked: HTTP 403')
    expect(s.logLines).toContain('read Broken Co failed: bad JSON')
    expect(s.check.progress().lastSummary).toBe(
      'Checked 2 companies: 2 open jobs, 2 fit your filters. 2 could not be read.'
    )
  })

  test('a check where every company failed is not recorded as the last check', async () => {
    addDirect('greenhouse', 'Alpha', 'Beta')
    await setup({ greenhouse: readerOf([job('1')]) }).check.start()
    expect(getSetting(db, 'lastCheckAt')).toBe(NOW.toISOString())

    const later = new Date('2026-11-06T10:00:00.000Z')
    const offline: Reader = {
      list: async () => {
        throw new Error('fetch failed')
      }
    }
    const s = setup({ greenhouse: offline }, { now: () => later })
    await s.check.start()
    // Still the earlier check, so the check on opening tries again.
    expect(getSetting(db, 'lastCheckAt')).toBe(NOW.toISOString())
    expect(s.check.progress()).toMatchObject({
      running: false,
      lastCheckAt: NOW.toISOString(),
      lastSummary: 'Checked 2 companies: 2 open jobs, 2 fit your filters. 2 could not be read.'
    })

    // One company read is enough for the check to count.
    let calls = 0
    const half: Reader = {
      list: async () => {
        if (calls++ === 0) throw new Error('fetch failed')
        return { jobs: [job('1')], complete: true, note: null }
      }
    }
    await setup({ greenhouse: half }, { now: () => later, parallel: 1 }).check.start()
    expect(getSetting(db, 'lastCheckAt')).toBe(later.toISOString())
  })

  test('a company whose system has no reader records that, and the run goes on', async () => {
    const [noReader] = addDirect('recruitee', 'Nope')
    addDirect('greenhouse', 'Fine')
    const s = setup({ greenhouse: readerOf([job('1')]) })
    await s.check.start()
    expect(getCompany(db, noReader.id)!.readError).toBe('No job reader for recruitee yet')
    expect(getCompany(db, noReader.id)!.status).toBe('direct')
    expect(openCount()).toBe(1)
    expect(s.check.progress().done).toBe(2)
    expect(s.check.progress().lastSummary).toMatch(/ 1 could not be read\.$/)
  })

  test('details are read only for rows whose titles fit and whose region is on or unknown, and only once', async () => {
    addDirect('workday', 'Wd')
    const asked: string[] = []
    const rows = [
      job('fit-de', 'Project Manager', { needsDetails: true, countries: ['DE'] }),
      job('fit-none', 'Project Coordinator', { needsDetails: true, countries: [] }),
      job('fit-jp', 'Project Manager', { needsDetails: true, countries: ['JP'] }),
      job('nofit', 'Software Engineer', { needsDetails: true, countries: ['DE'] }),
      job('done', 'Project Manager', { needsDetails: false })
    ]
    const reader: Reader = {
      list: async () => ({ jobs: rows.map((r) => ({ ...r })), complete: true, note: null }),
      details: async (_f, _b, j) => {
        asked.push(j.sourceId)
        return { ...j, countries: ['DE'], employment: 'full_time', needsDetails: false }
      }
    }
    await setup({ workday: reader }).check.start()
    expect(asked.sort()).toEqual(['fit-de', 'fit-none'])
    const stored = Object.fromEntries(storedJobs(db, NOW).map((j) => [j.url.split('/').pop(), j]))
    expect(stored['fit-de'].countries).toEqual(['DE'])
    expect(stored['fit-jp'].countries).toEqual(['JP'])

    asked.length = 0
    await setup({ workday: reader }).check.start()
    expect(asked).toEqual([])
  })

  test('up to 4 companies are read at once', async () => {
    addDirect('greenhouse', 'A', 'B', 'C', 'D', 'E', 'F')
    let active = 0
    let peak = 0
    const releases: (() => void)[] = []
    const reader: Reader = {
      list: async () => {
        active++
        peak = Math.max(peak, active)
        await new Promise<void>((resolve) => releases.push(resolve))
        active--
        return { jobs: [], complete: true, note: null }
      }
    }
    const s = setup({ greenhouse: reader })
    const done = s.check.start()
    await settleAll()
    expect(releases).toHaveLength(4)
    expect(s.check.progress().current).toHaveLength(4)
    while (releases.length > 0 || active > 0) {
      releases.shift()?.()
      await settleAll()
    }
    await done
    expect(peak).toBe(4)
    expect(s.check.progress().done).toBe(6)
  })

  test('stop mid-company saves nothing for it, keeps finished companies, and does not set lastCheckAt', async () => {
    addDirect('greenhouse', 'First')
    addDirect('lever', 'Second')
    let stopNow = (): void => {}
    const second: Reader = {
      list: async (fetcher) => {
        await fetcher.get('https://x.test/page1')
        stopNow()
        await fetcher.get('https://x.test/page2')
        return { jobs: [job('late')], complete: true, note: null }
      }
    }
    const s = setup({ greenhouse: readerOf([job('1')]), lever: second }, { parallel: 1 })
    stopNow = () => s.check.stop()
    await s.check.start()
    expect(s.fetched).toEqual(['https://x.test/page1'])
    expect(openCount()).toBe(1)
    expect(getCompany(db, findCompany(db, 'Second')!.id)!.readError).toBeNull()
    expect(getCompany(db, findCompany(db, 'Second')!.id)!.readAt).toBeNull()
    expect(getSetting(db, 'lastCheckAt')).toBeNull()
    expect(s.logLines.at(-1)).toBe('job check stopped')
    expect(s.logLines.some((l) => l.includes('failed'))).toBe(false)
    expect(s.check.progress()).toMatchObject({
      running: false,
      done: 1,
      lastSummary: 'Stopped.',
      current: []
    })
  })

  test('stop between detail reads saves nothing and records no failure', async () => {
    addDirect('workday', 'Wd')
    let stopNow = (): void => {}
    let calls = 0
    const reader: Reader = {
      list: async () => ({
        jobs: [
          job('1', 'Project Manager', { needsDetails: true }),
          job('2', 'Project Manager', { needsDetails: true })
        ],
        complete: true,
        note: null
      }),
      details: async (_f, _b, j) => {
        calls++
        stopNow()
        return { ...j, needsDetails: false }
      }
    }
    const s = setup({ workday: reader })
    stopNow = () => s.check.stop()
    await s.check.start()
    expect(calls).toBe(1)
    expect(openCount()).toBe(0)
    expect(getCompany(db, findCompany(db, 'Wd')!.id)!.readError).toBeNull()
  })

  test('summary counts open and fitting jobs, and failures', async () => {
    addDirect('greenhouse', 'Alpha')
    addDirect('lever', 'Beta')
    const s = setup({
      greenhouse: readerOf([
        job('1', 'Project Manager'),
        job('2', 'Software Engineer'),
        job('3', 'Quality Coordinator', { countries: ['JP'] })
      ]),
      lever: {
        list: async (): Promise<ReadResult> => {
          throw new Error('boom')
        }
      }
    })
    await s.check.start()
    expect(s.check.progress().lastSummary).toBe(
      'Checked 2 companies: 3 open jobs, 1 fit your filters. 1 could not be read.'
    )
    const clean = setup({ greenhouse: readerOf([job('1')]), lever: readerOf([]) })
    await clean.check.start()
    expect(clean.check.progress().lastSummary).toBe(
      'Checked 2 companies: 1 open jobs, 1 fit your filters.'
    )
  })

  test('rows with a repeated sourceId are stored once with both countries; empty sourceIds are dropped', async () => {
    addDirect('workable', 'Wk')
    const s = setup({
      workable: readerOf([
        job('same', 'Project Manager', { countries: ['DE'], url: 'https://x.test/first' }),
        job('same', 'Other title', { countries: ['NL'], url: 'https://x.test/second' }),
        job('same', 'Again', { countries: ['DE', 'FR'] }),
        job('', 'No id')
      ])
    })
    await s.check.start()
    const stored = storedJobs(db, NOW)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      title: 'Project Manager',
      url: 'https://x.test/first',
      countries: ['DE', 'NL', 'FR']
    })
    expect(s.logLines).toContain(
      'read Wk: 1 jobs (1 new, 0 closed) — 1 jobs had no id, so no job was closed'
    )
  })

  test('a read with some empty sourceIds closes nothing', async () => {
    const [wk] = addDirect('workable', 'Wk')
    await setup({ workable: readerOf([job('a'), job('b')]) }).check.start()
    expect(openCount()).toBe(2)
    // 'b' is gone from the list, but a row without an id might be it: nothing may be closed.
    await setup({ workable: readerOf([job('a'), job('', 'No id')]) }).check.start()
    expect(openCount()).toBe(2)
    expect(getCompany(db, wk.id)!.readError).toBeNull()
  })

  test('a read where every row has an empty sourceId saves nothing and is a failure', async () => {
    const [wk] = addDirect('workable', 'Wk')
    await setup({ workable: readerOf([job('a'), job('b')]) }).check.start()
    const s = setup({ workable: readerOf([job(''), job('')]) })
    await s.check.start()
    expect(openCount()).toBe(2)
    expect(getCompany(db, wk.id)).toMatchObject({
      status: 'direct',
      readError: 'Job list not recognised: no job has an id'
    })
    expect(s.logLines).toContain('read Wk failed: Job list not recognised: no job has an id')
  })

  test('a non-block detail error keeps the row and the company is saved; a block fails the company', async () => {
    const [wd] = addDirect('workday', 'Wd')
    let mode: 'plain' | 'block' = 'plain'
    const reader: Reader = {
      list: async () => ({
        jobs: [
          job('1', 'Project Manager', { needsDetails: true, countries: [] }),
          job('2', 'Project Coordinator', { needsDetails: true, countries: [] })
        ],
        complete: true,
        note: null
      }),
      details: async (_f, _b, j) => {
        if (mode === 'block') throw new BlockedError('wd.test', 'HTTP 429')
        if (j.sourceId === '1') throw new Error('page changed')
        return { ...j, countries: ['SE'], needsDetails: false }
      }
    }
    const s = setup({ workday: reader })
    await s.check.start()
    const stored = storedJobs(db, NOW)
    expect(stored).toHaveLength(2)
    expect(stored.find((j) => j.url.endsWith('/1'))!.countries).toEqual([])
    expect(stored.find((j) => j.url.endsWith('/2'))!.countries).toEqual(['SE'])
    expect(getCompany(db, wd.id)!.readError).toBeNull()
    // Row 1 still needs its details, so the next read asks again; this time the site blocks.
    mode = 'block'
    await setup({ workday: reader }).check.start()
    expect(getCompany(db, wd.id)).toMatchObject({ status: 'blocked' })
  })

  test('a refusal that arrives after Stop still marks the company blocked', async () => {
    const [c] = addDirect('greenhouse', 'Late Block')
    let stopNow = (): void => {}
    const reader: Reader = {
      list: async () => {
        stopNow()
        throw new BlockedError('x.test', 'HTTP 403')
      }
    }
    const s = setup({ greenhouse: reader })
    stopNow = () => s.check.stop()
    await s.check.start()
    expect(getCompany(db, c.id)).toMatchObject({ status: 'blocked' })
    expect(s.check.progress().lastSummary).toBe('Stopped.')
    expect(getSetting(db, 'lastCheckAt')).toBeNull()
  })

  test('stop with several companies in flight: finished ones keep their reads, in-flight ones save nothing, none is read twice', async () => {
    addDirect('greenhouse', 'A', 'B', 'C', 'D', 'E', 'F')
    const listed: string[] = []
    const gates = new Map<string, () => void>()
    const reader: Reader = {
      list: async (_f, board) => {
        listed.push(board)
        await new Promise<void>((resolve) => gates.set(board, resolve))
        return { jobs: [job(board)], complete: true, note: null }
      }
    }
    const s = setup({ greenhouse: reader }, { parallel: 3 })
    const done = s.check.start()
    await settleAll()
    expect(listed.sort()).toEqual(['a', 'b', 'c'])
    gates.get('a')!()
    await settleAll()
    expect(listed.sort()).toEqual(['a', 'b', 'c', 'd'])
    s.check.stop()
    for (const g of gates.values()) g()
    await done
    expect(listed.sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(storedJobs(db, NOW).map((j) => j.url)).toEqual(['https://x.test/a'])
    expect(getCompany(db, findCompany(db, 'B')!.id)!.readAt).toBeNull()
    expect(s.check.progress()).toMatchObject({ done: 1, lastSummary: 'Stopped.', current: [] })
    expect(getSetting(db, 'lastCheckAt')).toBeNull()
  })

  test('a database error ends the run: no further company starts, no progress after it, start() resolves', async () => {
    addDirect('greenhouse', 'A', 'B', 'C')
    const listed: string[] = []
    const reader: Reader = {
      list: async (_f, board) => {
        listed.push(board)
        // With the database gone, neither the save nor the failure note can be stored.
        db.close()
        return { jobs: [job('1')], complete: true, note: null }
      }
    }
    const s = setup({ greenhouse: reader }, { parallel: 1 })
    await expect(s.check.start()).resolves.toBeUndefined()
    expect(listed).toEqual(['a'])
    const last = s.events.at(-1)!
    expect(last.running).toBe(false)
    expect(last.lastSummary).toMatch(/^Job check stopped: .+/)
    expect(s.logLines.at(-1)).toMatch(/^job check failed: /)
    const count = s.events.length
    await settleAll()
    expect(s.events).toHaveLength(count)
  })

  test('a progress callback that throws does not make start() reject', async () => {
    addDirect('greenhouse', 'A', 'B')
    const check = createJobCheck({
      db,
      fetcher: {
        get: async (u) => plainPage(u),
        post: async (u) => plainPage(u),
        getBytes: async () => {
          throw new Error('these tests never download files')
        }
      },
      readers: { greenhouse: readerOf([job('1')]) },
      log: () => {},
      onProgress: () => {
        throw new Error('screen is gone')
      },
      now: () => NOW
    })
    await expect(check.start()).resolves.toBeUndefined()
    expect(check.progress()).toMatchObject({ running: false })
    expect(check.progress().lastSummary).toBe('Job check stopped: screen is gone')
  })

  test('a start while running joins the run', async () => {
    addDirect('greenhouse', 'Alpha')
    let release = (): void => {}
    let lists = 0
    const reader: Reader = {
      list: async () => {
        lists++
        await new Promise<void>((resolve) => (release = resolve))
        return { jobs: [], complete: true, note: null }
      }
    }
    const s = setup({ greenhouse: reader })
    const first = s.check.start()
    await settleAll()
    expect(s.check.start()).toBe(first)
    release()
    await first
    expect(lists).toBe(1)
  })

  /** Gives companies one shared board, as when step 1 found a group's careers site for each brand. */
  function shareBoard(board: string, ...companies: Company[]): void {
    for (const c of companies)
      saveCheck(db, c.id, {
        careersUrl: null,
        jobsUrl: null,
        status: 'direct',
        jobBoard: { system: 'greenhouse', board },
        note: null,
        error: null
      })
  }

  test('companies sharing a board are read once, and each gets its jobs', async () => {
    const [volvo, renault] = addDirect('greenhouse', 'Volvo CE', 'Renault Trucks', 'Other')
    shareBoard('volvogroup', volvo, renault)
    const boards: string[] = []
    const reader: Reader = {
      list: async (_f, board) => {
        boards.push(board)
        return { jobs: [job('1'), job('2')], complete: true, note: null }
      }
    }
    const s = setup({ greenhouse: reader })
    await s.check.start()
    expect(boards.sort()).toEqual(['other', 'volvogroup'])
    expect(openCount()).toBe(6)
    expect(s.logLines).toContain('read Volvo CE: 2 jobs (2 new, 0 closed)')
    expect(s.logLines).toContain('read Renault Trucks: 2 jobs (2 new, 0 closed)')
    expect(getCompany(db, renault.id)!.readAt).not.toBeNull()
    expect(s.check.progress()).toMatchObject({ done: 3, total: 3 })
  })

  test('a failed shared read is recorded for each company on that board', async () => {
    const [volvo, renault] = addDirect('greenhouse', 'Volvo CE', 'Renault Trucks')
    shareBoard('volvogroup', volvo, renault)
    const reader: Reader = {
      list: async () => {
        throw new Error('HTTP 500 from https://x.test')
      }
    }
    const s = setup({ greenhouse: reader })
    await s.check.start()
    expect(getCompany(db, volvo.id)!.readError).toBe('HTTP 500 from https://x.test')
    expect(getCompany(db, renault.id)!.readError).toBe('HTTP 500 from https://x.test')
    expect(s.check.progress().lastSummary).toContain('2 could not be read.')
  })
})

describe('shouldCheckOnOpen', () => {
  const at = (y: number, mo: number, d: number, h: number, mi = 0): Date =>
    new Date(y, mo - 1, d, h, mi)
  test('null → true, earlier today → false, yesterday 23:59 → true', () => {
    const now = at(2026, 11, 5, 9)
    expect(shouldCheckOnOpen(null, now)).toBe(true)
    expect(shouldCheckOnOpen(at(2026, 11, 5, 0, 1).toISOString(), now)).toBe(false)
    expect(shouldCheckOnOpen(at(2026, 11, 4, 23, 59).toISOString(), now)).toBe(true)
  })
})

describe('checkIsDue', () => {
  const now = new Date(2026, 10, 5, 9)
  const yesterday = new Date(2026, 10, 4, 12).toISOString()
  const today = new Date(2026, 10, 5, 1).toISOString()
  test('due only when no check ran today and a company is read directly', () => {
    expect(checkIsDue(yesterday, [{ status: 'direct' }], now)).toBe(true)
    expect(checkIsDue(null, [{ status: 'pending' }, { status: 'direct' }], now)).toBe(true)
    expect(checkIsDue(today, [{ status: 'direct' }], now)).toBe(false)
    expect(checkIsDue(yesterday, [{ status: 'blocked' }, { status: 'not_found' }], now)).toBe(false)
    expect(checkIsDue(null, [], now)).toBe(false)
  })
})

describe('reading script-built careers pages with Claude', () => {
  const DAY = 24 * 60 * 60 * 1000

  /** Adds companies that need Claude reading, each with its own careers link. */
  function addNeedsClaude(...names: string[]): Company[] {
    addCompanies(
      db,
      names.map((name) => ({ name, list: 'vehicle' as const }))
    )
    return names.map((name) => {
      const c = findCompany(db, name)!
      saveCheck(db, c.id, {
        careersUrl: `https://${name.toLowerCase()}.test/careers`,
        jobsUrl: null,
        status: 'needs_claude',
        jobBoard: null,
        note: null,
        error: null
      })
      return getCompany(db, c.id)!
    })
  }

  interface Fake {
    pages: PageReading
    captured: string[]
    asked: string[]
  }

  /**
   * Page reading where every page shows its address (or the `landsOn` address) with the `links` given for it, and
   * Claude answers by company from `answers`.
   */
  function fakePages(
    answers: Record<string, { ok: boolean; text: string }>,
    opts: {
      claudePath?: string | null
      forbidden?: string[]
      onAsk?: () => void
      links?: Record<string, string[]>
      landsOn?: Record<string, string>
    } = {}
  ): Fake {
    const f: Fake = { captured: [], asked: [], pages: undefined as unknown as PageReading }
    f.pages = {
      capture: {
        async capture(url) {
          f.captured.push(url)
          if (opts.forbidden?.includes(url)) return null
          return {
            finalUrl: opts.landsOn?.[url] ?? `${url}?session=1`,
            text: 'Open roles',
            links: (opts.links?.[url] ?? []).map((href) => ({ href, text: 'Apply' }))
          }
        }
      },
      claudePath: () => (opts.claudePath === undefined ? 'C:/claude.exe' : opts.claudePath),
      async ask(_path, prompt) {
        const name = /^Company: (.+)$/m.exec(prompt)![1]
        f.asked.push(name)
        opts.onAsk?.()
        return answers[name] ?? { ok: true, text: '[]' }
      }
    }
    return f
  }

  const ENGINEER = {
    ok: true,
    text: '[{"title": "Engineer", "location": "Oslo, Norway", "url": "/jobs/1"}]'
  }

  test('a needs-Claude company is read once from its page, after the direct ones, and never closes jobs', async () => {
    addDirect('greenhouse', 'Alpha')
    const [pagey] = addNeedsClaude('Pagey')
    const f = fakePages({ Pagey: ENGINEER })
    const s = setup({ greenhouse: readerOf([job('1')]) }, { pages: f.pages })
    await s.check.start()
    expect(f.captured).toEqual(['https://pagey.test/careers'])
    expect(f.asked).toEqual(['Pagey'])
    const after = getCompany(db, pagey.id)!
    expect(after.readAt).toBe(NOW.toISOString())
    expect(after.status).toBe('needs_claude')
    const board = db.prepare('SELECT read_board FROM companies WHERE id = ?').pluck().get(pagey.id)
    expect(board).toBe('page:pagey.test/careers')
    expect(s.logLines).toContain('read Pagey (page): 1 jobs (1 new)')
    expect(s.events.some((e) => e.current.includes('Pagey (page)'))).toBe(true)
    expect(s.check.progress()).toMatchObject({ done: 2, total: 2 })

    // Eight days on the page lists nothing: the job stays open, since a page read is never complete.
    const later = new Date(NOW.getTime() + 8 * DAY)
    const f2 = fakePages({ Pagey: { ok: true, text: '[]' } })
    await setup(
      { greenhouse: readerOf([job('1')]) },
      { pages: f2.pages, now: () => later }
    ).check.start()
    expect(f2.asked).toEqual(['Pagey'])
    expect(
      storedJobs(db, later).filter((j) => j.title === 'Engineer' && j.closedAt === null)
    ).toHaveLength(1)
  })

  test('a company read two days ago is not read again', async () => {
    const [pagey] = addNeedsClaude('Pagey')
    saveRead(db, pagey.id, 'page:pagey.test/careers', [], false, new Date(NOW.getTime() - 2 * DAY))
    const f = fakePages({})
    await setup({}, { pages: f.pages }).check.start()
    expect(f.captured).toEqual([])
    expect(f.asked).toEqual([])
  })

  test('the switch off skips all page reading', async () => {
    addNeedsClaude('Pagey')
    saveReadPages(db, false)
    const f = fakePages({})
    const s = setup({}, { pages: f.pages })
    await s.check.start()
    expect(f.captured).toEqual([])
    expect(s.check.progress().total).toBe(0)
  })

  test('a Claude failure is recorded, the next company is read, and the failed one waits a week', async () => {
    const [first, second] = addNeedsClaude('First', 'Second')
    const f = fakePages({
      First: { ok: false, text: 'Claude usage limit reached' },
      Second: ENGINEER
    })
    const s = setup({}, { pages: f.pages })
    await s.check.start()
    expect(f.asked).toEqual(['First', 'Second'])
    const failed = getCompany(db, first.id)!
    expect(failed.status).toBe('needs_claude')
    expect(failed.readError).toBe('Claude: Claude usage limit reached')
    expect(failed.readAt).toBeNull()
    expect(getCompany(db, second.id)!.readAt).toBe(NOW.toISOString())
    expect(s.check.progress().lastSummary).toContain('1 could not be read')

    // The next day neither is asked about again: at most one Claude run per company a week.
    const f2 = fakePages({})
    await setup({}, { pages: f2.pages, now: () => new Date(NOW.getTime() + DAY) }).check.start()
    expect(f2.asked).toEqual([])
    const f3 = fakePages({})
    await setup({}, { pages: f3.pages, now: () => new Date(NOW.getTime() + 8 * DAY) }).check.start()
    expect(f3.asked).toEqual(['First', 'Second'])
  })

  test('an answer with no job list saves nothing and is recorded', async () => {
    const [pagey] = addNeedsClaude('Pagey')
    const f = fakePages({ Pagey: { ok: true, text: 'I could not find any jobs.' } })
    await setup({}, { pages: f.pages }).check.start()
    expect(getCompany(db, pagey.id)!.readError).toBe('Claude gave no job list')
    expect(getCompany(db, pagey.id)!.readAt).toBeNull()
  })

  test('robots.txt forbidding the page marks the company blocked, and Claude is not asked', async () => {
    const [pagey] = addNeedsClaude('Pagey')
    const f = fakePages({}, { forbidden: ['https://pagey.test/careers'] })
    await setup({}, { pages: f.pages }).check.start()
    expect(f.asked).toEqual([])
    expect(getCompany(db, pagey.id)!.status).toBe('blocked')
  })

  test('a page that fails to load is recorded and the next company is read', async () => {
    const [broken] = addNeedsClaude('Broken', 'Fine')
    const f = fakePages({ Fine: ENGINEER })
    const capture = f.pages.capture.capture
    f.pages.capture.capture = async (url) => {
      if (url.includes('broken')) throw new Error('the page did not load within 45 s')
      return capture(url)
    }
    await setup({}, { pages: f.pages }).check.start()
    expect(getCompany(db, broken.id)!.readError).toBe('the page did not load within 45 s')
    expect(f.asked).toEqual(['Fine'])
  })

  test('without Claude Code on the computer page reading is skipped with one log line', async () => {
    addNeedsClaude('Pagey', 'Other')
    const f = fakePages({}, { claudePath: null })
    const s = setup({}, { pages: f.pages })
    await s.check.start()
    expect(f.captured).toEqual([])
    expect(s.logLines.filter((l) => l.startsWith('page reading skipped'))).toEqual([
      'page reading skipped: Claude Code was not found on this computer'
    ])
    expect(s.check.progress().total).toBe(0)
  })

  test('a job board link is never opened', async () => {
    const [linked] = addNeedsClaude('Linked')
    saveCheck(db, linked.id, {
      careersUrl: 'https://www.linkedin.com/company/linked/jobs',
      jobsUrl: null,
      status: 'needs_claude',
      jobBoard: null,
      note: null,
      error: null
    })
    const f = fakePages({})
    await setup({}, { pages: f.pages }).check.start()
    expect(f.captured).toEqual([])
  })

  test('a loaded page that links to a job board the app reads makes the company direct, read now without Claude', async () => {
    const [pagey] = addNeedsClaude('Pagey')
    const f = fakePages(
      {},
      {
        links: {
          'https://pagey.test/careers': [
            'https://pagey.test/about',
            'https://jobs.ashbyhq.com/pagey-robotics/a61ecded-689e-4feb'
          ]
        }
      }
    )
    const s = setup({ ashby: readerOf([job('1'), job('2')]) }, { pages: f.pages })
    await s.check.start()
    expect(f.asked).toEqual([])
    const after = getCompany(db, pagey.id)!
    expect(after.status).toBe('direct')
    expect(after.jobBoard).toEqual({ system: 'ashby', board: 'pagey-robotics' })
    expect(after.careersUrl).toBe('https://pagey.test/careers')
    expect(after.readAt).toBe(NOW.toISOString())
    expect(openCount()).toBe(2)
    expect(s.logLines).toContain(
      'Pagey: its careers page links to ashby pagey-robotics, so it is read directly from now on'
    )
    expect(s.check.progress()).toMatchObject({ done: 1, total: 1 })
  })

  test('a page that lands on a job board the app reads counts too', async () => {
    const [pagey] = addNeedsClaude('Pagey')
    const f = fakePages(
      {},
      { landsOn: { 'https://pagey.test/careers': 'https://jobs.lever.co/pagey' } }
    )
    await setup({ lever: readerOf([job('1')]) }, { pages: f.pages }).check.start()
    expect(f.asked).toEqual([])
    expect(getCompany(db, pagey.id)!.jobBoard).toEqual({ system: 'lever', board: 'pagey' })
  })

  test('a SmartRecruiters link, or a system without a reader, leaves the page to Claude', async () => {
    const [sr, rec] = addNeedsClaude('Sr', 'Rec')
    const f = fakePages(
      { Sr: ENGINEER, Rec: ENGINEER },
      {
        links: {
          'https://sr.test/careers': ['https://jobs.smartrecruiters.com/SrGroup'],
          'https://rec.test/careers': ['https://rec.recruitee.com/o/engineer']
        }
      }
    )
    await setup({}, { pages: f.pages }).check.start()
    expect([...f.asked].sort()).toEqual(['Rec', 'Sr'])
    expect(getCompany(db, sr.id)!.status).toBe('needs_claude')
    expect(getCompany(db, rec.id)!.status).toBe('needs_claude')
  })

  test('at most 20 pages a check, those waiting longest first, so the weekly reads spread over the days', async () => {
    const names = Array.from({ length: 22 }, (_, i) => `Co${String(i).padStart(2, '0')}`)
    const companies = addNeedsClaude(...names)
    // Co00 was read nine days ago: it waits longest after the never-read ones, which come first.
    saveRead(
      db,
      companies[0].id,
      'page:co00.test/careers',
      [],
      false,
      new Date(NOW.getTime() - 9 * DAY)
    )
    const f = fakePages({})
    const s = setup({}, { pages: f.pages })
    await s.check.start()
    expect(f.asked).toHaveLength(20)
    expect(f.asked).not.toContain('Co00')
    expect(s.logLines[0]).toBe('job check started: 0 companies, 20 pages to read with Claude')
    const f2 = fakePages({})
    await setup({}, { pages: f2.pages, now: () => new Date(NOW.getTime() + DAY) }).check.start()
    expect(f2.asked).toEqual(['Co21', 'Co00'])
  })

  test('Stop works between companies', async () => {
    addNeedsClaude('First', 'Second')
    let s: Setup | null = null
    const f = fakePages({ First: ENGINEER }, { onAsk: () => s!.check.stop() })
    s = setup({}, { pages: f.pages })
    await s.check.start()
    expect(f.asked).toEqual(['First'])
    expect(s.check.progress().lastSummary).toBe('Stopped.')
  })
})
