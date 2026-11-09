import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  addCompany,
  checkLink,
  createLookup,
  linkProblem,
  makeRunBatch,
  normalizeLink,
  type BatchOutcome
} from '../../src/main/careers/lookup'
import type { LookupAnswer } from '../../src/main/careers/claude'
import { openDb, type Db } from '../../src/main/db/db'
import {
  addCompanies,
  findCompany,
  getCompany,
  noteFailedLookup,
  saveCheck,
  statusCounts
} from '../../src/main/db/companies'
import { BlockedError, type FetchResult, type Fetcher } from '../../src/main/readers/fetcher'
import type { Company, LookupProgress } from '../../src/shared/types'

type RunBatch = (companies: Company[], signal: AbortSignal) => Promise<BatchOutcome>

let dir = ''
let db: Db
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'job-lookup-'))
  db = openDb(join(dir, 'job-auto.db'))
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Adds companies and returns them in the order given. */
function add(...rows: { name: string; careersUrl?: string }[]): Company[] {
  addCompanies(
    db,
    rows.map((r) => ({ ...r, list: 'vehicle' as const }))
  )
  return rows.map((r) => findCompany(db, r.name)!)
}

/** `Co 1` ... `Co n`, none with a link. */
function addNumbered(n: number): Company[] {
  return add(...Array.from({ length: n }, (_, i) => ({ name: `Co ${i + 1}` })))
}

const slug = (c: Company): string => c.name.toLowerCase().replace(/\W+/g, '')

/** What Claude would answer for a company: a jobs link on Greenhouse, so the check needs no fetch. */
function answerFor(c: Company): LookupAnswer {
  return {
    id: c.id,
    careersUrl: null,
    jobsUrl: `https://boards.greenhouse.io/${slug(c)}`,
    note: ''
  }
}

const okOutcome = (companies: Company[]): BatchOutcome => ({
  ok: true,
  answers: companies.map(answerFor),
  summary: ''
})

const plainPage = (url: string): FetchResult => ({ status: 200, body: '<html></html>', url })

function attemptsOf(id: number): number {
  return db.prepare('SELECT lookup_attempts FROM companies WHERE id = ?').pluck().get(id) as number
}

interface Setup {
  lookup: ReturnType<typeof createLookup>
  batches: Company[][]
  logLines: string[]
  events: LookupProgress[]
  /** Everything that happened, in order: `fetch <url>` and `batch <names>` */
  order: string[]
}

function setup(
  opts: {
    runBatch?: (s: Setup) => RunBatch
    fetch?: (url: string) => FetchResult | null | Error
    batchSize?: number
    maxAttempts?: number
    parallel?: number
  } = {}
): Setup {
  const s = {
    batches: [] as Company[][],
    logLines: [] as string[],
    events: [] as LookupProgress[],
    order: [] as string[]
  } as Setup
  const fetcher: Fetcher = {
    async post() {
      throw new Error('these tests never POST')
    },
    async getBytes() {
      throw new Error('these tests never download files')
    },
    async get(url) {
      s.order.push(`fetch ${url}`)
      const r = (opts.fetch ?? plainPage)(url)
      if (r instanceof Error) throw r
      return r
    }
  }
  const runBatch: RunBatch = async (companies, signal) => {
    s.batches.push(companies)
    s.order.push(`batch ${companies.map((c) => c.name).join(', ')}`)
    return opts.runBatch ? opts.runBatch(s)(companies, signal) : okOutcome(companies)
  }
  s.lookup = createLookup({
    db,
    fetcher,
    runBatch,
    log: (line) => s.logLines.push(line),
    onProgress: (p) => s.events.push(p),
    batchSize: opts.batchSize,
    maxAttempts: opts.maxAttempts,
    parallel: opts.parallel
  })
  return s
}

