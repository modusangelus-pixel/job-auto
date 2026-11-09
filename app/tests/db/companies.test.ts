import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openDb, type Db } from '../../src/main/db/db'
import {
  addCompanies,
  findCompany,
  getCompany,
  listCompanies,
  moveCompany,
  noteFailedLookup,
  pendingCompanies,
  removeCompany,
  resetCompany,
  saveCheck,
  statusCounts
} from '../../src/main/db/companies'
import type { CheckResult, CompanyList } from '../../src/shared/types'

let dir = ''
let db: Db
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'job-db-'))
  db = openDb(join(dir, 'job-auto.db'))
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Adds one company and returns its id. */
function addOne(name: string, list: CompanyList = 'vehicle'): number {
  addCompanies(db, [{ name, list }])
  return findCompany(db, name)!.id
}

function attemptsOf(id: number): number {
  return db.prepare('SELECT lookup_attempts FROM companies WHERE id = ?').pluck().get(id) as number
}

const waymoCheck: CheckResult = {
  careersUrl: 'https://waymo.com/careers',
  jobsUrl: 'https://boards.greenhouse.io/waymo',
  status: 'direct',
  jobBoard: { system: 'greenhouse', board: 'waymo' },
  note: null,
  error: null
}

describe('openDb', () => {
  test('migrates once and keeps the data when reopened', () => {
    addOne('Waymo')
    expect(db.pragma('user_version', { simple: true })).toBe(7)
    db.close()
    db = openDb(join(dir, 'job-auto.db'))
    expect(db.pragma('user_version', { simple: true })).toBe(7)
    expect(listCompanies(db).map((c) => c.name)).toEqual(['Waymo'])
  })
})

