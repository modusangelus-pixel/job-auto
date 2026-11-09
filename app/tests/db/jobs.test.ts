import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openDb, type Db } from '../../src/main/db/db'
import {
  addCompanies,
  findCompany,
  listCompanies,
  removeCompany
} from '../../src/main/db/companies'
import {
  knownDetails,
  noteReadFailed,
  saveRead,
  setJobNotes,
  setJobStatus,
  storedJobs
} from '../../src/main/db/jobs'
import type { Job, RawJob } from '../../src/shared/types'

let dir = ''
let db: Db
let cid = 0
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'job-jobs-'))
  db = openDb(join(dir, 'job-auto.db'))
  addCompanies(db, [{ name: 'Acme', list: 'vehicle' }])
  cid = findCompany(db, 'Acme')!.id
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const DAY = 24 * 3600 * 1000
const T0 = new Date('2026-11-01T10:00:00Z')
const at = (days: number): Date => new Date(T0.getTime() + days * DAY)
const BOARD = 'greenhouse:acme'

function raw(sourceId: string, over: Partial<RawJob> = {}): RawJob {
  return {
    sourceId,
    title: `Job ${sourceId}`,
    location: 'Gothenburg, Sweden',
    countries: ['SE'],
    employment: 'full_time',
    url: `https://example.com/${sourceId}`,
    postedAt: null,
    postedRough: false,
    needsDetails: false,
    ...over
  }
}

const byTitle = (now: Date): Map<string, Job> =>
  new Map(storedJobs(db, now).map((j) => [j.title, j]))

describe('saveRead', () => {
  test('a first read stores every job as baseline, and none is New', () => {
    const r = saveRead(db, cid, BOARD, [raw('a'), raw('b')], true, T0)
    expect(r).toEqual({ added: 2, closed: 0 })
    const jobs = storedJobs(db, T0)
    expect(jobs).toHaveLength(2)
    expect(jobs.every((j) => !j.isNew)).toBe(true)
    expect(jobs[0]).toMatchObject({
      companyId: cid,
      company: 'Acme',
      list: 'vehicle',
      countries: ['SE'],
      firstSeen: T0.toISOString(),
      lastSeen: T0.toISOString(),
      closedAt: null,
      status: null,
      notes: '',
      regionGroups: [],
      locationUnclear: false
    })
  })

  test('a second read adds a job as New, keeps the rest, and closes one that is gone', () => {
    saveRead(db, cid, BOARD, [raw('a'), raw('b')], true, T0)
    const r = saveRead(db, cid, BOARD, [raw('a'), raw('c')], true, at(1))
    expect(r).toEqual({ added: 1, closed: 1 })
    const jobs = byTitle(at(1))
    expect(jobs.get('Job c')!.isNew).toBe(true)
    expect(jobs.get('Job a')!.isNew).toBe(false)
    expect(jobs.get('Job a')!.lastSeen).toBe(at(1).toISOString())
    expect(jobs.has('Job b')).toBe(false)
    const closed = db.prepare("SELECT closed_at FROM jobs WHERE source_id = 'b'").pluck().get()
    expect(closed).toBe(at(1).toISOString())
  })

  test('a job is New for 7 days and stops being New once it has a status', () => {
    saveRead(db, cid, BOARD, [raw('a')], true, T0)
    saveRead(db, cid, BOARD, [raw('a'), raw('c')], true, at(1))
    const id = byTitle(at(1)).get('Job c')!.id
    const justBefore = new Date(at(1).getTime() + 7 * DAY - 1)
    expect(byTitle(justBefore).get('Job c')!.isNew).toBe(true)
    expect(byTitle(new Date(at(1).getTime() + 7 * DAY)).get('Job c')!.isNew).toBe(false)
    setJobStatus(db, id, 'interested')
    expect(byTitle(at(1)).get('Job c')!.isNew).toBe(false)
    expect(byTitle(at(1)).get('Job c')!.status).toBe('interested')
    setJobStatus(db, id, null)
    expect(byTitle(at(1)).get('Job c')!.isNew).toBe(true)
    setJobNotes(db, id, 'call Anna')
    expect(byTitle(at(1)).get('Job c')!.notes).toBe('call Anna')
  })

  test('an incomplete read adds and updates but closes nothing', () => {
    saveRead(db, cid, BOARD, [raw('a'), raw('b')], true, T0)
    const r = saveRead(db, cid, BOARD, [raw('a', { title: 'Renamed' }), raw('c')], false, at(1))
    expect(r).toEqual({ added: 1, closed: 0 })
    const jobs = byTitle(at(1))
    expect(jobs.has('Renamed')).toBe(true)
    expect(jobs.has('Job b')).toBe(true)
    expect(jobs.get('Job c')!.isNew).toBe(true)
  })

  test('a read of a different board is a baseline again and closes nothing that day', () => {
    saveRead(db, cid, BOARD, [raw('a'), raw('b')], true, T0)
    const r = saveRead(db, cid, 'lever:acme', [raw('a'), raw('z')], true, at(1))
    expect(r).toEqual({ added: 1, closed: 0 })
    const jobs = byTitle(at(1))
    expect(jobs.get('Job z')!.isNew).toBe(false)
    expect(jobs.has('Job b')).toBe(true)
    expect(db.prepare('SELECT read_board FROM companies WHERE id = ?').pluck().get(cid)).toBe(
      'lever:acme'
    )
    // the next read on the same board closes what is gone
    const next = saveRead(db, cid, 'lever:acme', [raw('a')], true, at(2))
    expect(next.closed).toBe(2)
  })

  test('a job that comes back after closing is open again with its first_seen kept', () => {
    saveRead(db, cid, BOARD, [raw('a'), raw('b')], true, T0)
    saveRead(db, cid, BOARD, [raw('a')], true, at(1))
    const r = saveRead(db, cid, BOARD, [raw('a'), raw('b')], true, at(2))
    expect(r.added).toBe(0)
    const b = byTitle(at(2)).get('Job b')!
    expect(b.closedAt).toBeNull()
    expect(b.firstSeen).toBe(T0.toISOString())
    expect(b.lastSeen).toBe(at(2).toISOString())
  })

  test('details already read are kept when the list again lacks them', () => {
    const full = raw('w', { countries: ['DE'], employment: 'intern', postedAt: '2026-10-30' })
    saveRead(db, cid, BOARD, [full], true, T0)
    const lacking = raw('w', {
      title: 'New title',
      countries: [],
      employment: 'unknown',
      postedAt: null,
      needsDetails: true
    })
    saveRead(db, cid, BOARD, [lacking], true, at(1))
    expect(storedJobs(db, at(1))[0]).toMatchObject({
      title: 'New title',
      countries: ['DE'],
      employment: 'intern',
      postedAt: '2026-10-30'
    })
    expect(knownDetails(db, cid).get('w')).toEqual({
      countries: ['DE'],
      employment: 'intern',
      postedAt: '2026-10-30'
    })
  })

  test('details are not kept when they were never read', () => {
    saveRead(db, cid, BOARD, [raw('w', { countries: [], needsDetails: true })], true, T0)
    expect(knownDetails(db, cid).size).toBe(0)
    saveRead(db, cid, BOARD, [raw('w', { countries: ['DE'], needsDetails: true })], true, at(1))
    expect(storedJobs(db, at(1))[0].countries).toEqual(['DE'])
  })
})