/** Lets every promise that can settle now settle. */
const settleAll = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('createLookup', () => {
  test('companies that already have a link are checked without Claude', async () => {
    add(
      { name: 'Alpha', careersUrl: 'https://alpha.com/careers' },
      { name: 'Beta', careersUrl: 'https://beta.com/careers' },
      { name: 'Gamma', careersUrl: 'https://gamma.com/careers' }
    )
    const s = setup({
      fetch: (url) => {
        if (url.includes('alpha'))
          return { status: 200, body: '', url: 'https://alpha.wd3.myworkdayjobs.com/External' }
        if (url.includes('gamma')) return new BlockedError('gamma.com', 'HTTP 403')
        return plainPage(url)
      }
    })
    await s.lookup.start()

    expect(s.batches).toEqual([])
    expect(findCompany(db, 'Alpha')).toMatchObject({
      status: 'direct',
      jobBoard: { system: 'workday', board: 'alpha.wd3/External' },
      careersUrl: 'https://alpha.com/careers'
    })
    expect(findCompany(db, 'Beta')).toMatchObject({ status: 'needs_claude', error: null })
    expect(findCompany(db, 'Gamma')).toMatchObject({ status: 'blocked', error: 'HTTP 403' })
    expect(s.logLines).toEqual([
      'lookup started: 3 companies',
      'Alpha: direct (workday alpha.wd3/External)',
      'Beta: needs_claude',
      'Gamma: blocked, HTTP 403',
      'lookup finished'
    ])
  })

  test('a link on a job board counts as no link: that company goes to Claude, after the linked ones', async () => {
    add(
      { name: 'Alpha', careersUrl: 'https://www.linkedin.com/company/alpha/jobs' },
      { name: 'Beta', careersUrl: 'https://beta.com/careers' },
      { name: 'Gamma' }
    )
    const s = setup()
    await s.lookup.start()

    expect(s.order).toEqual(['fetch https://beta.com/careers', 'batch Alpha, Gamma'])
    // Claude's answer replaces the job board link.
    expect(findCompany(db, 'Alpha')).toMatchObject({
      status: 'direct',
      careersUrl: null,
      jobBoard: { system: 'greenhouse', board: 'alpha' }
    })
  })

  test('12 companies without links go to Claude in batches of 5, 5 and 2', async () => {
    addNumbered(12)
    const s = setup()
    await s.lookup.start()

    expect(s.batches.map((b) => b.length)).toEqual([5, 5, 2])
    expect(statusCounts(db)).toMatchObject({ direct: 12, pending: 0 })
    expect(s.logLines[0]).toBe('lookup started: 12 companies')
    expect(s.logLines).toContain('Co 7: direct (greenhouse co7)')
    expect(s.logLines.at(-1)).toBe('lookup finished')
  })

  test('the batch size can be changed', async () => {
    addNumbered(5)
    const s = setup({ batchSize: 2 })
    await s.lookup.start()
    expect(s.batches.map((b) => b.length)).toEqual([2, 2, 1])
  })

  test('a company missing from two answers becomes not found', async () => {
    addNumbered(3)
    add({ name: 'Ghost' })
    const s = setup({
      runBatch: () => async (companies) => ({
        ok: true,
        answers: companies.filter((c) => c.name !== 'Ghost').map(answerFor),
        summary: ''
      })
    })
    await s.lookup.start()

    // The first pass misses Ghost once; the second pass asks for it again and misses it for good.
    expect(s.batches.map((b) => b.map((c) => c.name))).toEqual([
      ['Co 1', 'Co 2', 'Co 3', 'Ghost'],
      ['Ghost']
    ])
    const ghost = findCompany(db, 'Ghost')!
    expect(ghost).toMatchObject({
      status: 'not_found',
      note: 'Claude gave no answer for this company'
    })
    expect(attemptsOf(ghost.id)).toBe(2)
    expect(s.logLines.filter((l) => l.startsWith('Ghost:'))).toEqual(['Ghost: not_found'])
    expect(s.logLines.at(-1)).toBe('lookup finished')
    expect(s.lookup.progress()).toMatchObject({ running: false, done: 4, total: 4 })
  })

  test('an answer with no usable link becomes not found, and the note is kept', async () => {
    add({ name: 'Gone Inc' })
    const s = setup({
      runBatch: () => async (companies) => ({
        ok: true,
        answers: [{ id: companies[0].id, careersUrl: null, jobsUrl: null, note: 'acquired by X' }],
        summary: ''
      })
    })
    await s.lookup.start()
    expect(findCompany(db, 'Gone Inc')).toMatchObject({
      status: 'not_found',
      note: 'acquired by X'
    })
    expect(s.batches).toHaveLength(1)
  })

  test('a failed run marks nobody, stops, and logs and shows the summary', async () => {
    addNumbered(12)
    const s = setup({
      parallel: 1,
      runBatch: () => async () => ({ ok: false, answers: [], summary: 'Not logged in' })
    })
    await s.lookup.start()

    expect(statusCounts(db).pending).toBe(12)
    expect(s.batches).toHaveLength(1)
    // The first batch of 5 is the one that failed, so the summary and the log name them.
    expect(s.lookup.progress().lastSummary).toBe(
      'Not logged in (batch: Co 1, Co 2, Co 3, Co 4, Co 5)'
    )
    expect(s.lookup.progress().running).toBe(false)
    expect(s.logLines).toContain(
      'lookup batch failed (Co 1, Co 2, Co 3, Co 4, Co 5): Not logged in'
    )
    expect(s.logLines).not.toContain('lookup finished')
    // A failure is not a miss: nobody's attempts go up.
    expect(attemptsOf(findCompany(db, 'Co 1')!.id)).toBe(0)
  })

  test('a batch that throws is a failed batch with the error message', async () => {
    addNumbered(2)
    const s = setup({
      runBatch: () => async () => {
        throw new Error('spawn exploded')
      }
    })
    await s.lookup.start()
    expect(s.lookup.progress()).toMatchObject({
      running: false,
      lastSummary: 'spawn exploded (batch: Co 1, Co 2)'
    })
    expect(s.logLines).toContain('lookup batch failed (Co 1, Co 2): spawn exploded')
    expect(statusCounts(db).pending).toBe(2)
  })

  test('a batch that fails names only its own companies, not the whole run', async () => {
    addNumbered(7)
    let calls = 0
    const s = setup({
      runBatch: () => async (companies) =>
        ++calls === 1 ? okOutcome(companies) : { ok: false, answers: [], summary: 'Rate limited' }
    })
    await s.lookup.start()
    expect(s.lookup.progress().lastSummary).toBe('Rate limited (batch: Co 6, Co 7)')
    expect(s.logLines).toContain('lookup batch failed (Co 6, Co 7): Rate limited')
  })

  test('an error that is not a batch outcome ends the run, is logged, and reaches the screen', async () => {
    add({ name: 'Alpha', careersUrl: 'https://alpha.com/careers' }, { name: 'Beta' })
    const s = setup({
      // The database goes away while a page is being read, so saving the result throws.
      fetch: (url) => {
        db.close()
        return plainPage(url)
      }
    })
    // The run does not reject: the screen learns of the failure from the progress.
    await s.lookup.start()

    const summary = s.lookup.progress().lastSummary
    expect(summary).toMatch(/^Lookup stopped: .+/)
    const message = summary!.slice('Lookup stopped: '.length)
    expect(s.logLines).toContain(`lookup failed: ${message}`)
    expect(s.logLines).not.toContain('lookup finished')
    expect(s.lookup.progress()).toMatchObject({ running: false, current: [], step: null })
    expect(s.events.at(-1)).toEqual(s.lookup.progress())
    // The linked company came first and the error ended the run there, so Claude was never asked.
    expect(s.batches).toEqual([])
  })

  test('lastSummary is cleared when the next run starts', async () => {
    addNumbered(2)
    let failing = true
    const s = setup({
      runBatch: () => async (companies) =>
        failing ? { ok: false, answers: [], summary: 'Not logged in' } : okOutcome(companies)
    })
    await s.lookup.start()
    expect(s.lookup.progress().lastSummary).toBe('Not logged in (batch: Co 1, Co 2)')

    failing = false
    s.events.length = 0
    await s.lookup.start()
    expect(s.events[0]).toMatchObject({ running: true, lastSummary: null })
    expect(s.lookup.progress()).toMatchObject({ running: false, lastSummary: null, done: 2 })
  })

  test('stop during the batches aborts every one and leaves them not checked yet', async () => {
    addNumbered(12)
    const seen: AbortSignal[] = []
    const s = setup({
      // Even a batch that comes back ok after the stop must not be saved.
      runBatch: () => (companies, signal) => {
        seen.push(signal)
        return new Promise((resolve) =>
          signal.addEventListener('abort', () => resolve(okOutcome(companies)))
        )
      }
    })
    const run = s.lookup.start()
    await settleAll()
    s.lookup.stop()
    await run

    expect(seen).toHaveLength(3)
    expect(seen.every((signal) => signal.aborted)).toBe(true)
    expect(statusCounts(db).pending).toBe(12)
    expect(s.batches).toHaveLength(3)
    expect(s.logLines).toContain('lookup stopped')
    expect(s.logLines).not.toContain('lookup finished')
    expect(s.lookup.progress()).toMatchObject({
      running: false,
      lastSummary: 'Stopped.',
      step: null
    })
  })

  test('a batch that comes back failed as Stopped. after a stop is a stop, not a failure', async () => {
    addNumbered(3)
    let inBatch!: () => void
    const entered = new Promise<void>((resolve) => (inBatch = resolve))
    const s = setup({
      // This is what the real runBatch returns when it kills Claude on a stop.
      runBatch: () => (_companies, signal) => {
        inBatch()
        return new Promise((resolve) =>
          signal.addEventListener('abort', () =>
            resolve({ ok: false, answers: [], summary: 'Stopped.' })
          )
        )
      }
    })
    const run = s.lookup.start()
    await entered
    s.lookup.stop()
    await run

    expect(s.logLines).toEqual(['lookup started: 3 companies', 'lookup stopped'])
    expect(s.lookup.progress().lastSummary).toBe('Stopped.')
    expect(statusCounts(db).pending).toBe(3)
    expect(attemptsOf(findCompany(db, 'Co 1')!.id)).toBe(0)
  })

  test('stop while checking a linked company saves nothing more and starts no batch', async () => {
    add(
      { name: 'Alpha', careersUrl: 'https://alpha.com/careers' },
      { name: 'Beta', careersUrl: 'https://beta.com/careers' },
      { name: 'Gamma' }
    )
    let stop = (): void => {}
    const s = setup({
      fetch: (url) => {
        stop()
        return plainPage(url)
      }
    })
    stop = () => s.lookup.stop()
    await s.lookup.start()

    expect(s.order).toEqual(['fetch https://alpha.com/careers'])
    expect(statusCounts(db).pending).toBe(3)
    expect(s.logLines.at(-1)).toBe('lookup stopped')
  })

  test('stop with nothing running does nothing', async () => {
    addNumbered(1)
    const s = setup()
    s.lookup.stop()
    await s.lookup.start()
    expect(statusCounts(db).direct).toBe(1)
  })

  test('start while running does not start a second run', async () => {
    addNumbered(3)
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const s = setup({
      runBatch: () => async (companies) => {
        await gate
        return okOutcome(companies)
      }
    })
    const first = s.lookup.start()
    const second = s.lookup.start()
    expect(second).toBe(first)
    release()
    await first

    expect(s.batches).toHaveLength(1)
    expect(s.logLines.filter((l) => l.startsWith('lookup started'))).toHaveLength(1)
    // Once it has ended, a new start is a new run.
    const third = s.lookup.start()
    expect(third).not.toBe(first)
    await third
  })

  test('progress counts companies done out of those pending at start, with the names of the batches with Claude as current', async () => {
    addNumbered(3)
    add({ name: 'Settled' })
    saveCheck(db, findCompany(db, 'Settled')!.id, {
      careersUrl: null,
      jobsUrl: null,
      status: 'not_found',
      jobBoard: null,
      note: null,
      error: null
    })
    const s = setup({ batchSize: 2 })
    expect(s.lookup.progress()).toEqual({
      running: false,
      done: 0,
      total: 0,
      current: [],
      step: null,
      lastSummary: null
    })
    await s.lookup.start()

    expect(s.events[0]).toEqual({
      running: true,
      done: 0,
      total: 3,
      current: [],
      step: null,
      lastSummary: null
    })
    // Both batches are with Claude at once, so the names of both show.
    const currents = s.events.map((e) => e.current)
    expect(currents).toContainEqual(['Co 1', 'Co 2'])
    expect(currents).toContainEqual(['Co 1', 'Co 2', 'Co 3'])
    // One event as each company is saved, so done climbs 0, 1, 2, 3 without skipping.
    const doneSeen = s.events.map((e) => e.done)
    expect([...new Set(doneSeen)]).toEqual([0, 1, 2, 3])
    expect(s.events.at(-1)).toEqual({
      running: false,
      done: 3,
      total: 3,
      current: [],
      step: null,
      lastSummary: null
    })
    expect(s.lookup.progress()).toEqual(s.events.at(-1))
  })

  test('step shows on the progress and goes away when the batch ends', async () => {
    addNumbered(2)
    const s = setup({
      runBatch: (self) => async (companies) => {
        self.lookup.step('Searching the web: Co 1 careers')
        expect(self.lookup.progress().step).toBe('Searching the web: Co 1 careers')
        return okOutcome(companies)
      }
    })
    await s.lookup.start()

    expect(s.events.some((e) => e.step === 'Searching the web: Co 1 careers')).toBe(true)
    // The step is gone as soon as the batch comes back, before its companies are saved.
    expect(s.events.filter((e) => e.done > 0).every((e) => e.step === null)).toBe(true)
    expect(s.lookup.progress().step).toBeNull()
  })

  test('up to 3 batches are with Claude at once, and the next starts when one ends', async () => {
    addNumbered(20)
    const release: (() => void)[] = []
    const s = setup({
      runBatch: () => (companies) =>
        new Promise((resolve) => release.push(() => resolve(okOutcome(companies))))
    })
    const run = s.lookup.start()
    await settleAll()

    expect(s.batches.map((b) => b[0].name)).toEqual(['Co 1', 'Co 6', 'Co 11'])
    expect(s.lookup.progress().current).toHaveLength(15)
    release[1]()
    await settleAll()
    // The second batch was saved and its companies left the progress line; the fourth took its place.
    expect(s.batches.map((b) => b[0].name)).toEqual(['Co 1', 'Co 6', 'Co 11', 'Co 16'])
    expect(findCompany(db, 'Co 6')).toMatchObject({ status: 'direct' })
    expect(s.lookup.progress().current).not.toContain('Co 6')
    expect(s.lookup.progress().current).toContain('Co 16')

    for (const r of [release[0], release[2], release[3]]) r()
    await run
    expect(statusCounts(db)).toMatchObject({ direct: 20, pending: 0 })
    expect(s.lookup.progress()).toMatchObject({ running: false, done: 20, current: [] })
  })

  test('how many batches are with Claude at once can be changed', async () => {
    addNumbered(15)
    let running = 0
    let most = 0
    const s = setup({
      parallel: 2,
      runBatch: () => async (companies) => {
        most = Math.max(most, ++running)
        await settleAll()
        running--
        return okOutcome(companies)
      }
    })
    await s.lookup.start()
    expect(most).toBe(2)
    expect(s.batches).toHaveLength(3)
  })

  test('after a failed batch no new batch starts, and the batches already with Claude are saved', async () => {
    addNumbered(15)
    let release!: () => void
    const s = setup({
      parallel: 2,
      runBatch: () => (companies) =>
        companies[0].name === 'Co 1'
          ? Promise.resolve({ ok: false, answers: [], summary: 'Rate limited' })
          : new Promise((resolve) => (release = () => resolve(okOutcome(companies))))
    })
    const run = s.lookup.start()
    await settleAll()
    release()
    await run

    expect(s.batches.map((b) => b[0].name)).toEqual(['Co 1', 'Co 6'])
    expect(findCompany(db, 'Co 6')).toMatchObject({ status: 'direct' })
    expect(statusCounts(db)).toMatchObject({ direct: 5, pending: 10 })
    expect(s.lookup.progress()).toMatchObject({
      running: false,
      current: [],
      lastSummary: 'Rate limited (batch: Co 1, Co 2, Co 3, Co 4, Co 5)'
    })
    expect(s.logLines).not.toContain('lookup finished')
  })

  test('an error while saving a batch starts no new batch and ends the run once the others are back', async () => {
    addNumbered(3)
    const s = setup({
      batchSize: 1,
      parallel: 2,
      runBatch: () => async (companies) => {
        // The database goes away while Claude has Co 1, so saving its answer throws.
        if (companies[0].name === 'Co 1') db.close()
        await settleAll()
        return okOutcome(companies)
      }
    })
    await s.lookup.start()

    expect(s.batches.map((b) => b[0].name)).toEqual(['Co 1', 'Co 2'])
    expect(s.lookup.progress()).toMatchObject({ running: false, current: [] })
    expect(s.lookup.progress().lastSummary).toMatch(/^Lookup stopped: .+/)
    expect(s.logLines).not.toContain('lookup finished')
  })

  test("a company the owner settled meanwhile keeps the owner's result", async () => {
    addNumbered(2)
    const [one, two] = ['Co 1', 'Co 2'].map((n) => findCompany(db, n)!)
    const s = setup({
      runBatch: () => async () => {
        // The owner pastes a link for each while Claude is working; Claude answers for neither.
        saveCheck(db, one.id, {
          careersUrl: 'https://one.com/careers',
          jobsUrl: 'https://one.com/careers',
          status: 'needs_claude',
          jobBoard: null,
          note: 'Link added by you',
          error: null
        })
        saveCheck(db, two.id, {
          careersUrl: null,
          jobsUrl: null,
          status: 'blocked',
          jobBoard: null,
          note: null,
          error: 'HTTP 403'
        })
        return { ok: true, answers: [answerFor(one)], summary: '' }
      }
    })
    await s.lookup.start()

    expect(getCompany(db, one.id)).toMatchObject({
      status: 'needs_claude',
      note: 'Link added by you'
    })
    expect(getCompany(db, two.id)).toMatchObject({ status: 'blocked' })
    expect(attemptsOf(two.id)).toBe(0)
    expect(s.batches).toHaveLength(1)
    // They did leave pending during the run, so they count as done.
    expect(s.lookup.progress()).toMatchObject({ done: 2, total: 2 })
  })
})

