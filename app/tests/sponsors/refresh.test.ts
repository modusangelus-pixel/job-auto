import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { addCompanies, findCompany } from '../../src/main/db/companies'
import { openDb, type Db } from '../../src/main/db/db'
import { BlockedError } from '../../src/main/readers/fetcher'
import type { SponsorEntry, SponsorReader } from '../../src/main/sponsors'
import { refreshSponsorLists } from '../../src/main/sponsors/refresh'
import {
  noteSponsorListFailed,
  saveSponsorList,
  sponsorLists,
  sponsorMatches
} from '../../src/main/sponsors/store'
import type { SponsorCountry } from '../../src/shared/types'
import { fakeFetcher } from './helpers'

let dir = ''
let db: Db
let logs: string[] = []
const NOW = new Date('2026-11-05T10:00:00.000Z')
const DAY = 24 * 3600 * 1000
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'job-sponsor-refresh-'))
  db = openDb(join(dir, 'job-auto.db'))
  logs = []
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const many = (n: number): SponsorEntry[] =>
  Array.from({ length: n }, (_, i) => ({ name: `Company ${i}`, detail: 'd' }))

function reader(
  country: SponsorCountry,
  result: SponsorEntry[] | Error,
  ran: string[]
): SponsorReader {
  return {
    country,
    async read() {
      ran.push(country)
      if (result instanceof Error) throw result
      return { entries: result, source: `src-${country}` }
    }
  }
}

const run = (readers: SponsorReader[], force = false): Promise<void> =>
  refreshSponsorLists({
    db,
    fetcher: fakeFetcher({}).fetcher,
    log: (l) => logs.push(l),
    readers,
    now: () => NOW,
    force
  })

describe('refreshSponsorLists', () => {
  test('reads a never-fetched list, saves it and logs it', async () => {
    const ran: string[] = []
    await run([reader('DK', many(300), ran)])
    expect(ran).toEqual(['DK'])
    expect(sponsorLists(db)[2]).toEqual({
      country: 'DK',
      fetchedAt: NOW.toISOString(),
      entries: 300,
      error: null
    })
    expect(logs).toEqual(['sponsor list DK: 300 entries'])
  })

  test('only stale lists are read; force reads all', async () => {
    saveSponsorList(db, 'NL', many(5000), 's', new Date(NOW.getTime() - 6 * DAY))
    saveSponsorList(db, 'DK', many(300), 's', new Date(NOW.getTime() - 8 * DAY))
    const ran: string[] = []
    const readers = [reader('NL', many(5000), ran), reader('DK', many(300), ran)]
    await run(readers)
    expect(ran).toEqual(['DK'])
    ran.length = 0
    await run(readers, true)
    expect(ran).toEqual(['NL', 'DK'])
  })

  test('an under-minimum read keeps the old entries and records the error', async () => {
    saveSponsorList(db, 'DK', many(400), 's', new Date(NOW.getTime() - 8 * DAY))
    await run([reader('DK', many(10), [])])
    expect(sponsorLists(db)[2]).toMatchObject({
      entries: 400,
      error: 'Read 10 entries, expected at least 300; kept the previous list'
    })
    expect(logs).toEqual([
      'sponsor list DK failed: Read 10 entries, expected at least 300; kept the previous list'
    ])
  })

  test('a throwing reader records the error and the others still run', async () => {
    const ran: string[] = []
    await run([
      reader('GB', new Error('not recognised'), ran),
      reader('NL', new BlockedError('ind.nl', 'robots.txt'), ran),
      reader('DK', many(300), ran)
    ])
    expect(ran).toEqual(['GB', 'NL', 'DK'])
    const lists = sponsorLists(db)
    expect(lists[0].error).toBe('not recognised')
    expect(lists[1].error).toBe('ind.nl blocked: robots.txt')
    expect(lists[2]).toMatchObject({ entries: 300, error: null })
    expect(logs).toContain('sponsor list GB failed: not recognised')
  })

  test('a list that was never fetched is read even after a failed attempt', async () => {
    noteSponsorListFailed(db, 'DK', 'old')
    const ran: string[] = []
    await run([reader('DK', many(300), ran)])
    expect(ran).toEqual(['DK'])
  })

  test('never rejects, even when the database is closed and the log throws', async () => {
    const closed = openDb(join(dir, 'other.db'))
    closed.close()
    await expect(
      refreshSponsorLists({
        db: closed,
        fetcher: fakeFetcher({}).fetcher,
        log: () => {
          throw new Error('log broke')
        },
        readers: [reader('DK', many(300), [])]
      })
    ).resolves.toBeUndefined()
  })

  test('logs a failure of the run itself instead of dropping it', async () => {
    const closed = openDb(join(dir, 'other.db'))
    closed.close()
    await refreshSponsorLists({
      db: closed,
      fetcher: fakeFetcher({}).fetcher,
      log: (l) => logs.push(l),
      readers: [reader('DK', many(300), [])]
    })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatch(/^sponsor lists failed: /)
  })

  test('logs a reader failure even when recording it fails', async () => {
    const failing: SponsorReader = {
      country: 'DK',
      async read() {
        db.exec('DROP TABLE sponsor_lists')
        throw new Error('page changed')
      }
    }
    await run([failing])
    expect(logs[0]).toBe('sponsor list DK failed: page changed')
    expect(logs[1]).toMatch(/^sponsor lists failed: /)
  })

  test('two calls at once share one refresh: each list is read once', async () => {
    const ran: string[] = []
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const slow: SponsorReader = {
      country: 'DK',
      async read() {
        ran.push('DK')
        await gate
        return { entries: many(300), source: 's' }
      }
    }
    const first = run([slow, reader('NL', many(5000), ran)])
    const second = run([slow, reader('NL', many(5000), ran)], true)
    release()
    await Promise.all([first, second])
    expect(ran).toEqual(['DK', 'NL'])
    // The guard is released afterwards: a later forced call reads again.
    await run([reader('NL', many(5000), ran)], true)
    expect(ran).toEqual(['DK', 'NL', 'NL'])
  })
})

describe('a failed refresh keeps the saved list', () => {
  const ENTRIES = [...many(300), { name: 'ABB A/S', detail: 'Fast-track certified' }]
  let abb = 0
  const countRows = (): number =>
    db.prepare("SELECT COUNT(*) FROM sponsor_entries WHERE country = 'DK'").pluck().get() as number
  beforeEach(() => {
    addCompanies(db, [{ name: 'ABB', list: 'machinery' }])
    abb = findCompany(db, 'ABB')!.id
    saveSponsorList(db, 'DK', ENTRIES, 's', new Date(NOW.getTime() - 8 * DAY))
  })

  test('an under-minimum read', async () => {
    await run([reader('DK', many(10), [])])
    expect(countRows()).toBe(301)
    expect(sponsorMatches(db, abb, 'ABB')).toHaveLength(1)
  })

  test('a throwing read', async () => {
    await run([reader('DK', new Error('not recognised'), [])])
    expect(countRows()).toBe(301)
    expect(sponsorMatches(db, abb, 'ABB')).toHaveLength(1)
    expect(sponsorLists(db)[2].error).toBe('not recognised')
  })
})