describe('other store functions', () => {
  test('noteReadFailed records the error and touches no job; blocked also sets the company blocked with that error', () => {
    saveRead(db, cid, BOARD, [raw('a')], true, T0)
    noteReadFailed(db, cid, 'timeout', false, at(1))
    let c = findCompany(db, 'Acme')!
    expect(c.readError).toBe('timeout')
    expect(c.status).not.toBe('blocked')
    expect(c.readAt).toBe(T0.toISOString())
    expect(c.openJobs).toBe(1)
    expect(storedJobs(db, at(1))[0].lastSeen).toBe(T0.toISOString())
    noteReadFailed(db, cid, 'robots.txt says no', true, at(2))
    c = findCompany(db, 'Acme')!
    expect(c.status).toBe('blocked')
    expect(c.error).toBe('robots.txt says no')
    expect(c.readError).toBe('robots.txt says no')
    expect(c.openJobs).toBe(1)
  })

  test('removing a company removes its jobs', () => {
    saveRead(db, cid, BOARD, [raw('a')], true, T0)
    removeCompany(db, cid)
    expect(db.prepare('SELECT COUNT(*) FROM jobs').pluck().get()).toBe(0)
  })

  test('storedJobs leaves out closed jobs without a status and keeps closed ones with a status', () => {
    saveRead(db, cid, BOARD, [raw('a'), raw('b'), raw('c')], true, T0)
    setJobStatus(db, byTitle(T0).get('Job b')!.id, 'applied')
    saveRead(db, cid, BOARD, [raw('a')], true, at(1))
    const after = byTitle(at(1))
    expect([...after.keys()].sort()).toEqual(['Job a', 'Job b'])
    expect(after.get('Job b')!.closedAt).toBe(at(1).toISOString())
  })

  test('listCompanies shows readAt, readError and the count of open jobs', () => {
    expect(listCompanies(db)[0]).toMatchObject({ readAt: null, readError: null, openJobs: 0 })
    saveRead(db, cid, BOARD, [raw('a'), raw('b')], true, T0)
    expect(listCompanies(db)[0]).toMatchObject({
      readAt: T0.toISOString(),
      readError: null,
      openJobs: 2
    })
    saveRead(db, cid, BOARD, [raw('a')], true, at(1))
    noteReadFailed(db, cid, 'boom', false, at(2))
    expect(listCompanies(db)[0]).toMatchObject({
      readAt: at(1).toISOString(),
      readError: 'boom',
      openJobs: 1
    })
  })
})