describe('checkLink', () => {
  const fetcher = (reply: (url: string) => FetchResult | Error): Fetcher & { calls: string[] } => {
    const calls: string[] = []
    return {
      calls,
      async post() {
        throw new Error('these tests never POST')
      },
      async getBytes() {
        throw new Error('these tests never download files')
      },
      async get(url) {
        calls.push(url)
        const r = reply(url)
        if (r instanceof Error) throw r
        return r
      }
    }
  }

  test('checkLink refuses a link that is not a web address or is a job board site', async () => {
    const [{ id }] = add({ name: 'Acme' })
    const f = fetcher(plainPage)
    await expect(checkLink(db, f, id, 'mailto:x@y.z')).rejects.toThrow(
      'Paste a link that starts with http:// or https://'
    )
    await expect(checkLink(db, f, id, 'not a link')).rejects.toThrow(
      'Paste a link that starts with http:// or https://'
    )
    await expect(
      checkLink(db, f, id, 'https://www.linkedin.com/company/acme/jobs')
    ).rejects.toThrow("Use the company's own careers page, not a job board")
    // A bare job board address gets its https:// first, and is then refused for what it is.
    await expect(checkLink(db, f, id, 'linkedin.com/company/acme/jobs')).rejects.toThrow(
      "Use the company's own careers page, not a job board"
    )
    expect(f.calls).toEqual([])
    expect(getCompany(db, id)?.status).toBe('pending')
  })

  test('checkLink accepts a bare address and checks it with https:// in front', async () => {
    const [{ id }] = add({ name: 'Acme' })
    const f = fetcher(plainPage)
    const company = await checkLink(db, f, id, ' acme.com/careers ')

    expect(f.calls).toEqual(['https://acme.com/careers'])
    expect(company).toMatchObject({
      careersUrl: 'https://acme.com/careers',
      jobsUrl: 'https://acme.com/careers',
      status: 'needs_claude'
    })
  })

  test('checkLink saves the result with the note "Link added by you"', async () => {
    const [{ id }] = add({ name: 'Acme' })
    const f = fetcher(plainPage)
    const company = await checkLink(db, f, id, '  https://acme.com/careers  ')

    expect(f.calls).toEqual(['https://acme.com/careers'])
    expect(company).toMatchObject({
      id,
      status: 'needs_claude',
      careersUrl: 'https://acme.com/careers',
      jobsUrl: 'https://acme.com/careers',
      note: 'Link added by you',
      error: null
    })
    expect(getCompany(db, id)).toEqual(company)
  })

  test('checkLink reads a job system link directly, with no fetch', async () => {
    const [{ id }] = add({ name: 'Acme' })
    const f = fetcher(plainPage)
    const company = await checkLink(db, f, id, 'https://jobs.lever.co/acme')
    expect(company).toMatchObject({
      status: 'direct',
      jobBoard: { system: 'lever', board: 'acme' }
    })
    expect(f.calls).toEqual([])
  })

  test('checkLink works on a company in any status and leaves its lookup attempts alone', async () => {
    const [{ id }] = add({ name: 'Ghost' })
    noteFailedLookup(db, id, 1)
    expect(getCompany(db, id)?.status).toBe('not_found')
    expect(attemptsOf(id)).toBe(1)

    const company = await checkLink(
      db,
      fetcher(() => new BlockedError('ghost.com', 'HTTP 403')),
      id,
      'https://ghost.com/careers'
    )
    expect(company).toMatchObject({
      status: 'blocked',
      error: 'HTTP 403',
      note: 'Link added by you'
    })
    expect(attemptsOf(id)).toBe(1)
  })

  test('checkLink for a company that is gone says so', async () => {
    await expect(
      checkLink(db, fetcher(plainPage), 999, 'https://acme.com/careers')
    ).rejects.toThrow('That company is no longer in the list')
  })
})