describe('companies', () => {
  test('adds companies and skips names already there, whatever the case', () => {
    expect(
      addCompanies(db, [
        { name: 'Waymo', list: 'vehicle' },
        { name: 'Konecranes', list: 'machinery' }
      ])
    ).toEqual({ added: 2, skipped: [] })
    expect(addCompanies(db, [{ name: 'waymo ', list: 'both' }])).toEqual({
      added: 0,
      skipped: ['waymo']
    })
    expect(listCompanies(db).map((c) => [c.name, c.list, c.status])).toEqual([
      ['Konecranes', 'machinery', 'pending'],
      ['Waymo', 'vehicle', 'pending']
    ])
    expect(findCompany(db, ' WAYMO')!.name).toBe('Waymo')
  })

  test('trims names, ignores blank ones, and counts a name repeated in one call as skipped', () => {
    expect(
      addCompanies(db, [
        { name: '  Volvo  ', list: 'vehicle' },
        { name: '   ', list: 'vehicle' },
        { name: '', list: 'machinery' },
        { name: 'VOLVO', list: 'both' },
        { name: 'Cat', list: 'machinery' }
      ])
    ).toEqual({ added: 2, skipped: ['VOLVO'] })
    expect(listCompanies(db).map((c) => [c.name, c.list])).toEqual([
      ['Cat', 'machinery'],
      ['Volvo', 'vehicle']
    ])
  })

  test('stores the owner fields, and defaults the rest', () => {
    addCompanies(db, [
      {
        name: 'Einride',
        list: 'both',
        focus: 'Autonomous trucks',
        hq: 'Stockholm',
        priority: 'High',
        applicationStatus: 'Applied',
        notes: 'Met at a meetup',
        englishOnly: 'Yes',
        visaSponsorship: 'Unknown',
        careersUrl: 'https://einride.tech/careers'
      },
      { name: 'Plain', list: 'vehicle' }
    ])
    expect(findCompany(db, 'Einride')).toEqual({
      id: expect.any(Number),
      name: 'Einride',
      list: 'both',
      focus: 'Autonomous trucks',
      hq: 'Stockholm',
      priority: 'High',
      applicationStatus: 'Applied',
      notes: 'Met at a meetup',
      englishOnly: 'Yes',
      visaSponsorship: 'Unknown',
      careersUrl: 'https://einride.tech/careers',
      jobsUrl: null,
      jobBoard: null,
      status: 'pending',
      note: null,
      error: null,
      checkedAt: null,
      readAt: null,
      readError: null,
      openJobs: 0,
      sponsors: []
    })
    expect(findCompany(db, 'Plain')).toMatchObject({
      focus: '',
      hq: '',
      priority: null,
      applicationStatus: null,
      notes: null,
      englishOnly: null,
      visaSponsorship: null,
      careersUrl: null
    })
  })

  test('lists companies by name, ignoring case', () => {
    addCompanies(db, [
      { name: 'bosch', list: 'vehicle' },
      { name: 'Alpha', list: 'machinery' },
      { name: 'Cat', list: 'machinery' }
    ])
    expect(listCompanies(db).map((c) => c.name)).toEqual(['Alpha', 'bosch', 'Cat'])
  })

  test('getCompany and findCompany return undefined for a company that is not there', () => {
    expect(getCompany(db, 999)).toBeUndefined()
    expect(findCompany(db, 'Nobody')).toBeUndefined()
  })

  test('saveCheck stores the result and the job board', () => {
    const id = addOne('Waymo')
    saveCheck(db, id, waymoCheck)
    expect(getCompany(db, id)).toMatchObject({
      status: 'direct',
      careersUrl: 'https://waymo.com/careers',
      jobsUrl: 'https://boards.greenhouse.io/waymo',
      jobBoard: { system: 'greenhouse', board: 'waymo' },
      checkedAt: expect.any(String)
    })
  })

  test('saveCheck sets checked_at to now, stores note and error, and a result with no board clears the old one', () => {
    const id = addOne('Waymo')
    const before = Date.now()
    saveCheck(db, id, waymoCheck)
    const stamp = Date.parse(getCompany(db, id)!.checkedAt!)
    expect(stamp).toBeGreaterThanOrEqual(before)
    expect(stamp).toBeLessThanOrEqual(Date.now())

    saveCheck(db, id, {
      careersUrl: null,
      jobsUrl: null,
      status: 'blocked',
      jobBoard: null,
      note: 'robots.txt disallows the careers page',
      error: 'blocked'
    })
    expect(getCompany(db, id)).toMatchObject({
      status: 'blocked',
      careersUrl: null,
      jobsUrl: null,
      jobBoard: null,
      note: 'robots.txt disallows the careers page',
      error: 'blocked'
    })
  })

  test('saveCheck leaves the lookup attempts alone', () => {
    const id = addOne('Waymo')
    noteFailedLookup(db, id, 3)
    saveCheck(db, id, waymoCheck)
    expect(attemptsOf(id)).toBe(1)
  })

  test('a company Claude skips twice becomes not found', () => {
    const id = addOne('Waymo')
    noteFailedLookup(db, id, 2)
    expect(getCompany(db, id)!.status).toBe('pending')
    noteFailedLookup(db, id, 2)
    expect(getCompany(db, id)).toMatchObject({
      status: 'not_found',
      note: 'Claude gave no answer for this company'
    })
  })

  test('only companies still pending are listed for lookup, in the order they were added', () => {
    const b = addOne('Bravo')
    const a = addOne('Alpha')
    const c = addOne('Charlie')
    saveCheck(db, b, waymoCheck)
    expect(pendingCompanies(db).map((x) => x.id)).toEqual([a, c])
  })

  test('resetCompany puts a company back to not checked, clearing links, board, note, error and attempts', () => {
    addCompanies(db, [
      {
        name: 'Einride',
        list: 'both',
        focus: 'Autonomous trucks',
        hq: 'Stockholm',
        priority: 'High',
        applicationStatus: 'Applied',
        notes: 'Met at a meetup',
        englishOnly: 'Yes',
        visaSponsorship: 'Unknown',
        careersUrl: 'https://einride.tech/careers'
      }
    ])
    const id = findCompany(db, 'Einride')!.id
    noteFailedLookup(db, id, 5)
    saveCheck(db, id, { ...waymoCheck, note: 'a note', error: 'an error' })
    expect(attemptsOf(id)).toBe(1)

    resetCompany(db, id)

    expect(getCompany(db, id)).toEqual({
      id,
      name: 'Einride',
      list: 'both',
      focus: 'Autonomous trucks',
      hq: 'Stockholm',
      priority: 'High',
      applicationStatus: 'Applied',
      notes: 'Met at a meetup',
      englishOnly: 'Yes',
      visaSponsorship: 'Unknown',
      careersUrl: null,
      jobsUrl: null,
      jobBoard: null,
      status: 'pending',
      note: null,
      error: null,
      checkedAt: null,
      readAt: null,
      readError: null,
      openJobs: 0,
      sponsors: []
    })
    expect(attemptsOf(id)).toBe(0)
    expect(pendingCompanies(db).map((c) => c.id)).toEqual([id])
  })

  test('move, remove and statusCounts', () => {
    const waymo = addOne('Waymo', 'vehicle')
    const konecranes = addOne('Konecranes', 'machinery')
    const cat = addOne('Cat', 'machinery')

    // All five keys come back, zeros included.
    expect(statusCounts(db)).toEqual({
      pending: 3,
      direct: 0,
      needs_claude: 0,
      blocked: 0,
      not_found: 0
    })

    moveCompany(db, waymo, 'both')
    expect(getCompany(db, waymo)!.list).toBe('both')
    expect(getCompany(db, konecranes)!.list).toBe('machinery')

    saveCheck(db, waymo, waymoCheck)
    saveCheck(db, konecranes, { ...waymoCheck, status: 'needs_claude', jobBoard: null })
    expect(statusCounts(db)).toEqual({
      pending: 1,
      direct: 1,
      needs_claude: 1,
      blocked: 0,
      not_found: 0
    })

    removeCompany(db, cat)
    expect(getCompany(db, cat)).toBeUndefined()
    expect(listCompanies(db).map((c) => c.name)).toEqual(['Konecranes', 'Waymo'])
    expect(statusCounts(db).pending).toBe(0)
  })

  test('the database refuses an unknown list', () => {
    expect(() => addCompanies(db, [{ name: 'X', list: 'cars' as CompanyList }])).toThrow()
  })

  test('a failed add leaves nothing behind', () => {
    expect(() =>
      addCompanies(db, [
        { name: 'Fine', list: 'vehicle' },
        { name: 'X', list: 'cars' as CompanyList }
      ])
    ).toThrow()
    expect(listCompanies(db)).toEqual([])
  })
})

