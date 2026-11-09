import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  addCompanies,
  findCompany,
  listCompanies,
  removeCompany
} from '../../src/main/db/companies'
import { openDb, type Db } from '../../src/main/db/db'
import { saveRead, storedJobs } from '../../src/main/db/jobs'
import { cleanName } from '../../src/main/sponsors/match'
import {
  noteSponsorListFailed,
  rejectSponsor,
  SPONSOR_MATCH_SQL,
  saveSponsorList,
  sponsorLists,
  sponsorMatches
} from '../../src/main/sponsors/store'

let dir = ''
let db: Db
let abb = 0
const NOW = new Date('2026-11-05T10:00:00.000Z')
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'job-sponsors-'))
  db = openDb(join(dir, 'job-auto.db'))
  addCompanies(db, [
    { name: 'ABB', list: 'machinery' },
    { name: 'Volvo', list: 'vehicle' }
  ])
  abb = findCompany(db, 'ABB')!.id
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const gb = [
  { name: 'ABB Limited', detail: 'Skilled Worker' },
  { name: 'ABB Grain Ltd', detail: 'Skilled Worker' },
  { name: 'Volvo Cars UK Ltd', detail: 'x' }
]

describe('lists', () => {
  test('a list never fetched has zeros and nulls, one per country', () => {
    expect(sponsorLists(db)).toEqual([
      { country: 'GB', fetchedAt: null, entries: 0, error: null },
      { country: 'NL', fetchedAt: null, entries: 0, error: null },
      { country: 'DK', fetchedAt: null, entries: 0, error: null },
      { country: 'CA', fetchedAt: null, entries: 0, error: null }
    ])
  })

  test('a save replaces the old entries', () => {
    saveSponsorList(db, 'GB', gb, 'src1', NOW)
    saveSponsorList(db, 'GB', [{ name: 'ABB Ltd', detail: 'new' }], 'src2', NOW)
    expect(sponsorMatches(db, abb, 'ABB')).toEqual([
      { country: 'GB', name: 'ABB Ltd', detail: 'new' }
    ])
    expect(sponsorLists(db)[0]).toEqual({
      country: 'GB',
      fetchedAt: NOW.toISOString(),
      entries: 1,
      error: null
    })
  })

  test('a failure keeps the entries and records the error; a save clears it', () => {
    saveSponsorList(db, 'GB', gb, 'src', NOW)
    noteSponsorListFailed(db, 'GB', 'boom')
    expect(sponsorLists(db)[0]).toMatchObject({ entries: 3, error: 'boom' })
    expect(sponsorMatches(db, abb, 'ABB')).toHaveLength(1)
    saveSponsorList(db, 'GB', gb, 'src', NOW)
    expect(sponsorLists(db)[0].error).toBeNull()
  })

  test('a failure on a never-fetched list is recorded', () => {
    noteSponsorListFailed(db, 'NL', 'nope')
    expect(sponsorLists(db)[1]).toEqual({
      country: 'NL',
      fetchedAt: null,
      entries: 0,
      error: 'nope'
    })
  })
})