describe('normalizeLink', () => {
  test.each([
    ['acme.com/careers', 'https://acme.com/careers'],
    ['www.acme.com', 'https://www.acme.com'],
    ['  acme.com/careers  ', 'https://acme.com/careers'],
    ['https://x.test', 'https://x.test'],
    ['  http://x.test/a  ', 'http://x.test/a'],
    ['mailto:a@b.c', 'mailto:a@b.c'],
    ['not a link', 'not a link'],
    ['acme', 'acme'],
    ['/careers', '/careers'],
    ['', '']
  ])('%j becomes %j', (input, expected) => expect(normalizeLink(input)).toBe(expected))
})

describe('linkProblem', () => {
  test('is null for an address on a company site', () => {
    expect(linkProblem('https://acme.com/careers')).toBeNull()
    expect(linkProblem('http://acme.com')).toBeNull()
    expect(linkProblem('https://jobs.lever.co/acme')).toBeNull()
  })

  test('says to paste an http:// or https:// link for anything else', () => {
    for (const text of ['', 'mailto:a@b.c', 'not a link', 'acme.com/careers', 'ftp://acme.com'])
      expect(linkProblem(text), text).toBe('Paste a link that starts with http:// or https://')
  })

  test('says to use the company page for a job board', () => {
    expect(linkProblem('https://www.linkedin.com/company/acme/jobs')).toBe(
      "Use the company's own careers page, not a job board"
    )
    expect(linkProblem('https://se.indeed.com/jobs?q=x')).toBe(
      "Use the company's own careers page, not a job board"
    )
  })
})