test('migration 2 sends bare SuccessFactors servers and my-applications back to not checked yet, and blocks SmartRecruiters', () => {
  const path = join(dir, 'v1.db')
  const old = new Database(path)
  old.exec(`CREATE TABLE companies (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    list TEXT NOT NULL CHECK (list IN ('vehicle', 'machinery', 'both')),
    focus TEXT NOT NULL DEFAULT '',
    hq TEXT NOT NULL DEFAULT '',
    priority TEXT,
    application_status TEXT,
    notes TEXT,
    english_only TEXT,
    visa_sponsorship TEXT,
    careers_url TEXT,
    jobs_url TEXT,
    job_system TEXT,
    board TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'direct', 'needs_claude', 'blocked', 'not_found')),
    note TEXT,
    error TEXT,
    lookup_attempts INTEGER NOT NULL DEFAULT 0,
    checked_at TEXT
  )`)
  old.pragma('user_version = 1')
  const ins = old.prepare(
    `INSERT INTO companies (name, list, careers_url, jobs_url, job_system, board, status, note, lookup_attempts, checked_at)
     VALUES (?, 'vehicle', ?, ?, ?, ?, 'direct', 'n', 2, '2026-01-01T00:00:00.000Z')`
  )
  ins.run(
    'A',
    'https://a.com/c',
    'https://career5.successfactors.eu/',
    'successfactors',
    'career5.successfactors.eu'
  )
  ins.run(
    'B',
    'https://b.com/c',
    'https://career4.successfactors.com/career?company=Agco',
    'successfactors',
    'career4.successfactors.com/Agco'
  )
  ins.run(
    'C',
    'https://c.com/c',
    'https://jobs.scania.com/go/x',
    'successfactors',
    'jobs.scania.com'
  )
  ins.run(
    'D',
    'https://d.com/c',
    'https://jobs.smartrecruiters.com/my-applications',
    'smartrecruiters',
    'my-applications'
  )
  ins.run(
    'E',
    'https://e.com/c',
    'https://jobs.smartrecruiters.com/BoschGroup',
    'smartrecruiters',
    'BoschGroup'
  )
  old.close()

  const m = openDb(path)
  try {
    const rows = m.prepare('SELECT * FROM companies ORDER BY name').all() as Record<
      string,
      unknown
    >[]
    const pick = (r: Record<string, unknown>): unknown[] => [
      r.status,
      r.job_system,
      r.board,
      r.error
    ]
    expect(pick(rows[0])).toEqual(['pending', null, null, null])
    expect(pick(rows[1])).toEqual(['pending', null, null, null])
    expect(pick(rows[2])).toEqual(['direct', 'successfactors', 'jobs.scania.com', null])
    expect(pick(rows[3])).toEqual(['pending', null, null, null])
    expect(pick(rows[4])).toEqual([
      'blocked',
      'smartrecruiters',
      'BoschGroup',
      'SmartRecruiters does not allow automated reading of its job feed (robots.txt)'
    ])
    for (const r of rows) {
      expect(r.note).toBe('n')
      expect(r.lookup_attempts).toBe(2)
    }
    expect(rows.map((r) => r.jobs_url)).toEqual([
      'https://career5.successfactors.eu/',
      'https://career4.successfactors.com/career?company=Agco',
      'https://jobs.scania.com/go/x',
      'https://jobs.smartrecruiters.com/my-applications',
      'https://jobs.smartrecruiters.com/BoschGroup'
    ])
    expect(rows.every((r) => typeof r.careers_url === 'string')).toBe(true)
  } finally {
    m.close()
  }
})