describe('matches', () => {
  test('exact and suffixed names match, other companies do not', () => {
    saveSponsorList(db, 'GB', gb, 'src', NOW)
    expect(sponsorMatches(db, abb, 'ABB').map((m) => m.name)).toEqual(['ABB Limited'])
    expect(sponsorMatches(db, abb, 'Volvo')).toEqual([])
  })

  test('matches come from every country', () => {
    saveSponsorList(db, 'GB', gb, 's', NOW)
    saveSponsorList(db, 'DK', [{ name: 'ABB A/S', detail: 'Fast-track certified' }], 's', NOW)
    expect(sponsorMatches(db, abb, 'ABB').map((m) => m.country)).toEqual(['DK', 'GB'])
  })

  test('a rejected match stays hidden after a new save', () => {
    saveSponsorList(db, 'GB', gb, 's', NOW)
    rejectSponsor(db, abb, 'GB', 'ABB Limited')
    expect(sponsorMatches(db, abb, 'ABB')).toEqual([])
    saveSponsorList(db, 'GB', gb, 's', NOW)
    expect(sponsorMatches(db, abb, 'ABB')).toEqual([])
  })

  test('a reject hides every spelling of the name, also after a refresh re-spells it', () => {
    saveSponsorList(db, 'GB', [{ name: 'ABB LIMITED', detail: 'x' }], 's', NOW)
    rejectSponsor(db, abb, 'GB', 'ABB LIMITED')
    saveSponsorList(db, 'GB', [{ name: 'Abb Limited', detail: 'x' }], 's', NOW)
    expect(sponsorMatches(db, abb, 'ABB')).toEqual([])
    // Only that list: the same name in another list still matches.
    saveSponsorList(db, 'DK', [{ name: 'ABB A/S', detail: 'y' }], 's', NOW)
    expect(sponsorMatches(db, abb, 'ABB').map((m) => m.country)).toEqual(['DK'])
  })

  test('rejects saved before the update are kept, by their cleaned name', () => {
    saveSponsorList(db, 'GB', [{ name: 'Abb Limited', detail: 'x' }], 's', NOW)
    db.prepare(
      "INSERT INTO sponsor_rejects (company_id, country, name) VALUES (?, 'GB', 'ABB LIMITED')"
    ).run(abb)
    db.pragma('user_version = 5')
    db.close()
    db = openDb(join(dir, 'job-auto.db'))
    expect(db.prepare('SELECT name FROM sponsor_rejects').pluck().all()).toEqual(['abb'])
    expect(sponsorMatches(db, abb, 'ABB')).toEqual([])
  })

  test('removing a company removes its rejects', () => {
    rejectSponsor(db, abb, 'GB', 'ABB Limited')
    removeCompany(db, abb)
    expect(db.prepare('SELECT COUNT(*) FROM sponsor_rejects').pluck().get()).toBe(0)
  })

  test('the match query searches the norm index instead of scanning the table', () => {
    const plan = db
      .prepare('EXPLAIN QUERY PLAN ' + SPONSOR_MATCH_SQL)
      .all('abb', 'abb', 'abb!', 1) as { detail: string }[]
    const details = plan.map((r) => r.detail).join(' | ')
    expect(details).toContain('SEARCH sponsor_entries USING INDEX sponsor_entries_norm')
    expect(details).not.toContain('SCAN sponsor_entries')
  })

  test('a name that only continues the company name without a space is not a match', () => {
    saveSponsorList(
      db,
      'GB',
      [
        { name: 'ABBA Ltd', detail: 'x' },
        { name: 'ABB UK', detail: 'y' }
      ],
      's',
      NOW
    )
    expect(sponsorMatches(db, abb, 'ABB').map((m) => m.name)).toEqual(['ABB UK'])
  })

  test('a leading "the" and legal-form words after the name still match', () => {
    addCompanies(db, [
      { name: 'MathWorks', list: 'machinery' },
      { name: 'Intel', list: 'machinery' }
    ])
    saveSponsorList(
      db,
      'GB',
      [
        { name: 'The Mathworks Limited', detail: 'a' },
        { name: 'Intel Corporation (UK) Ltd', detail: 'b' },
        { name: 'Intel Grain Ltd', detail: 'c' }
      ],
      's',
      NOW
    )
    const names = (company: string): string[] =>
      sponsorMatches(db, findCompany(db, company)!.id, company).map((m) => m.name)
    expect(names('MathWorks')).toEqual(['The Mathworks Limited'])
    expect(names('Intel')).toEqual(['Intel Corporation (UK) Ltd'])
  })

  test('names stored under an older cleaning rule are cleaned again when the app updates', () => {
    saveSponsorList(db, 'GB', [{ name: 'The ABB Limited', detail: 'x' }], 's', NOW)
    db.prepare("UPDATE sponsor_entries SET norm = 'the abb'").run()
    db.pragma('user_version = 4')
    db.close()
    db = openDb(join(dir, 'job-auto.db'))
    expect(db.prepare('SELECT norm FROM sponsor_entries').pluck().all()).toEqual(['abb'])
    expect(sponsorMatches(db, abb, 'ABB').map((m) => m.name)).toEqual(['The ABB Limited'])
  })

  test('the cleaned name is stored as norm', () => {
    saveSponsorList(db, 'GB', gb, 's', NOW)
    expect(db.prepare('SELECT norm FROM sponsor_entries ORDER BY name').pluck().all()).toEqual(
      ['ABB Grain Ltd', 'ABB Limited', 'Volvo Cars UK Ltd'].map(cleanName)
    )
  })

  test('listCompanies and storedJobs carry the company sponsors', () => {
    saveSponsorList(db, 'GB', gb, 's', NOW)
    saveRead(
      db,
      abb,
      'greenhouse:abb',
      [
        {
          sourceId: '1',
          title: 'Engineer',
          location: 'Zurich',
          url: 'https://x/1',
          countries: ['CH'],
          employment: 'unknown',
          postedAt: null,
          postedRough: false,
          needsDetails: false
        }
      ],
      true,
      NOW
    )
    const expected = [{ country: 'GB', name: 'ABB Limited', detail: 'Skilled Worker' }]
    expect(listCompanies(db).find((c) => c.name === 'ABB')!.sponsors).toEqual(expected)
    expect(listCompanies(db).find((c) => c.name === 'Volvo')!.sponsors).toEqual([])
    expect(storedJobs(db, NOW)[0].sponsors).toEqual(expected)
  })
})