describe('addCompany', () => {
  const noFetch = (): Fetcher & { calls: string[] } => {
    const calls: string[] = []
    return {
      calls,
      async post() {
        throw new Error('these tests never POST')
      },
      async getBytes() {
        throw new Error('these tests never download files')
      },
      async get(url) {
        calls.push(url)
        return plainPage(url)
      }
    }
  }
  const names = (): string[] => db.prepare('SELECT name FROM companies').pluck().all() as string[]

  test('a company with no link is added as not checked yet, and nothing is fetched', async () => {
    const f = noFetch()
    const company = await addCompany(db, f, '  Komatsu ', 'machinery', null)
    expect(company).toMatchObject({ name: 'Komatsu', list: 'machinery', status: 'pending' })
    expect(f.calls).toEqual([])
  })

  test('a blank name adds nothing', async () => {
    await expect(addCompany(db, noFetch(), '   ', 'vehicle', null)).rejects.toThrow(
      'Type a company name.'
    )
    expect(names()).toEqual([])
  })

  test('a company that is already there is refused by its stored name, whatever the case', async () => {
    add({ name: 'Waymo' })
    await expect(addCompany(db, noFetch(), ' waymo ', 'both', null)).rejects.toThrow(
      'Waymo is already in the app.'
    )
    expect(names()).toEqual(['Waymo'])
  })

  test.each([
    ['not a link', 'Paste a link that starts with http:// or https://'],
    ['mailto:a@b.c', 'Paste a link that starts with http:// or https://'],
    [
      'https://www.linkedin.com/company/acme/jobs',
      "Use the company's own careers page, not a job board"
    ],
    ['linkedin.com/company/acme/jobs', "Use the company's own careers page, not a job board"]
  ])('a refused link (%s) adds nothing', async (link, message) => {
    const f = noFetch()
    await expect(addCompany(db, f, 'Acme', 'vehicle', link)).rejects.toThrow(message)
    expect(names()).toEqual([])
    expect(f.calls).toEqual([])
  })

  test('a good link adds the company and checks it, a bare address getting https:// first', async () => {
    const f = noFetch()
    const company = await addCompany(db, f, 'Acme', 'vehicle', '  acme.com/careers ')
    expect(f.calls).toEqual(['https://acme.com/careers'])
    expect(company).toMatchObject({
      name: 'Acme',
      status: 'needs_claude',
      careersUrl: 'https://acme.com/careers',
      note: 'Link added by you'
    })
    expect(names()).toEqual(['Acme'])
  })

  test('a blank link counts as no link', async () => {
    const f = noFetch()
    const company = await addCompany(db, f, 'Acme', 'vehicle', '   ')
    expect(company).toMatchObject({ name: 'Acme', status: 'pending', careersUrl: null })
    expect(f.calls).toEqual([])
  })
})

describe('makeRunBatch', () => {
  const company = (): Company => add({ name: 'Acme' })[0]

  test('makeRunBatch without Claude Code fails the batch with a plain message', async () =>
    expect(
      await makeRunBatch({
        findClaudePath: () => null,
        cwd: dir,
        timeoutMs: 1000,
        onStep: () => {}
      })([company()], new AbortController().signal)
    ).toEqual({ ok: false, answers: [], summary: 'Claude Code was not found on this computer.' }))

  test('an already stopped signal fails the batch as stopped, without starting Claude', async () => {
    const cwd = join(dir, 'claude')
    const stopped = new AbortController()
    stopped.abort()
    const runBatch = makeRunBatch({
      findClaudePath: () => join(dir, 'no-such-claude.exe'),
      cwd,
      timeoutMs: 1000,
      onStep: () => {}
    })
    expect(await runBatch([company()], stopped.signal)).toEqual({
      ok: false,
      answers: [],
      summary: 'Stopped.'
    })
    // It never got as far as making Claude's working folder.
    expect(existsSync(cwd)).toBe(false)
  })
})