test('migration 7 sends needs-Claude companies with their own link back to not checked yet, once', () => {
  const path = join(dir, 'v6.db')
  const v6 = openDb(path)
  const ins = v6.prepare(
    `INSERT INTO companies (name, list, careers_url, jobs_url, job_system, board, status, note, error, lookup_attempts, checked_at)
     VALUES (?, 'vehicle', ?, ?, ?, ?, ?, 'a note', ?, 1, '2026-11-01T00:00:00.000Z')`
  )
  ins.run(
    'Own',
    'https://own.com/careers',
    'https://own.com/jobs',
    'x',
    'y',
    'needs_claude',
    'HTTP 503'
  )
  ins.run(
    'LinkedIn',
    'https://www.linkedin.com/company/x/jobs',
    null,
    null,
    null,
    'needs_claude',
    null
  )
  ins.run('NoLink', null, null, null, null, 'needs_claude', null)
  ins.run('Empty', '', null, null, null, 'needs_claude', null)
  ins.run('Blocked', 'https://b.com/careers', null, null, null, 'blocked', 'robots.txt')
  ins.run(
    'Direct',
    'https://d.com/careers',
    'https://jobs.lever.co/d',
    'lever',
    'd',
    'direct',
    null
  )
  v6.pragma('user_version = 6')
  v6.close()

  const m = openDb(path)
  try {
    const rows = m
      .prepare(
        'SELECT name, status, job_system, board, careers_url, jobs_url, note, error, lookup_attempts, checked_at FROM companies ORDER BY name'
      )
      .all()
    expect(rows).toEqual([
      {
        name: 'Blocked',
        status: 'blocked',
        job_system: null,
        board: null,
        careers_url: 'https://b.com/careers',
        jobs_url: null,
        note: 'a note',
        error: 'robots.txt',
        lookup_attempts: 1,
        checked_at: '2026-11-01T00:00:00.000Z'
      },
      {
        name: 'Direct',
        status: 'direct',
        job_system: 'lever',
        board: 'd',
        careers_url: 'https://d.com/careers',
        jobs_url: 'https://jobs.lever.co/d',
        note: 'a note',
        error: null,
        lookup_attempts: 1,
        checked_at: '2026-11-01T00:00:00.000Z'
      },
      expect.objectContaining({ name: 'Empty', status: 'needs_claude' }),
      expect.objectContaining({ name: 'LinkedIn', status: 'needs_claude' }),
      expect.objectContaining({ name: 'NoLink', status: 'needs_claude' }),
      {
        name: 'Own',
        status: 'pending',
        job_system: null,
        board: null,
        careers_url: 'https://own.com/careers',
        jobs_url: 'https://own.com/jobs',
        note: 'a note',
        error: 'HTTP 503',
        lookup_attempts: 1,
        checked_at: '2026-11-01T00:00:00.000Z'
      }
    ])
    expect(m.pragma('user_version', { simple: true })).toBe(7)
  } finally {
    m.close()
  }
})
